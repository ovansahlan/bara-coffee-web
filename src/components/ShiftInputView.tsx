'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CASH_DROP_METHODS,
  DEFAULT_SHIFT_SCHEDULE,
  DENOMS,
  calcShiftMetrics,
  computeCumulativeShift2Breakdown,
  findDuplicateExpenseInList,
  formatDateIndo,
  formatDateTimeShort,
  formatPlain,
  formatRp,
  getCumulativeUnderflows,
  getCurrentTimeWib,
  getLocalDateStr,
  parseNullableNum,
  parseNum,
} from '@/lib/calc';
import type {
  AppSettingsPublic,
  CashDropRecord,
  ExpenseRecord,
  OutletPublic,
  PreviousBalanceInfo,
  Shift1RefInfo,
  ShiftRecord,
  UserRole,
} from '@/lib/types';

interface ShiftInputViewProps {
  role: UserRole;
  outlets: OutletPublic[];
  settings: AppSettingsPublic;
  selectedOutletId: string;
  selectedDate: string;
  selectedShift: 1 | 2;
  canSwitchOutlet?: boolean;
  defaultCashierName?: string;
  todayAttendanceStatus?: { checkedIn: boolean; checkedOut: boolean; shift: 1 | 2 | 3 | null } | null;
  onChangeContext: (next: { outletId?: string; date?: string; shift?: 1 | 2 }) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

export default function ShiftInputView({
  role,
  outlets,
  settings,
  selectedOutletId,
  selectedDate,
  selectedShift,
  canSwitchOutlet,
  defaultCashierName,
  todayAttendanceStatus = null,
  onChangeContext,
  onDirtyChange,
  onToast,
}: ShiftInputViewProps) {
  const remindedCloseRef = useRef<string>('');

  useEffect(() => {
    if (role !== 'crew' || !todayAttendanceStatus || todayAttendanceStatus.checkedOut) return;
    if (selectedDate !== getLocalDateStr(0)) return;
    const key = `${selectedDate}_${selectedShift}`;
    if (remindedCloseRef.current === key) return;

    const sched = settings.shiftSchedule || DEFAULT_SHIFT_SCHEDULE;
    const endHhMm = selectedShift === 1 ? sched.shift1End : sched.shift2End;
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10) || 0);
      return h * 60 + m;
    };
    const nowMin = toMin(getCurrentTimeWib());
    const endMin = toMin(endHhMm);

    if (nowMin >= endMin - 30) {
      remindedCloseRef.current = key;
      if (!todayAttendanceStatus.checkedIn) {
        onToast('Pengingat: Anda belum absen masuk hari ini. Jangan lupa absen di tab Absensi!', 'warning');
      } else {
        onToast('Menjelang tutup shift: jangan lupa absen pulang di tab Absensi sebelum pulang!', 'warning');
      }
    }
  }, [role, todayAttendanceStatus, selectedDate, selectedShift, settings.shiftSchedule, onToast]);
  const isOwner = role === 'owner';
  const allowOutletSwitch = canSwitchOutlet ?? isOwner;
  const activeOutlet = outlets.find((o) => o.id === selectedOutletId) || outlets[0];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [record, setRecord] = useState<ShiftRecord | null>(null);
  const [prevBalance, setPrevBalance] = useState<PreviousBalanceInfo>({
    found: false,
    label: 'Saldo Awal Pertama Outlet',
    amount: 0,
  });
  const [shift1Ref, setShift1Ref] = useState<Shift1RefInfo | null>(null);
  const [dayStatuses, setDayStatuses] = useState<Record<number, string>>({});

  // Expense form state
  const [expDesc, setExpDesc] = useState('');
  const [expCategory, setExpCategory] = useState(settings.expenseCategories[0] || 'Minuman');
  const [expAmountStr, setExpAmountStr] = useState('');
  const [addingExp, setAddingExp] = useState(false);

  // Cash drop (Setor ke Owner / Bank) form state
  const [dropMethod, setDropMethod] = useState(DEFAULT_CASH_DROP_METHODS[0]);
  const [dropNote, setDropNote] = useState('');
  const [dropAmountStr, setDropAmountStr] = useState('');
  const [addingDrop, setAddingDrop] = useState(false);

  // Duplicate expense warning modal
  const [dupModal, setDupModal] = useState<{
    existing: ExpenseRecord & { cashier?: string };
    incoming: { desc: string; category: string; amount: number };
  } | null>(null);

  // Denomination calculator toggle
  const [showDenom, setShowDenom] = useState(false);

  // Controlled Correction Mode
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [corrReasonInput, setCorrReasonInput] = useState('');
  const [corrPinInput, setCorrPinInput] = useState('');
  const [corrPinErr, setCorrPinErr] = useState('');
  const [activeCorrection, setActiveCorrection] = useState<{
    shiftId: string;
    reason: string;
    ownerPin: string;
    snapshot: ShiftRecord;
  } | null>(null);

  // WhatsApp modal
  const [waModalText, setWaModalText] = useState<string | null>(null);

  const fetchShiftData = useCallback(async (signal?: AbortSignal) => {
    if (!activeOutlet) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        outletId: activeOutlet.id,
        date: selectedDate,
        shift: String(selectedShift),
      });
      const res = await fetch(`/api/shifts?${params.toString()}`, { cache: 'no-store', signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat shift.');
      if (signal?.aborted) return;
      const nextRecord: ShiftRecord = data.shift;
      if (defaultCashierName && !nextRecord.balanceChecked && !nextRecord.cashier) {
        nextRecord.cashier = defaultCashierName;
      }
      setRecord(nextRecord);
      setPrevBalance(data.previousBalance);
      setShift1Ref(data.shift1Ref || null);
      setDayStatuses(data.dayStatuses || {});
      setDirty(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onToast(err instanceof Error ? err.message : 'Gagal memuat shift.', 'error');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeOutlet, selectedDate, selectedShift, defaultCashierName, onToast]);

  useEffect(() => {
    const controller = new AbortController();
    setActiveCorrection(null);
    fetchShiftData(controller.signal);
    return () => controller.abort();
  }, [fetchShiftData]);

  useEffect(() => {
    if (settings.expenseCategories.length > 0 && !settings.expenseCategories.includes(expCategory)) {
      setExpCategory(settings.expenseCategories[0]);
    }
  }, [settings.expenseCategories, expCategory]);

  const isCorrecting = Boolean(record && activeCorrection && activeCorrection.shiftId === record.id);
  const isLocked = Boolean(record?.balanceChecked && !isCorrecting);
  const isCum = Boolean(record && record.shift === 2 && record.inputMode === 'cumulative');

  useEffect(() => {
    onDirtyChange?.(dirty || isCorrecting);
  }, [dirty, isCorrecting, onDirtyChange]);

  useEffect(() => {
    if (!dirty && !isCorrecting) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, isCorrecting]);

  function guardedChangeContext(next: { outletId?: string; date?: string; shift?: 1 | 2 }) {
    if (
      (dirty || isCorrecting) &&
      !window.confirm('Ada perubahan shift yang belum disimpan. Yakin ingin pindah dan membatalkan perubahan?')
    ) {
      return;
    }
    onChangeContext(next);
  }

  const s1Breakdown = useMemo(
    () => shift1Ref?.breakdown || { tunai: 0, qris: 0, online: 0, edc: 0 },
    [shift1Ref]
  );
  const s1Total = shift1Ref?.totalOmset || 0;

  const metrics = useMemo(() => {
    if (!record) return null;
    return calcShiftMetrics(record);
  }, [record]);

  const dailyTotalPos = s1Total + (metrics?.totalOmset || 0);

  function mutateRecord(updater: (prev: ShiftRecord) => ShiftRecord) {
    setRecord((prev) => {
      if (!prev) return prev;
      return updater(prev);
    });
    setDirty(true);
  }

  function shiftDateBy(delta: number) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    const next = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    guardedChangeContext({ date: next });
  }

  function handleSwitchMode(mode: 'cumulative' | 'standalone') {
    if (!record || record.shift !== 2 || isLocked) return;
    if (record.inputMode === mode) return;
    mutateRecord((prev) => {
      if (mode === 'cumulative') {
        const nextPos = {
          tunai: prev.breakdown.tunai > 0 ? s1Breakdown.tunai + prev.breakdown.tunai : null,
          qris: prev.breakdown.qris > 0 ? s1Breakdown.qris + prev.breakdown.qris : null,
          online: prev.breakdown.online > 0 ? s1Breakdown.online + prev.breakdown.online : null,
          edc: prev.breakdown.edc > 0 ? s1Breakdown.edc + prev.breakdown.edc : null,
          total: !prev.autoTotal && prev.manualTotalOmset > 0 ? s1Total + prev.manualTotalOmset : null,
        };
        const comp = computeCumulativeShift2Breakdown(nextPos, s1Breakdown, s1Total, prev.autoTotal);
        return {
          ...prev,
          inputMode: 'cumulative',
          posCumulative: nextPos,
          breakdown: comp.breakdown,
          manualTotalOmset: comp.manualTotalOmset,
        };
      }
      return { ...prev, inputMode: 'standalone' };
    });
  }

  function handleBreakdownChange(field: 'tunai' | 'qris' | 'online' | 'edc', rawStr: string) {
    if (!record || isLocked) return;
    const nullableVal = parseNullableNum(rawStr);
    mutateRecord((prev) => {
      if (prev.shift === 2 && prev.inputMode === 'cumulative') {
        const nextPos = { ...prev.posCumulative, [field]: nullableVal };
        const comp = computeCumulativeShift2Breakdown(nextPos, s1Breakdown, s1Total, prev.autoTotal);
        return {
          ...prev,
          posCumulative: nextPos,
          breakdown: comp.breakdown,
          manualTotalOmset: comp.manualTotalOmset,
        };
      }
      return {
        ...prev,
        breakdown: { ...prev.breakdown, [field]: nullableVal || 0 },
      };
    });
  }

  function handleManualTotalChange(rawStr: string) {
    if (!record || isLocked) return;
    const nullableVal = parseNullableNum(rawStr);
    mutateRecord((prev) => {
      if (prev.shift === 2 && prev.inputMode === 'cumulative') {
        const nextPos = { ...prev.posCumulative, total: nullableVal };
        const comp = computeCumulativeShift2Breakdown(nextPos, s1Breakdown, s1Total, false);
        return {
          ...prev,
          autoTotal: false,
          posCumulative: nextPos,
          manualTotalOmset: comp.manualTotalOmset,
        };
      }
      return {
        ...prev,
        autoTotal: false,
        manualTotalOmset: nullableVal || 0,
      };
    });
  }

  async function saveShift(confirmBalance: boolean) {
    if (!record || !activeOutlet) return;
    if (isCorrecting && !confirmBalance) {
      onToast('Shift terkunci wajib disimpan melalui tombol Simpan Koreksi & Kunci.', 'warning');
      return;
    }
    if (confirmBalance && isCum) {
      const underflows = getCumulativeUnderflows(record.posCumulative, s1Breakdown, s1Total, record.autoTotal);
      if (underflows.length > 0) {
        onToast(
          `Angka POS (${underflows.map((u) => u.label).join(', ')}) lebih kecil dari Shift 1. Periksa dulu.`,
          'error'
        );
        return;
      }
    }
    if (confirmBalance && record.actualCash === null) {
      onToast('Masukkan nominal Uang Fisik di Laci Kasir terlebih dahulu.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/shifts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletId: activeOutlet.id,
          date: record.date,
          shift: record.shift,
          cashier: record.cashier,
          inputMode: record.inputMode,
          posCumulative: record.posCumulative,
          autoTotal: record.autoTotal,
          manualTotalOmset: record.manualTotalOmset,
          breakdown: record.breakdown,
          openingCash: record.openingCash,
          openingCashSource: record.openingCashSource,
          cashDrop: record.cashDrop,
          actualCash: record.actualCash,
          denomCounts: record.denomCounts,
          balanceNote: record.balanceNote,
          confirmBalance,
          correctionReason: isCorrecting ? activeCorrection?.reason : '',
          correctionOwnerPin: isCorrecting ? activeCorrection?.ownerPin : '',
          correctionExpenses: isCorrecting ? record.expenses : undefined,
          correctionCashDrops: isCorrecting ? record.cashDrops : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan shift.');

      setRecord(data.shift);
      if (data.previousBalance) setPrevBalance(data.previousBalance);
      setDirty(false);

      if (confirmBalance) {
        const m = calcShiftMetrics(data.shift);
        setDayStatuses((prev) => ({ ...prev, [data.shift.shift]: m.status }));
        if (isCorrecting) {
          setActiveCorrection(null);
          onToast('Koreksi berhasil disimpan ke Jejak Audit & shift dikunci ulang.', 'success');
        } else if (m.diff === 0) {
          onToast('Check Balance berhasil — Saldo kasir BALANCE & shift terkunci!', 'success');
        } else {
          onToast(`Check Balance tersimpan dengan selisih ${formatRp(m.diff)}.`, 'warning');
        }
        if (role === 'crew' && todayAttendanceStatus && !todayAttendanceStatus.checkedOut) {
          setTimeout(() => {
            onToast(
              todayAttendanceStatus.checkedIn
                ? 'Pengingat Close Shift: Jangan lupa absen pulang di tab Absensi!'
                : 'Pengingat Close Shift: Anda belum absen hari ini, cek tab Absensi!',
              'warning'
            );
          }, 1800);
        }
      } else {
        onToast('Draft shift tersimpan ke database.', 'info');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function submitExpense(forceDuplicate = false, overrideData?: { desc: string; category: string; amount: number }) {
    if (!record || !activeOutlet || isLocked) return;
    const desc = (overrideData?.desc ?? expDesc).trim();
    const category = overrideData?.category ?? expCategory;
    const amount = overrideData?.amount ?? parseNum(expAmountStr);

    if (!desc || amount <= 0) {
      onToast('Lengkapi keterangan dan nominal pengeluaran.', 'warning');
      return;
    }

    // In Correction Mode, stage expense changes locally so Cancel stays atomic and Save logs exact diffs
    if (isCorrecting) {
      if (!forceDuplicate) {
        const localTodayExpenses = [
          ...(record.shift === 2 && shift1Ref ? shift1Ref.expenses : []),
          ...record.expenses,
        ];
        const dup = findDuplicateExpenseInList(localTodayExpenses, desc, category, amount);
        if (dup) {
          setDupModal({ existing: dup, incoming: { desc, category, amount } });
          return;
        }
      }
      const staged: ExpenseRecord = {
        id: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        shiftId: record.id,
        outletId: activeOutlet.id,
        date: record.date,
        shift: record.shift,
        desc,
        category,
        amount,
        time: getCurrentTimeWib(),
      };
      mutateRecord((prev) => ({ ...prev, expenses: [...prev.expenses, staged] }));
      setExpDesc('');
      setExpAmountStr('');
      onToast('Pengeluaran ditambahkan ke draft koreksi. Klik Simpan Koreksi & Kunci untuk menyimpan.', 'info');
      return;
    }

    setAddingExp(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletId: activeOutlet.id,
          date: record.date,
          shift: record.shift,
          cashier: record.cashier,
          desc,
          category,
          amount,
          forceDuplicate,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.duplicateDetected) {
        setDupModal({ existing: data.duplicate, incoming: { desc, category, amount } });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Gagal menambah pengeluaran.');

      setRecord((prev) =>
        prev
          ? {
            ...prev,
            expenses: data.shift.expenses,
            balanceChecked: data.shift.balanceChecked,
          }
          : data.shift
      );
      setExpDesc('');
      setExpAmountStr('');
      onToast('Pengeluaran kas kecil ditambahkan.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menambah pengeluaran.', 'error');
    } finally {
      setAddingExp(false);
    }
  }

  async function handleRemoveExpense(id: string) {
    if (!record || isLocked) return;
    if (isCorrecting) {
      mutateRecord((prev) => ({
        ...prev,
        expenses: prev.expenses.filter((e) => e.id !== id),
      }));
      onToast('Pengeluaran dihapus dari draft koreksi. Klik Simpan Koreksi & Kunci untuk menyimpan.', 'info');
      return;
    }

    try {
      const res = await fetch(`/api/expenses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus pengeluaran.');
      setRecord((prev) =>
        prev
          ? {
            ...prev,
            expenses: data.shift?.expenses || prev.expenses.filter((e) => e.id !== id),
          }
          : prev
      );
      onToast('Pengeluaran dihapus.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus pengeluaran.', 'error');
    }
  }

  async function submitCashDrop(e: React.FormEvent) {
    e.preventDefault();
    if (!record || !activeOutlet || isLocked) return;
    const amount = parseNum(dropAmountStr);
    const note = dropNote.trim();
    if (amount <= 0) {
      onToast('Masukkan nominal setoran yang valid.', 'warning');
      return;
    }

    if (isCorrecting) {
      const staged: CashDropRecord = {
        id: `staged-drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        shiftId: record.id,
        outletId: activeOutlet.id,
        date: record.date,
        shift: record.shift,
        method: dropMethod,
        note,
        amount,
        time: getCurrentTimeWib(),
      };
      mutateRecord((prev) => {
        const nextDrops = [...(prev.cashDrops || []), staged];
        return {
          ...prev,
          cashDrops: nextDrops,
          cashDrop: nextDrops.reduce((s, d) => s + d.amount, 0),
        };
      });
      setDropNote('');
      setDropAmountStr('');
      onToast('Setoran ditambahkan ke draft koreksi. Klik Simpan Koreksi & Kunci untuk menyimpan.', 'info');
      return;
    }

    setAddingDrop(true);
    try {
      const res = await fetch('/api/cash-drops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletId: activeOutlet.id,
          date: record.date,
          shift: record.shift,
          cashier: record.cashier,
          method: dropMethod,
          note,
          amount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mencatat setoran.');

      setRecord((prev) =>
        prev
          ? {
              ...prev,
              cashDrops: data.shift.cashDrops || [],
              cashDrop: data.shift.cashDrop ?? 0,
              balanceChecked: data.shift.balanceChecked,
            }
          : data.shift
      );
      setDropNote('');
      setDropAmountStr('');
      onToast('Setoran ke Owner / Bank tercatat.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mencatat setoran.', 'error');
    } finally {
      setAddingDrop(false);
    }
  }

  async function handleRemoveCashDrop(id: string) {
    if (!record || isLocked) return;
    if (isCorrecting) {
      mutateRecord((prev) => {
        const nextDrops = (prev.cashDrops || []).filter((d) => d.id !== id);
        return {
          ...prev,
          cashDrops: nextDrops,
          cashDrop: nextDrops.reduce((s, d) => s + d.amount, 0),
        };
      });
      onToast('Setoran dihapus dari draft koreksi. Klik Simpan Koreksi & Kunci untuk menyimpan.', 'info');
      return;
    }

    try {
      const res = await fetch(`/api/cash-drops/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus setoran.');
      setRecord((prev) =>
        prev
          ? {
              ...prev,
              cashDrops: data.shift?.cashDrops || prev.cashDrops.filter((d) => d.id !== id),
              cashDrop: data.shift?.cashDrop ?? 0,
              balanceChecked: data.shift?.balanceChecked ?? prev.balanceChecked,
            }
          : prev
      );
      onToast('Data setoran dihapus.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus setoran.', 'error');
    }
  }

  async function handleUnlockCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!record) return;
    const reason = corrReasonInput.trim();
    if (!reason) return;
    setCorrPinErr('');

    try {
      const res = await fetch('/api/shifts/verify-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, ownerPin: corrPinInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCorrPinErr(data.error || 'Verifikasi koreksi gagal.');
        return;
      }
      setActiveCorrection({
        shiftId: record.id,
        reason,
        ownerPin: corrPinInput.trim(),
        snapshot: JSON.parse(JSON.stringify(record)),
      });
      setCorrectionModalOpen(false);
      setCorrReasonInput('');
      setCorrPinInput('');
      onToast('Mode Koreksi aktif. Ubah data lalu klik Simpan Koreksi & Kunci.', 'info');
    } catch {
      setCorrPinErr('Gagal memverifikasi koreksi.');
    }
  }

  function handleCancelCorrection() {
    if (!activeCorrection) return;
    setRecord(activeCorrection.snapshot);
    setActiveCorrection(null);
    setDirty(false);
    onToast('Koreksi dibatalkan.', 'info');
  }

  function buildWhatsAppText(): string {
    if (!record || !metrics || !activeOutlet) return '';
    const statusText =
      metrics.status === 'balanced'
        ? 'BALANCE (COCOK)'
        : metrics.status === 'surplus'
          ? `SELISIH LEBIH (+${formatRp(metrics.diff)})`
          : metrics.status === 'deficit'
            ? `SELISIH KURANG (${formatRp(metrics.diff)})`
            : 'BELUM CHECK BALANCE';

    const expLines =
      record.expenses.length === 0
        ? '  - Tidak ada pengeluaran'
        : record.expenses.map((e) => `  - ${e.desc} (${e.category}): ${formatRp(e.amount)}`).join('\n');

    const omsetLines = isCum
      ? [
        `*RINGKASAN OMSET*`,
        `Total POS Seharian : ${formatRp(dailyTotalPos)}`,
        `Omset Shift 1      : ${formatRp(s1Total)}`,
        `Omset Shift 2      : ${formatRp(metrics.totalOmset)}`,
        `• Tunai Shift 2    : ${formatRp(record.breakdown.tunai)}`,
        `• QRIS Shift 2     : ${formatRp(record.breakdown.qris)}`,
        `• Online Shift 2   : ${formatRp(record.breakdown.online)}`,
        `• EDC/Tf Shift 2   : ${formatRp(record.breakdown.edc)}`,
      ]
      : [
        `*RINGKASAN OMSET*`,
        `Total Omset    : ${formatRp(metrics.totalOmset)}`,
        `• Tunai        : ${formatRp(record.breakdown.tunai)}`,
        `• QRIS         : ${formatRp(record.breakdown.qris)}`,
        `• Online Deliv : ${formatRp(record.breakdown.online)}`,
        `• EDC/Transfer : ${formatRp(record.breakdown.edc)}`,
      ];

    return [
      `*LAPORAN OMSET & KAS KECIL — BARA COFFEE*`,
      `Outlet : ${activeOutlet.name}`,
      `Tanggal: ${formatDateIndo(record.date)}`,
      `Shift  : Shift ${record.shift} (${record.shift === 1 ? 'Pagi' : 'Sore'})`,
      `Kasir  : ${record.cashier || '-'}`,
      ``,
      ...omsetLines,
      ``,
      `*PENGELUARAN KAS KECIL (${formatRp(metrics.totalExpense)})*`,
      expLines,
      ``,
      `*CHECK BALANCE KASIR (SALDO BERJALAN)*`,
      `Saldo Sebelum  : ${formatRp(metrics.openingCash)}`,
      `+ Tunai Shift  : ${formatRp(record.breakdown.tunai)}`,
      `- Pengeluaran  : ${formatRp(metrics.totalExpense)}`,
      metrics.cashDrop > 0 ? `- Setor Owner  : ${formatRp(metrics.cashDrop)}` : '',
      ...(record.cashDrops || []).map(
        (d) => `    • ${d.method}${d.note ? ` (${d.note})` : ''}: ${formatRp(d.amount)}`
      ),
      metrics.drawerKasbon > 0 ? `- Kasbon Laci  : ${formatRp(metrics.drawerKasbon)}` : '',
      `Saldo Akhir    : ${formatRp(metrics.expectedCash)}`,
      `Uang Fisik     : ${metrics.hasActual ? formatRp(record.actualCash) : '-'}`,
      `Status         : ${statusText}`,
      record.balanceNote ? `Catatan        : ${record.balanceNote}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const denomTotal = useMemo(() => {
    if (!record) return 0;
    return DENOMS.reduce((sum, d) => sum + d * (record.denomCounts?.[String(d)] || 0), 0);
  }, [record]);

  const expenseCategorySubtotals = useMemo(() => {
    const map: Record<string, number> = {};
    (record?.expenses || []).forEach((e) => {
      map[e.category] = (map[e.category] || 0) + e.amount;
    });
    return Object.entries(map);
  }, [record]);

  if (loading || !record || !metrics || !activeOutlet) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center text-xs text-[var(--muted-foreground)]">
        Memuat data shift...
      </div>
    );
  }

  const parts = [
    { key: 'tunai' as const, label: 'Tunai', val: record.breakdown.tunai, color: 'var(--chart-1)' },
    { key: 'qris' as const, label: 'QRIS', val: record.breakdown.qris, color: 'var(--chart-2)' },
    { key: 'online' as const, label: 'Online', val: record.breakdown.online, color: 'var(--chart-3)' },
    { key: 'edc' as const, label: 'EDC/Tf', val: record.breakdown.edc, color: 'var(--chart-4)' },
  ];

  return (
    <div className="space-y-5">
      {/* Context Selector Bar */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted-foreground)] block">
              {allowOutletSwitch
                ? isOwner
                  ? 'Pilih Outlet (Mode Audit Owner)'
                  : 'Pilih Outlet Tugas (Rolling)'
                : 'Outlet Terkunci (Akses Kru / Kasir)'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {allowOutletSwitch ? (
                outlets.map((o) => {
                  const active = o.id === activeOutlet.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => guardedChangeContext({ outletId: o.id })}
                      className={`px-3 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${active
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)] font-semibold'
                        : 'bg-[var(--background)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--secondary)] font-medium'
                        }`}
                    >
                      {o.name}
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-1.5 rounded-lg border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold flex items-center gap-2">
                  <span>{activeOutlet.name}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-3 w-full lg:w-auto">
            <div className="space-y-1.5 flex-1 sm:flex-initial">
              <label htmlFor="shift-date" className="text-xs font-medium text-[var(--muted-foreground)] block">
                Tanggal
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftDateBy(-1)}
                  className="px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs cursor-pointer shrink-0"
                >
                  &larr;
                </button>
                <input
                  id="shift-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => e.target.value && guardedChangeContext({ date: e.target.value })}
                  className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-xs font-medium tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => shiftDateBy(1)}
                  className="px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs cursor-pointer shrink-0"
                >
                  &rarr;
                </button>
                <button
                  type="button"
                  onClick={() => guardedChangeContext({ date: getLocalDateStr(0) })}
                  className="px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer shrink-0"
                >
                  Hari Ini
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted-foreground)] block">Shift Kasir</span>
              <div className="grid grid-cols-2 sm:flex items-center gap-1.5 w-full sm:w-auto">
                {([1, 2] as const).map((num) => {
                  const active = selectedShift === num;
                  const st = dayStatuses[num];
                  const dotCls =
                    st === 'balanced'
                      ? 'bg-[var(--success)]'
                      : st === 'surplus'
                        ? 'bg-[var(--warning)]'
                        : st === 'deficit'
                          ? 'bg-[var(--error)]'
                          : 'bg-[var(--muted-foreground)] opacity-40';
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => guardedChangeContext({ shift: num })}
                      className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer ${active
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)] font-semibold'
                        : 'bg-[var(--background)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--secondary)] font-medium'
                        }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${dotCls}`} />
                      <span>{num === 1 ? 'Shift 1 (Pagi)' : 'Shift 2 (Sore)'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--card-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="shrink-0">Kasir / Barista:</span>
              <input
                type="text"
                disabled={isLocked}
                value={record.cashier}
                placeholder="Nama kasir bertugas"
                onChange={(e) => mutateRecord((p) => ({ ...p, cashier: e.target.value }))}
                className="flex-1 sm:flex-initial px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-xs w-full sm:w-48 disabled:opacity-60"
              />
            </label>
            {metrics.status === 'balanced' ? (
              <span className="px-2.5 py-1 rounded-md text-xs font-semibold border border-[var(--success)] text-[var(--success)] self-start sm:self-auto">
                Check Balance: COCOK &#10003;
              </span>
            ) : metrics.status === 'surplus' ? (
              <span className="px-2.5 py-1 rounded-md text-xs font-semibold border border-[var(--warning)] text-[var(--warning)] self-start sm:self-auto">
                Check Balance: LEBIH +{formatRp(metrics.diff)}
              </span>
            ) : metrics.status === 'deficit' ? (
              <span className="px-2.5 py-1 rounded-md text-xs font-semibold border border-[var(--error)] text-[var(--error)] self-start sm:self-auto">
                Check Balance: KURANG {formatRp(metrics.diff)}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--secondary)] text-[var(--muted-foreground)] self-start sm:self-auto">
                Belum Check Balance
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isLocked && !isCorrecting && dirty && (
              <button
                type="button"
                disabled={saving}
                onClick={() => saveShift(false)}
                className="flex-1 sm:flex-initial px-3 py-2 min-h-[40px] rounded-lg border border-[var(--primary)] text-[var(--primary)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-semibold cursor-pointer"
              >
                {saving ? 'Menyimpan...' : 'Simpan Draft'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setWaModalText(buildWhatsAppText())}
              className="flex-1 sm:flex-initial px-3 py-2 min-h-[40px] rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
            >
              Laporan WA
            </button>
          </div>
        </div>
      </section>

      {/* Lock Banner */}
      {isLocked && (
        <section className="bg-[var(--card)] border border-[var(--success)] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs">
            <span className="font-semibold text-[var(--foreground)]">Shift Terkunci (Sudah Check Balance)</span>
            <span className="text-[var(--muted-foreground)] block sm:inline sm:ml-1.5">
              Data dilindungi dari perubahan tidak sengaja. Jika ada salah input omset/pengeluaran, klik Koreksi.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setCorrReasonInput('');
              setCorrPinInput('');
              setCorrPinErr('');
              setCorrectionModalOpen(true);
            }}
            className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-semibold shrink-0 self-start sm:self-auto cursor-pointer"
          >
            Koreksi Data Shift
          </button>
        </section>
      )}

      {/* Active Correction Banner */}
      {isCorrecting && activeCorrection && (
        <section className="bg-[var(--card)] border border-[var(--warning)] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <div className="font-semibold text-[var(--warning)]">Mode Koreksi Data Shift Aktif</div>
            <p className="text-[var(--muted-foreground)]">Alasan: &ldquo;{activeCorrection.reason}&rdquo;</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCancelCorrection}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
            >
              Batal Koreksi
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => saveShift(true)}
              className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
            >
              Simpan Koreksi &amp; Kunci
            </button>
          </div>
        </section>
      )}

      {/* KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Total Omset Shift {record.shift}</p>
          <p className="text-lg font-semibold tabular-nums mt-1">{formatRp(metrics.totalOmset)}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5 tabular-nums">
            {isCum ? `Total POS harian: ${formatRp(dailyTotalPos)}` : `${activeOutlet.name}`}
          </p>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Transaksi Tunai (Kas Masuk)</p>
          <p className="text-lg font-semibold tabular-nums mt-1">{formatRp(record.breakdown.tunai)}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {isCum ? 'Shift 2 bersih (POS − Shift 1)' : 'Masuk perputaran kas'}
          </p>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Pengeluaran Kas Kecil</p>
          <p className="text-lg font-semibold tabular-nums mt-1 text-[var(--error)]">{formatRp(metrics.totalExpense)}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{record.expenses.length} item pengeluaran</p>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Saldo Akhir Kasir (Target)</p>
          <p className="text-lg font-semibold tabular-nums mt-1 text-[var(--primary)]">{formatRp(metrics.expectedCash)}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {metrics.status === 'balanced' ? 'Status: Balance ✓' : 'Harus balance di laci'}
          </p>
        </div>
      </section>

      {/* Main 2-Column Workspace */}
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-5 items-start ${isLocked ? 'opacity-80' : ''}`}>
        <div className="lg:col-span-7 space-y-5">
          {/* Card 1: Omset & Breakdown */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--card-border)]">
              <div>
                <h2 className="text-sm font-semibold">1. Input Omset &amp; Breakdown Transaksi</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {isCum
                    ? 'Masukkan angka kumulatif layar POS (pagi–closing); omset Shift 2 dihitung otomatis.'
                    : 'Masukkan rincian transaksi per metode pembayaran pada shift ini.'}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={record.autoTotal}
                  onChange={(e) => mutateRecord((p) => ({ ...p, autoTotal: e.target.checked }))}
                  className="accent-[var(--primary)] rounded cursor-pointer"
                />
                <span>Auto-hitung Total Omset</span>
              </label>
            </div>

            {/* Shift 2 Cumulative Mode Toggle */}
            {record.shift === 2 && (
              <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--foreground)]">Mode Input Shift 2</span>
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--card)] border border-[var(--border)] self-start sm:self-auto">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleSwitchMode('cumulative')}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${isCum
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
                        }`}
                    >
                      Sesuai Layar POS (Pagi–Closing)
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleSwitchMode('standalone')}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${!isCum
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
                        }`}
                    >
                      Input Shift 2 Saja
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {isCum ? (
                    shift1Ref?.found ? (
                      <>
                        Salin langsung angka total dari layar POS saat closing — otomatis dikurangi Shift 1 (
                        <strong className="text-[var(--foreground)] tabular-nums">{formatRp(s1Total)}</strong>).
                      </>
                    ) : (
                      <span className="text-[var(--warning)] font-medium">
                        Shift 1 belum diinput untuk tanggal ini. Input Shift 1 dulu agar pengurangan akurat, atau pilih &ldquo;Input Shift 2 Saja&rdquo;.
                      </span>
                    )
                  ) : (
                    'Mode manual: masukkan nominal khusus transaksi Shift 2 saja (tanpa dikurangi Shift 1).'
                  )}
                </p>
              </div>
            )}

            {/* Total Omset Row */}
            <div className="p-3.5 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-[var(--foreground)]">
                  {isCum ? 'Total Omset POS Seharian (Pagi–Closing)' : 'Total Omset Shift (POS / Struk)'}
                </label>
                {record.autoTotal ? (
                  <span className="text-xs font-semibold tabular-nums text-[var(--primary)]">
                    {isCum ? `Omset Shift 2: ${formatRp(metrics.totalOmset)}` : 'Otomatis dari breakdown'}
                  </span>
                ) : metrics.breakdownDiff === 0 ? (
                  <span className="text-xs font-semibold text-[var(--success)]">Breakdown Cocok &#10003;</span>
                ) : (
                  <span className="text-xs font-semibold text-[var(--error)]">
                    Selisih {formatRp(metrics.breakdownDiff)}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[var(--muted-foreground)]">
                  Rp
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  readOnly={record.autoTotal}
                  disabled={isLocked}
                  value={
                    record.autoTotal
                      ? (isCum ? dailyTotalPos : metrics.totalOmset).toLocaleString('id-ID')
                      : isCum
                        ? record.posCumulative.total !== null
                          ? record.posCumulative.total.toLocaleString('id-ID')
                          : ''
                        : formatPlain(record.manualTotalOmset)
                  }
                  onChange={(e) => handleManualTotalChange(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
              <p
                className={`text-xs tabular-nums ${isCum && !record.autoTotal && record.posCumulative.total !== null && record.posCumulative.total < s1Total
                  ? 'text-[var(--error)] font-medium'
                  : 'text-[var(--muted-foreground)]'
                  }`}
              >
                {isCum && !record.autoTotal && record.posCumulative.total !== null && record.posCumulative.total < s1Total
                  ? `Total POS (${formatRp(record.posCumulative.total)}) lebih kecil dari Shift 1 (${formatRp(s1Total)})! Periksa angka POS.`
                  : isCum
                    ? `Total POS seharian ${formatRp(dailyTotalPos)} − Shift 1 ${formatRp(s1Total)} = Omset Shift 2 ${formatRp(metrics.totalOmset)}.`
                    : 'Total Omset dihitung dari Tunai + QRIS + Online Delivery + EDC/Transfer.'}
              </p>
            </div>

            {/* 4 Payment Breakdown Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {(
                [
                  { k: 'tunai' as const, label: isCum ? 'Tunai di POS (Pagi–Closing)' : 'Tunai (Cash)', dot: 'var(--chart-1)', right: '→ Kas Kecil' },
                  { k: 'qris' as const, label: isCum ? 'QRIS di POS (Pagi–Closing)' : 'QRIS', dot: 'var(--chart-2)', right: null },
                  { k: 'online' as const, label: isCum ? 'Online Delivery di POS' : 'Online Delivery', dot: 'var(--chart-3)', right: null },
                  { k: 'edc' as const, label: isCum ? 'EDC / Transfer di POS' : 'EDC / Transfer', dot: 'var(--chart-4)', right: null },
                ] as const
              ).map((item) => {
                const pct =
                  metrics.sumBreakdown > 0
                    ? Math.round((record.breakdown[item.k] / metrics.sumBreakdown) * 100)
                    : 0;
                const rawPos = record.posCumulative[item.k];
                const s1Val = s1Breakdown[item.k] || 0;
                const isUnderflow = isCum && rawPos !== null && rawPos < s1Val;

                return (
                  <div key={item.k} className="space-y-1.5">
                    <label className="flex items-center justify-between text-xs font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: item.dot }} />
                        <span>{item.label}</span>
                      </span>
                      <span className="text-[var(--muted-foreground)] font-normal tabular-nums">
                        {item.right ?? `${pct}%`}
                      </span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
                        Rp
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        disabled={isLocked}
                        placeholder={isCum && shift1Ref?.found ? `Min ${s1Val.toLocaleString('id-ID')}` : '0'}
                        value={
                          isCum
                            ? rawPos !== null
                              ? rawPos.toLocaleString('id-ID')
                              : ''
                            : formatPlain(record.breakdown[item.k])
                        }
                        onChange={(e) => handleBreakdownChange(item.k, e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                      />
                    </div>
                    {isCum && (
                      <p
                        className={`text-xs tabular-nums ${isUnderflow ? 'text-[var(--error)] font-medium' : 'text-[var(--muted-foreground)]'
                          }`}
                      >
                        {rawPos === null
                          ? `Shift 1: ${formatRp(s1Val)} · Ketik angka POS closing`
                          : isUnderflow
                            ? `Lebih kecil dari Shift 1 (${formatRp(s1Val)})! Cek angka POS.`
                            : `Shift 1: ${formatRp(s1Val)} → Shift 2: ${formatRp(record.breakdown[item.k])}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Proportion Bar */}
            <div className="space-y-1.5 pt-1">
              <div className="h-2 w-full rounded-full bg-[var(--secondary)] overflow-hidden flex">
                {metrics.sumBreakdown > 0 &&
                  parts.map((p) => {
                    const pct = (p.val / metrics.sumBreakdown) * 100;
                    return pct > 0 ? <div key={p.key} style={{ width: `${pct}%`, background: p.color }} /> : null;
                  })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)] tabular-nums">
                {parts.map((p) => {
                  const pct = metrics.sumBreakdown > 0 ? Math.round((p.val / metrics.sumBreakdown) * 100) : 0;
                  return (
                    <span key={p.key} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
                      {p.label} {pct}%
                    </span>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Card 2: Pengeluaran Kas Kecil */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--card-border)]">
              <div>
                <h2 className="text-sm font-semibold">2. Pengeluaran Kas Kecil Outlet</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Terkategori per peruntukan &amp; dilengkapi deteksi anti double input.
                </p>
              </div>
              <span className="text-xs font-semibold tabular-nums px-2.5 py-1 rounded-md bg-[var(--secondary)]">
                {formatRp(metrics.totalExpense)}
              </span>
            </div>

            {/* Shift 1 Expense Reference (shown on Shift 2) */}
            {record.shift === 2 && shift1Ref && shift1Ref.expenses.length > 0 && (
              <div className="p-3 rounded-lg bg-[var(--background)] border border-dashed border-[var(--border)] space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2 font-medium text-[var(--foreground)]">
                  <span>Sudah dicatat di Shift 1 (jangan input ulang)</span>
                  <span className="tabular-nums text-[var(--muted-foreground)]">
                    {shift1Ref.expenses.length} item &middot;{' '}
                    {formatRp(shift1Ref.expenses.reduce((s, e) => s + e.amount, 0))}
                  </span>
                </div>
                <div className="space-y-1 text-[var(--muted-foreground)]">
                  {shift1Ref.expenses.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        &bull; {e.desc} ({e.category}
                        {e.time ? `, ${e.time}` : ''})
                      </span>
                      <span className="tabular-nums shrink-0">{formatRp(e.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add Expense Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitExpense(false);
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
            >
              <div className="sm:col-span-5 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Keterangan Pengeluaran</label>
                <input
                  type="text"
                  disabled={isLocked || addingExp}
                  placeholder="Contoh: Es batu, susu, roti toast, tisu"
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
              <div className="sm:col-span-3 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Peruntukan / Kategori</label>
                <select
                  disabled={isLocked || addingExp}
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  {settings.expenseCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Nominal (Rp)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={isLocked || addingExp}
                  placeholder="0"
                  value={expAmountStr}
                  onChange={(e) => setExpAmountStr(formatPlain(parseNum(e.target.value)))}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-xs font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
              <div className="sm:col-span-1">
                <button
                  type="submit"
                  disabled={isLocked || addingExp}
                  className="w-full py-2.5 sm:py-2 px-3 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  <span className="sm:hidden">+ Tambah Pengeluaran</span>
                  <span className="hidden sm:inline">+</span>
                </button>
              </div>
            </form>

            {/* Expense List */}
            <div className="divide-y divide-[var(--card-border)]">
              {record.expenses.length === 0 ? (
                <div className="py-5 text-center text-xs text-[var(--muted-foreground)]">
                  Belum ada pengeluaran kas kecil pada shift ini.
                </div>
              ) : (
                record.expenses.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--foreground)] truncate">{item.desc}</div>
                      <div className="text-[var(--muted-foreground)] flex items-center gap-2 mt-1">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[var(--foreground)] font-medium">
                          {item.category}
                        </span>
                        <span className="tabular-nums">{item.time}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="font-semibold tabular-nums text-[var(--error)]">-{formatRp(item.amount)}</span>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => handleRemoveExpense(item.id)}
                          className="px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--error)] cursor-pointer"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {expenseCategorySubtotals.length > 0 && (
              <div className="pt-2.5 border-t border-[var(--card-border)] flex flex-wrap items-center gap-2 text-xs tabular-nums">
                <span className="text-[var(--muted-foreground)]">Ringkasan:</span>
                {expenseCategorySubtotals.map(([cat, amt]) => (
                  <span
                    key={cat}
                    className="px-2 py-0.5 rounded-md bg-[var(--background)] border border-[var(--border)]"
                  >
                    {cat}: <strong>{formatRp(amt)}</strong>
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Running Cash Ledger & Check Balance */}
        <aside className="lg:col-span-5 lg:sticky lg:top-4 space-y-4">
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="pb-3 border-b border-[var(--card-border)]">
              <h2 className="text-sm font-semibold">3. Kas Kecil &amp; Check Balance Shift</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                {activeOutlet.name} &middot; {formatDateIndo(record.date)} &middot; Shift {record.shift}
              </p>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--foreground)]">
                    {prevBalance.found ? 'Saldo Kas Sebelumnya (Kumulatif)' : 'Saldo Kas Awal Pertama'}
                  </span>
                  <span className="text-[var(--muted-foreground)]">
                    {prevBalance.found
                      ? record.openingCashSource === 'carryover'
                        ? `Otomatis dari ${prevBalance.label}`
                        : `Manual (sebelumnya: ${formatRp(prevBalance.amount)})`
                      : 'Belum ada riwayat sebelumnya'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
                      Rp
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={isLocked}
                      value={record.openingCash === 0 ? '0' : formatPlain(record.openingCash)}
                      onChange={(e) =>
                        mutateRecord((p) => ({
                          ...p,
                          openingCash: parseNum(e.target.value),
                          openingCashSource: 'manual',
                        }))
                      }
                      className="w-full pl-9 pr-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    />
                  </div>
                  {prevBalance.found && record.openingCashSource === 'manual' && !isLocked && (
                    <button
                      type="button"
                      onClick={() =>
                        mutateRecord((p) => ({
                          ...p,
                          openingCash: prevBalance.amount,
                          openingCashSource: 'carryover',
                        }))
                      }
                      className="px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium shrink-0 cursor-pointer"
                    >
                      Sinkron
                    </button>
                  )}
                </div>
              </div>

              <div className="px-1 space-y-2 tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--muted-foreground)]">
                    {isCum ? '+ Tunai Shift 2 (otomatis: POS − Shift 1)' : '+ Transaksi Tunai Shift Ini'}
                  </span>
                  <span className="font-medium shrink-0">+ {formatRp(record.breakdown.tunai)}</span>
                </div>
                <div className="flex items-center justify-between pb-2 border-b border-dashed border-[var(--border)]">
                  <span className="text-[var(--muted-foreground)]">Total Perputaran Tunai</span>
                  <span className="font-semibold">{formatRp(metrics.accumulatedCash)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted-foreground)]">- Total Pengeluaran Kas Kecil</span>
                  <span className="font-medium text-[var(--error)]">- {formatRp(metrics.totalExpense)}</span>
                </div>
                {metrics.drawerKasbon > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--muted-foreground)]">- Kasbon Karyawan (Dari Laci)</span>
                    <span className="font-medium text-[var(--warning)]">- {formatRp(metrics.drawerKasbon)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted-foreground)]">
                    - Total Setor ke Owner / Bank
                  </span>
                  <span className="font-medium text-[var(--primary)]">
                    - {formatRp(metrics.cashDrop)}
                  </span>
                </div>

                {/* Cash Drop (Setor ke Owner / Bank) Tracker Box */}
                <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--foreground)]">Riwayat Setor Shift Ini</span>
                    <span className="text-[var(--muted-foreground)] tabular-nums">
                      {(record.cashDrops || []).length} transaksi
                    </span>
                  </div>

                  {!isLocked && (
                    <form onSubmit={submitCashDrop} className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        <select
                          disabled={isLocked || addingDrop}
                          value={dropMethod}
                          onChange={(e) => setDropMethod(e.target.value)}
                          className="px-2.5 py-2 sm:py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                        >
                          {DEFAULT_CASH_DROP_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--muted-foreground)]">
                            Rp
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            disabled={isLocked || addingDrop}
                            placeholder="Nominal setor"
                            value={dropAmountStr}
                            onChange={(e) => setDropAmountStr(formatPlain(parseNum(e.target.value)))}
                            className="w-full pl-8 pr-2.5 py-2 sm:py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-right text-xs font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                        <input
                          type="text"
                          disabled={isLocked || addingDrop}
                          placeholder="Keterangan (misal: Transfer BCA / Diambil Owner)"
                          value={dropNote}
                          onChange={(e) => setDropNote(e.target.value)}
                          className="flex-1 px-2.5 py-2 sm:py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                        />
                        <button
                          type="submit"
                          disabled={isLocked || addingDrop}
                          className="px-3 py-2 sm:py-1.5 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 shrink-0 cursor-pointer"
                        >
                          {addingDrop ? '...' : '+ Setor'}
                        </button>
                      </div>
                    </form>
                  )}

                  {(record.cashDrops || []).length === 0 ? (
                    record.cashDrop > 0 ? (
                      <div className="text-[var(--muted-foreground)] text-xs">
                        Tercatat setoran shift: <strong className="text-[var(--foreground)]">{formatRp(record.cashDrop)}</strong>
                      </div>
                    ) : (
                      <div className="text-[var(--muted-foreground)] text-xs">
                        Belum ada setoran ke Owner / Bank pada shift ini.
                      </div>
                    )
                  ) : (
                    <div className="divide-y divide-[var(--card-border)]">
                      {record.cashDrops.map((d) => (
                        <div key={d.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded bg-[var(--secondary)] font-medium">
                                {d.method}
                              </span>
                              {d.time && <span className="text-[var(--muted-foreground)] tabular-nums">{d.time}</span>}
                            </div>
                            {d.note && <div className="text-[var(--muted-foreground)] truncate mt-0.5">{d.note}</div>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-semibold text-[var(--primary)] tabular-nums">
                              -{formatRp(d.amount)}
                            </span>
                            {!isLocked && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCashDrop(d.id)}
                                className="px-1.5 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--error)] cursor-pointer"
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-[var(--border)] text-sm">
                  <span className="font-semibold">Saldo Akhir Seharusnya</span>
                  <span className="font-bold text-[var(--primary)] text-base">{formatRp(metrics.expectedCash)}</span>
                </div>
              </div>
            </div>

            {/* Check Balance Section */}
            <div className="pt-3 border-t border-[var(--card-border)] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold">Uang Fisik di Laci Kasir</label>
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => setShowDenom((v) => !v)}
                    className="text-xs text-[var(--primary)] hover:underline cursor-pointer"
                  >
                    {showDenom ? 'Tutup Hitung Pecahan' : 'Hitung Pecahan Uang'}
                  </button>
                )}
              </div>

              {showDenom && !isLocked && (
                <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">Kalkulator Pecahan Kasir</span>
                    <button
                      type="button"
                      onClick={() => mutateRecord((p) => ({ ...p, denomCounts: {} }))}
                      className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {DENOMS.map((d) => (
                      <div
                        key={d}
                        className="flex items-center justify-between gap-2 text-xs bg-[var(--card)] border border-[var(--border)] rounded-md px-2 py-1.5"
                      >
                        <span className="tabular-nums font-medium text-[var(--muted-foreground)]">
                          {d.toLocaleString('id-ID')}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-[var(--muted-foreground)]">&times;</span>
                          <input
                            type="number"
                            min={0}
                            value={record.denomCounts?.[String(d)] || ''}
                            placeholder="0"
                            onChange={(e) => {
                              const cnt = Math.max(0, parseInt(e.target.value, 10) || 0);
                              mutateRecord((p) => ({
                                ...p,
                                denomCounts: { ...p.denomCounts, [String(d)]: cnt },
                              }));
                            }}
                            className="w-12 px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--background)] text-right tabular-nums text-xs"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] text-xs">
                    <span className="text-[var(--muted-foreground)]">
                      Total: <strong className="text-[var(--foreground)] tabular-nums">{formatRp(denomTotal)}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => mutateRecord((p) => ({ ...p, actualCash: denomTotal }))}
                      className="px-2.5 py-1 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] font-medium cursor-pointer"
                    >
                      Terapkan
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[var(--muted-foreground)]">
                    Rp
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={isLocked}
                    placeholder="Hitung & masukkan uang fisik"
                    value={record.actualCash !== null ? record.actualCash.toLocaleString('id-ID') : ''}
                    onChange={(e) =>
                      mutateRecord((p) => ({ ...p, actualCash: parseNullableNum(e.target.value) }))
                    }
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                </div>
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => mutateRecord((p) => ({ ...p, actualCash: Math.max(0, metrics.expectedCash) }))}
                    className="px-2.5 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium shrink-0 cursor-pointer"
                  >
                    Pas
                  </button>
                )}
              </div>

              {/* Balance Status Box */}
              <div
                className={`p-3.5 rounded-lg border bg-[var(--background)] text-xs space-y-1 ${!metrics.hasActual
                  ? 'border-[var(--border)]'
                  : metrics.diff === 0
                    ? 'border-[var(--success)]'
                    : (metrics.diff ?? 0) > 0
                      ? 'border-[var(--warning)]'
                      : 'border-[var(--error)]'
                  }`}
              >
                {!metrics.hasActual ? (
                  <>
                    <div className="font-medium">Menunggu Penghitungan Uang Fisik</div>
                    <p className="text-[var(--muted-foreground)]">
                      Hitung uang tunai di laci kasir lalu masukkan nominalnya untuk Check Balance.
                    </p>
                  </>
                ) : metrics.diff === 0 ? (
                  <>
                    <div className="flex items-center justify-between font-semibold text-[var(--success)]">
                      <span>SALDO BALANCE &#10003;</span>
                      <span className="tabular-nums">Selisih Rp 0</span>
                    </div>
                    <p className="text-[var(--muted-foreground)]">
                      Uang fisik ({formatRp(record.actualCash)}) cocok tepat dengan saldo akhir kas berjalan.
                    </p>
                  </>
                ) : (metrics.diff ?? 0) > 0 ? (
                  <>
                    <div className="flex items-center justify-between font-semibold text-[var(--warning)]">
                      <span>SELISIH LEBIH (SURPLUS)</span>
                      <span className="tabular-nums">+{formatRp(metrics.diff)}</span>
                    </div>
                    <p className="text-[var(--muted-foreground)]">
                      Uang fisik lebih banyak {formatRp(metrics.diff)} dari target ({formatRp(metrics.expectedCash)}).
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between font-semibold text-[var(--error)]">
                      <span>SELISIH KURANG (DEFISIT)</span>
                      <span className="tabular-nums">{formatRp(metrics.diff)}</span>
                    </div>
                    <p className="text-[var(--muted-foreground)]">
                      Uang fisik kurang {formatRp(Math.abs(metrics.diff || 0))} dari target ({formatRp(metrics.expectedCash)}).
                    </p>
                  </>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">
                  Catatan Shift / Keterangan Selisih (opsional)
                </label>
                <textarea
                  rows={2}
                  disabled={isLocked}
                  placeholder="Contoh: Uang kembalian kurang receh, atau semua cocok."
                  value={record.balanceNote}
                  onChange={(e) => mutateRecord((p) => ({ ...p, balanceNote: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>

              <button
                type="button"
                disabled={isLocked || saving}
                onClick={() => saveShift(true)}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
              >
                {saving
                  ? 'Menyimpan...'
                  : isCorrecting
                    ? 'Simpan Koreksi & Kunci Ulang Shift'
                    : isLocked
                      ? 'Shift Sudah Terkunci (Check Balance ✓)'
                      : 'Simpan & Konfirmasi Check Balance Shift'}
              </button>
            </div>
          </section>
        </aside>
      </div>

      {/* Shift Correction Logs */}
      {record.correctionLogs.length > 0 && (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-2.5">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--card-border)]">
            <h3 className="text-xs font-semibold">Riwayat Koreksi Shift Ini</h3>
            <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
              {record.correctionLogs.length} koreksi tercatat
            </span>
          </div>
          <div className="divide-y divide-[var(--card-border)]">
            {record.correctionLogs.map((log) => (
              <div key={log.id} className="py-2.5 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{log.actor}</span>
                  <span className="text-[var(--muted-foreground)] tabular-nums">{formatDateTimeShort(log.at)}</span>
                </div>
                <div className="text-[var(--muted-foreground)]">
                  Alasan: <span className="text-[var(--foreground)]">{log.reason}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5 tabular-nums">
                  {log.changes.map((ch, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-[var(--background)] border border-[var(--border)]">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Duplicate Expense Warning Modal */}
      {dupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--warning)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--warning)]">
                Peringatan Potensi Double Input Pengeluaran
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Pengeluaran serupa sudah tercatat hari ini di outlet ini. Periksa nota agar tidak terhitung ganda.
              </p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-1">
                <div className="text-[var(--muted-foreground)] font-medium">
                  Sudah Tercatat (Shift {dupModal.existing.shift}
                  {dupModal.existing.time ? ` · ${dupModal.existing.time}` : ''})
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {dupModal.existing.desc} ({dupModal.existing.category})
                  </span>
                  <span className="font-semibold tabular-nums text-[var(--error)]">
                    {formatRp(dupModal.existing.amount)}
                  </span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--warning)] space-y-1">
                <div className="text-[var(--warning)] font-medium">Akan Diinput Sekarang (Shift {record.shift})</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {dupModal.incoming.desc} ({dupModal.incoming.category})
                  </span>
                  <span className="font-semibold tabular-nums text-[var(--error)]">
                    {formatRp(dupModal.incoming.amount)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const inc = dupModal.incoming;
                  setDupModal(null);
                  submitExpense(true, inc);
                }}
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium hover:bg-[var(--secondary)] cursor-pointer"
              >
                Tetap Tambahkan
              </button>
              <button
                type="button"
                onClick={() => setDupModal(null)}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
              >
                Batal (Jangan Input)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controlled Correction Unlock Modal */}
      {correctionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Koreksi Data Shift Terkunci</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Setiap perubahan omset, pengeluaran, atau saldo akan dicatat otomatis ke <strong>Jejak Audit Koreksi</strong>.
              </p>
            </div>
            <form onSubmit={handleUnlockCorrection} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium block">Alasan Koreksi (wajib)</label>
                <textarea
                  rows={2}
                  required
                  value={corrReasonInput}
                  onChange={(e) => setCorrReasonInput(e.target.value)}
                  placeholder="Contoh: Salah ketik QRIS, nominal di mesin Rp 1.150.000"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
              {settings.requireOwnerPinForCorrection && !isOwner && (
                <div className="space-y-1">
                  <label className="text-xs font-medium block">Verifikasi PIN Owner (wajib)</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    required
                    value={corrPinInput}
                    onChange={(e) => {
                      setCorrPinInput(e.target.value.replace(/[^0-9]/g, ''));
                      setCorrPinErr('');
                    }}
                    placeholder="Masukkan PIN Owner"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                </div>
              )}
              {corrPinErr && <p className="text-xs text-[var(--error)] font-medium">{corrPinErr}</p>}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCorrectionModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
                >
                  Buka Mode Koreksi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Summary Modal */}
      {waModalText !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Ringkasan Shift untuk WhatsApp</h3>
              <button
                type="button"
                onClick={() => setWaModalText(null)}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] px-2 py-1 cursor-pointer"
              >
                Tutup
              </button>
            </div>
            <textarea
              readOnly
              rows={15}
              value={waModalText}
              className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--background)] font-mono text-xs leading-relaxed"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setWaModalText(null)}
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  let copied = false;
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(waModalText);
                      copied = true;
                    }
                  } catch {
                    copied = false;
                  }
                  if (!copied) {
                    try {
                      const ta = document.createElement('textarea');
                      ta.value = waModalText;
                      ta.style.position = 'fixed';
                      ta.style.opacity = '0';
                      document.body.appendChild(ta);
                      ta.focus();
                      ta.select();
                      copied = document.execCommand('copy');
                      document.body.removeChild(ta);
                    } catch {
                      copied = false;
                    }
                  }
                  if (copied) {
                    onToast('Laporan WhatsApp disalin!', 'success');
                    setWaModalText(null);
                  } else {
                    onToast('Gagal menyalin otomatis. Silakan salin teks langsung dari kotak.', 'warning');
                  }
                }}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
              >
                Salin Teks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateIndo, formatPlain, formatRp, getLocalDateStr, parseNum } from '@/lib/calc';
import type { CashAdvanceRecord, CashAdvanceSource, EmployeePublic, OutletPublic, UserRole } from '@/lib/types';

interface KasbonSummaryRow {
  employeeId: string;
  employeeName: string;
  roleTitle: string;
  outletId: string;
  payType: 'monthly' | 'daily';
  kasbonLimit: number;
  totalTaken: number;
  kasbonRemaining: number;
  loanRemaining: number;
  monthlyInstallmentDue: number;
  totalRemaining: number;
  activeCount: number;
  activeLoanCount: number;
}

interface CashAdvanceViewProps {
  role: UserRole;
  outlets: OutletPublic[];
  selectedOutletId: string;
  currentEmployee?: EmployeePublic | null;
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

const IDLE_LOCK_MS = 120_000;

export default function CashAdvanceView({
  role,
  outlets,
  selectedOutletId,
  currentEmployee,
  onToast,
}: CashAdvanceViewProps) {
  const isOwner = role === 'owner';

  // Owner state
  const [loading, setLoading] = useState(isOwner);
  const [advances, setAdvances] = useState<CashAdvanceRecord[]>([]);
  const [summaryByEmployee, setSummaryByEmployee] = useState<KasbonSummaryRow[]>([]);
  const [ownerTab, setOwnerTab] = useState<'summary' | 'history'>('summary');

  // Owner minimalist filters
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithDebt, setOnlyWithDebt] = useState(true);
  const [filterOutlet, setFilterOutlet] = useState(isOwner ? 'all' : selectedOutletId);
  const [typeFilter, setTypeFilter] = useState<'all' | 'kasbon' | 'loan'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paid'>('all');
  const [historyEmpFilter, setHistoryEmpFilter] = useState('all');

  // Owner New Installment Loan modal
  const [loanModalOpen, setLoanModalOpen] = useState(false);
  const [loanEmpId, setLoanEmpId] = useState('');
  const [loanDate, setLoanDate] = useState(getLocalDateStr(0));
  const [loanAmountStr, setLoanAmountStr] = useState('');
  const [loanTenor, setLoanTenor] = useState(12);
  const [loanInstallmentStr, setLoanInstallmentStr] = useState('');
  const [loanInstallmentCustom, setLoanInstallmentCustom] = useState(false);
  const [loanNote, setLoanNote] = useState('');
  const [savingLoan, setSavingLoan] = useState(false);

  // Non-owner PIN Gate state
  const [loadingEmps, setLoadingEmps] = useState(!isOwner);
  const [gateEmployees, setGateEmployees] = useState<EmployeePublic[]>([]);
  const [gateEmpId, setGateEmpId] = useState(currentEmployee?.id || '');
  const [gatePin, setGatePin] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [gateError, setGateError] = useState('');
  const [unlocked, setUnlocked] = useState<{
    employee: EmployeePublic;
    pin: string;
    summary: KasbonSummaryRow;
    advances: CashAdvanceRecord[];
  } | null>(null);

  // New kasbon form (unlocked crew/outlet only — regular short-term kasbon)
  const [date, setDate] = useState(getLocalDateStr(0));
  const [shift, setShift] = useState<1 | 2>(1);
  const [sourceMode, setSourceMode] = useState<CashAdvanceSource>('drawer');
  const [drawerStr, setDrawerStr] = useState('');
  const [ownerStr, setOwnerStr] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Over-limit modal
  const [limitModal, setLimitModal] = useState<{ message: string } | null>(null);

  // Manual repayment modal (Owner)
  const [repayTarget, setRepayTarget] = useState<CashAdvanceRecord | null>(null);
  const [repayAmountStr, setRepayAmountStr] = useState('');
  const [repayMethod, setRepayMethod] = useState<'cash_return' | 'transfer_return'>('transfer_return');
  const [repayNote, setRepayNote] = useState('');

  const loadOwnerData = useCallback(
    async (signal?: AbortSignal) => {
      if (!isOwner) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filterOutlet !== 'all') params.set('outletId', filterOutlet);
        const res = await fetch(`/api/cash-advances?${params.toString()}`, { cache: 'no-store', signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat data kasbon.');
        if (signal?.aborted) return;

        setAdvances(data.advances || []);
        const summaries: KasbonSummaryRow[] = data.summaryByEmployee || [];
        setSummaryByEmployee(summaries);
        setLoanEmpId((prev) =>
          summaries.some((s) => s.employeeId === prev) ? prev : summaries[0]?.employeeId || ''
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onToast(err instanceof Error ? err.message : 'Gagal memuat kasbon.', 'error');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filterOutlet, isOwner, onToast]
  );

  useEffect(() => {
    if (!isOwner) return;
    const controller = new AbortController();
    loadOwnerData(controller.signal);
    return () => controller.abort();
  }, [isOwner, loadOwnerData]);

  // Load outlet employee dropdown for PIN gate (non-owner)
  useEffect(() => {
    if (isOwner) return;
    const controller = new AbortController();
    setLoadingEmps(true);
    const params = selectedOutletId ? `?outletId=${encodeURIComponent(selectedOutletId)}` : '';
    fetch(`/api/employees${params}`, { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Gagal memuat daftar kru.');
        const list: EmployeePublic[] = Array.isArray(d.employees) ? d.employees : [];
        setGateEmployees(list);
        setGateEmpId((prev) => {
          if (list.some((e) => e.id === prev)) return prev;
          if (currentEmployee && list.some((e) => e.id === currentEmployee.id)) return currentEmployee.id;
          return list[0]?.id || '';
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onToast(err instanceof Error ? err.message : 'Gagal memuat daftar kru.', 'error');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingEmps(false);
      });

    return () => controller.abort();
  }, [isOwner, selectedOutletId, currentEmployee, onToast]);

  const lockKasbon = useCallback(
    (reason?: string) => {
      setUnlocked(null);
      setGatePin('');
      setGateError('');
      setDrawerStr('');
      setOwnerStr('');
      setNote('');
      if (reason) onToast(reason, 'info');
    },
    [onToast]
  );

  // Auto-lock kasbon after 2 minutes of inactivity on shared outlet device
  useEffect(() => {
    if (isOwner || !unlocked) return;
    let timer = window.setTimeout(() => {
      lockKasbon('Akses kasbon dikunci otomatis setelah 2 menit tidak aktif.');
    }, IDLE_LOCK_MS);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lockKasbon('Akses kasbon dikunci otomatis setelah 2 menit tidak aktif.');
      }, IDLE_LOCK_MS);
    };

    window.addEventListener('pointerdown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('touchstart', resetTimer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
    };
  }, [isOwner, unlocked, lockKasbon]);

  async function fetchUnlockedCrewKasbon(employeeId: string, pin: string) {
    const res = await fetch('/api/cash-advances/crew-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, pin }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Gagal membuka data kasbon.');
    }
    setUnlocked({
      employee: data.employee,
      pin,
      summary: data.summary,
      advances: Array.isArray(data.advances) ? data.advances : [],
    });
  }

  async function handleUnlockSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gateEmpId) return setGateError('Pilih nama kru terlebih dahulu.');
    if (!gatePin.trim()) return setGateError('Masukkan PIN pribadi Anda.');

    setUnlocking(true);
    setGateError('');
    try {
      await fetchUnlockedCrewKasbon(gateEmpId, gatePin.trim());
      setGatePin('');
    } catch (err) {
      setGateError(err instanceof Error ? err.message : 'PIN pribadi salah.');
    } finally {
      setUnlocking(false);
    }
  }

  const drawerAmount = sourceMode === 'owner_transfer' ? 0 : parseNum(drawerStr);
  const ownerTransferAmount = sourceMode === 'drawer' ? 0 : parseNum(ownerStr);
  const totalKasbon = drawerAmount + ownerTransferAmount;

  async function submitKasbon(forceOverLimit = false) {
    if (!unlocked) return onToast('Buka akses kasbon dengan PIN terlebih dahulu.', 'warning');
    if (totalKasbon <= 0) return onToast('Masukkan nominal kasbon yang valid.', 'warning');

    setSubmitting(true);
    try {
      const res = await fetch('/api/cash-advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'kasbon',
          employeeId: unlocked.employee.id,
          pin: unlocked.pin,
          outletId: selectedOutletId,
          date,
          shift,
          drawerAmount,
          ownerTransferAmount,
          note: note.trim(),
          forceOverLimit,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.limitExceeded) {
        setLimitModal({ message: data.error });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Gagal mencatat kasbon.');

      setDrawerStr('');
      setOwnerStr('');
      setNote('');
      onToast(
        drawerAmount > 0
          ? `Kasbon ${formatRp(totalKasbon)} tercatat (Rp ${drawerAmount.toLocaleString('id-ID')} memotong kas laci Shift ${shift}).`
          : `Kasbon ${formatRp(totalKasbon)} via Transfer Owner tercatat.`,
        'success'
      );
      await fetchUnlockedCrewKasbon(unlocked.employee.id, unlocked.pin);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mencatat kasbon.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function updateLoanAmountOrTenor(nextAmountStr: string, nextTenor: number) {
    setLoanAmountStr(nextAmountStr);
    setLoanTenor(nextTenor);
    if (!loanInstallmentCustom) {
      const amt = parseNum(nextAmountStr);
      const calcInst = amt > 0 && nextTenor > 0 ? Math.ceil(amt / nextTenor) : 0;
      setLoanInstallmentStr(calcInst > 0 ? formatPlain(calcInst) : '');
    }
  }

  async function submitNewLoan(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseNum(loanAmountStr);
    const inst = parseNum(loanInstallmentStr) || (amt > 0 ? Math.ceil(amt / loanTenor) : 0);
    if (!loanEmpId) return onToast('Pilih karyawan terlebih dahulu.', 'warning');
    if (amt <= 0) return onToast('Masukkan total nominal pinjaman.', 'warning');
    if (loanTenor < 2) return onToast('Tenor pinjaman berjangka minimal 2 bulan.', 'warning');

    setSavingLoan(true);
    try {
      const res = await fetch('/api/cash-advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'loan',
          employeeId: loanEmpId,
          date: loanDate,
          amount: amt,
          tenorMonths: loanTenor,
          installmentAmount: inst,
          note: loanNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mencatat pinjaman berjangka.');
      setLoanModalOpen(false);
      setLoanAmountStr('');
      setLoanInstallmentStr('');
      setLoanInstallmentCustom(false);
      setLoanNote('');
      onToast(
        `Pinjaman berjangka ${formatRp(amt)} (${loanTenor} bln · ${formatRp(inst)}/bln) berhasil dicatat.`,
        'success'
      );
      loadOwnerData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mencatat pinjaman.', 'error');
    } finally {
      setSavingLoan(false);
    }
  }

  async function submitManualRepayment(e: React.FormEvent) {
    e.preventDefault();
    if (!repayTarget) return;
    const amt = parseNum(repayAmountStr);
    if (amt <= 0) return onToast('Masukkan nominal pelunasan.', 'warning');

    try {
      const res = await fetch('/api/cash-advances', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cashAdvanceId: repayTarget.id,
          amount: amt,
          method: repayMethod,
          note: repayNote.trim() || 'Cicilan / Pelunasan manual',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mencatat pelunasan.');
      setRepayTarget(null);
      setRepayAmountStr('');
      setRepayNote('');
      onToast('Pembayaran cicilan/pelunasan dicatat.', 'success');
      loadOwnerData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mencatat pelunasan.', 'error');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Hapus catatan ini? Jika berasal dari laci kasir, saldo shift terkait akan dihitung ulang.')) {
      return;
    }
    try {
      const res = await fetch(`/api/cash-advances?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus data.');
      onToast('Data dihapus.', 'info');
      loadOwnerData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus.', 'error');
    }
  }

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const activeAdvancesList = isOwner ? advances : unlocked?.advances || [];

  const filteredSummaryRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return summaryByEmployee
      .filter((r) => {
        if (onlyWithDebt && r.totalRemaining <= 0) return false;
        if (q && !r.employeeName.toLowerCase().includes(q) && !r.roleTitle.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.totalRemaining - a.totalRemaining || a.employeeName.localeCompare(b.employeeName));
  }, [summaryByEmployee, onlyWithDebt, searchQuery]);

  const filteredAdvances = useMemo(() => {
    return activeAdvancesList.filter((a) => {
      if (typeFilter === 'kasbon' && a.type === 'loan') return false;
      if (typeFilter === 'loan' && a.type !== 'loan') return false;
      if (statusFilter === 'active' && a.remainingAmount <= 0) return false;
      if (statusFilter === 'paid' && a.remainingAmount > 0) return false;
      if (isOwner && historyEmpFilter !== 'all' && a.employeeId !== historyEmpFilter) return false;
      return true;
    });
  }, [activeAdvancesList, typeFilter, statusFilter, isOwner, historyEmpFilter]);

  const ownerKpis = useMemo(() => {
    const kasbonRemaining = summaryByEmployee.reduce((s, e) => s + e.kasbonRemaining, 0);
    const loanRemaining = summaryByEmployee.reduce((s, e) => s + e.loanRemaining, 0);
    const monthlyDue = summaryByEmployee.reduce((s, e) => s + e.monthlyInstallmentDue, 0);
    const totalRemainingAll = kasbonRemaining + loanRemaining;
    const totalFromDrawer = advances.filter((a) => a.remainingAmount > 0).reduce((s, a) => s + a.drawerAmount, 0);
    const totalFromOwner = advances
      .filter((a) => a.remainingAmount > 0)
      .reduce((s, a) => s + a.ownerTransferAmount, 0);
    const indebtedCrewCount = summaryByEmployee.filter((e) => e.totalRemaining > 0).length;
    return {
      kasbonRemaining,
      loanRemaining,
      monthlyDue,
      totalRemainingAll,
      totalFromDrawer,
      totalFromOwner,
      indebtedCrewCount,
    };
  }, [summaryByEmployee, advances]);

  function exportKasbonCsv() {
    if (filteredAdvances.length === 0) return onToast('Tidak ada data untuk diekspor.', 'warning');
    const headers = [
      'Tanggal',
      'Karyawan',
      'Outlet',
      'Jenis',
      'Tenor (Bln)',
      'Cicilan/Bln',
      'Sumber Dana',
      'Dari Laci',
      'Transfer Owner',
      'Total',
      'Sudah Dibayar',
      'Sisa',
      'Status',
      'Keterangan',
    ];
    const rows = filteredAdvances.map((a) => [
      a.date,
      a.employeeName,
      outletMap.get(a.outletId)?.name || a.outletId,
      a.type === 'loan' ? 'Pinjaman Berjangka' : 'Kasbon',
      a.tenorMonths || 1,
      a.installmentAmount || 0,
      a.source === 'drawer' ? 'Laci Kasir' : a.source === 'owner_transfer' ? 'Transfer Owner' : 'Gabungan',
      a.drawerAmount,
      a.ownerTransferAmount,
      a.amount,
      a.paidAmount,
      a.remainingAmount,
      a.status === 'paid' ? 'Lunas' : a.status === 'partial' ? 'Dicicil' : 'Belum Lunas',
      a.note,
    ]);
    const csv =
      '\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bara-coffee-kasbon-pinjaman-${getLocalDateStr(0)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast('CSV Rekap Kasbon & Pinjaman diunduh.', 'success');
  }

  // Non-owner PIN Gate Screen
  if (!isOwner && !unlocked) {
    return (
      <div className="max-w-md mx-auto py-2">
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[var(--secondary)] text-[11px] font-semibold text-[var(--primary)]">
              Dilindungi PIN Pribadi
            </div>
            <h2 className="text-sm font-semibold">Buka Menu Kasbon Pribadi</h2>
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              Mencegah input kasbon atas nama orang lain. Masukkan PIN pribadi Anda untuk melihat saldo kasbon/pinjaman
              atau mengajukan kasbon di{' '}
              <strong className="text-[var(--foreground)]">{outletMap.get(selectedOutletId)?.name || selectedOutletId}</strong>.
            </p>
          </div>

          {loadingEmps ? (
            <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">Memuat daftar kru...</div>
          ) : (
            <form onSubmit={handleUnlockSubmit} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="kasbon-gate-emp" className="text-xs text-[var(--muted-foreground)] block">
                  Nama Kru
                </label>
                <select
                  id="kasbon-gate-emp"
                  value={gateEmpId}
                  onChange={(e) => {
                    setGateEmpId(e.target.value);
                    setGateError('');
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-xs sm:text-sm font-medium"
                >
                  {gateEmployees.length === 0 && <option value="">Belum ada kru aktif di outlet ini</option>}
                  {gateEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} — {emp.roleTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="kasbon-gate-pin" className="text-xs text-[var(--muted-foreground)] block">
                  PIN Pribadi
                </label>
                <input
                  id="kasbon-gate-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="off"
                  placeholder="••••"
                  value={gatePin}
                  onChange={(e) => {
                    setGatePin(e.target.value.replace(/[^0-9]/g, ''));
                    setGateError('');
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-center text-lg tracking-[0.35em] font-semibold tabular-nums"
                />
                {gateError && <p className="text-xs text-[var(--error)] font-medium text-center pt-0.5">{gateError}</p>}
              </div>

              <button
                type="submit"
                disabled={unlocking || !gateEmpId || !gatePin}
                className="w-full py-2.5 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {unlocking ? 'Memverifikasi PIN...' : 'Buka Akses Kasbon'}
              </button>
            </form>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isOwner ? (
        <>
          {/* Minimalist Owner Header */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Rekap Kasbon &amp; Pinjaman Berjangka</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                Ringkasan minimalis per kru. Pinjaman berjangka dicicil otomatis tiap bulan di Payroll.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setLoanModalOpen(true)}
                className="px-3 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 cursor-pointer"
              >
                + Pinjaman Berjangka
              </button>
              <button
                type="button"
                onClick={exportKasbonCsv}
                className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
              >
                CSV
              </button>
            </div>
          </section>

          {/* Slim 4-Stat Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 tabular-nums">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[11px] text-[var(--muted-foreground)]">Sisa Kasbon</p>
              <p className="text-base font-semibold text-[var(--warning)] mt-0.5">
                {formatRp(ownerKpis.kasbonRemaining)}
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)]">Potong penuh gaji</p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[11px] text-[var(--muted-foreground)]">Sisa Pinjaman Berjangka</p>
              <p className="text-base font-semibold text-[var(--primary)] mt-0.5">
                {formatRp(ownerKpis.loanRemaining)}
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Cicilan ~{formatRp(ownerKpis.monthlyDue)}/bln
              </p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[11px] text-[var(--muted-foreground)]">Total Tanggungan</p>
              <p className="text-base font-semibold text-[var(--error)] mt-0.5">
                {formatRp(ownerKpis.totalRemainingAll)}
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)] truncate">
                Laci {formatRp(ownerKpis.totalFromDrawer)} · Owner {formatRp(ownerKpis.totalFromOwner)}
              </p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[11px] text-[var(--muted-foreground)]">Kru Aktif Berhutang</p>
              <p className="text-base font-semibold mt-0.5">
                {ownerKpis.indebtedCrewCount}{' '}
                <span className="text-xs font-normal text-[var(--muted-foreground)]">/ {summaryByEmployee.length} kru</span>
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)]">Tersaring otomatis di ringkasan</p>
            </div>
          </section>

          {/* 2-Tab Clean Switcher + Shared Outlet Filter */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[var(--card-border)]">
              <div className="inline-grid grid-cols-2 p-1 rounded-lg bg-[var(--background)] border border-[var(--border)] self-start">
                <button
                  type="button"
                  onClick={() => setOwnerTab('summary')}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    ownerTab === 'summary'
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
                  }`}
                >
                  Ringkasan per Kru
                </button>
                <button
                  type="button"
                  onClick={() => setOwnerTab('history')}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    ownerTab === 'history'
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
                  }`}
                >
                  Riwayat Transaksi ({advances.length})
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ownerTab === 'summary' ? (
                  <>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari nama kru..."
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs w-40 sm:w-44"
                    />
                    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] cursor-pointer select-none px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                      <input
                        type="checkbox"
                        checked={onlyWithDebt}
                        onChange={(e) => setOnlyWithDebt(e.target.checked)}
                        className="rounded accent-[var(--primary)]"
                      />
                      Hanya yg ada sisa
                    </label>
                  </>
                ) : (
                  <>
                    <select
                      value={historyEmpFilter}
                      onChange={(e) => setHistoryEmpFilter(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                    >
                      <option value="all">Semua Kru</option>
                      {summaryByEmployee.map((e) => (
                        <option key={e.employeeId} value={e.employeeId}>
                          {e.employeeName}
                        </option>
                      ))}
                    </select>
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value as 'all' | 'kasbon' | 'loan')}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                    >
                      <option value="all">Semua Jenis</option>
                      <option value="kasbon">Kasbon Biasa</option>
                      <option value="loan">Pinjaman Berjangka</option>
                    </select>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'paid')}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                    >
                      <option value="all">Semua Status</option>
                      <option value="active">Belum Lunas / Dicicil</option>
                      <option value="paid">Sudah Lunas</option>
                    </select>
                  </>
                )}
                <select
                  value={filterOutlet}
                  onChange={(e) => setFilterOutlet(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                >
                  <option value="all">Semua Outlet</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">Memuat data kasbon &amp; pinjaman...</div>
            ) : ownerTab === 'summary' ? (
              <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                      <th className="py-2 pr-3 font-medium">Karyawan</th>
                      <th className="py-2 px-2 font-medium text-right">Kasbon Biasa</th>
                      <th className="py-2 px-2 font-medium text-right">Pinjaman Berjangka</th>
                      <th className="py-2 px-2 font-medium text-right">Total Sisa</th>
                      <th className="py-2 pl-2 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                    {filteredSummaryRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[var(--muted-foreground)]">
                          {onlyWithDebt
                            ? 'Tidak ada kru dengan sisa kasbon atau pinjaman aktif.'
                            : 'Tidak ada kru yang sesuai pencarian.'}
                        </td>
                      </tr>
                    ) : (
                      filteredSummaryRows.map((e) => (
                        <tr key={e.employeeId} className="hover:bg-[var(--background)]">
                          <td className="py-2.5 pr-3 whitespace-nowrap">
                            <div className="font-semibold">{e.employeeName}</div>
                            <div className="text-[11px] text-[var(--muted-foreground)]">
                              {e.roleTitle} ·{' '}
                              {e.outletId === 'all' ? 'Rolling' : outletMap.get(e.outletId)?.location || e.outletId}
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-right whitespace-nowrap">
                            {e.kasbonRemaining > 0 ? (
                              <span className="font-medium text-[var(--warning)]">{formatRp(e.kasbonRemaining)}</span>
                            ) : (
                              <span className="text-[var(--muted-foreground)]">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right whitespace-nowrap">
                            {e.loanRemaining > 0 ? (
                              <div>
                                <div className="font-medium text-[var(--primary)]">{formatRp(e.loanRemaining)}</div>
                                <div className="text-[10px] text-[var(--muted-foreground)]">
                                  Cicilan {formatRp(e.monthlyInstallmentDue)}/bln
                                </div>
                              </div>
                            ) : (
                              <span className="text-[var(--muted-foreground)]">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right whitespace-nowrap font-bold">
                            <span className={e.totalRemaining > 0 ? 'text-[var(--error)]' : 'text-[var(--success)]'}>
                              {formatRp(e.totalRemaining)}
                            </span>
                          </td>
                          <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                setHistoryEmpFilter(e.employeeId);
                                setOwnerTab('history');
                              }}
                              className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-[11px] font-medium cursor-pointer"
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                      <th className="py-2 pr-3 font-medium">Tanggal</th>
                      <th className="py-2 px-2 font-medium">Karyawan</th>
                      <th className="py-2 px-2 font-medium">Jenis</th>
                      <th className="py-2 px-2 font-medium">Sumber &amp; Keterangan</th>
                      <th className="py-2 px-2 font-medium text-right">Total</th>
                      <th className="py-2 px-2 font-medium text-right">Sisa</th>
                      <th className="py-2 px-2 font-medium text-center">Status</th>
                      <th className="py-2 pl-2 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                    {filteredAdvances.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[var(--muted-foreground)]">
                          Belum ada transaksi sesuai filter ini.
                        </td>
                      </tr>
                    ) : (
                      filteredAdvances.map((a) => {
                        const isLoan = a.type === 'loan';
                        const paidPct = a.amount > 0 ? Math.min(100, Math.round((a.paidAmount / a.amount) * 100)) : 0;
                        return (
                          <tr key={a.id} className="hover:bg-[var(--background)]">
                            <td className="py-2.5 pr-3 whitespace-nowrap">
                              <div>{formatDateIndo(a.date)}</div>
                              <div className="text-[11px] text-[var(--muted-foreground)]">
                                {isLoan ? 'Pencairan' : `Shift ${a.shift} ${a.time ? `· ${a.time}` : ''}`}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 font-medium whitespace-nowrap">
                              <div>{a.employeeName}</div>
                              <div className="text-[11px] font-normal text-[var(--muted-foreground)]">
                                {outletMap.get(a.outletId)?.location || a.outletId}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 whitespace-nowrap">
                              {isLoan ? (
                                <span className="px-2 py-0.5 rounded border border-[var(--primary)] text-[var(--primary)] font-semibold">
                                  Pinjaman {a.tenorMonths} bln
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">Kasbon</span>
                              )}
                            </td>
                            <td className="py-2.5 px-2">
                              <div className="font-medium">
                                {a.source === 'drawer'
                                  ? 'Laci Kasir'
                                  : a.source === 'owner_transfer'
                                    ? 'Transfer Owner'
                                    : `Gabungan (Laci ${formatRp(a.drawerAmount)} + Owner ${formatRp(a.ownerTransferAmount)})`}
                              </div>
                              {a.note && <div className="text-[11px] text-[var(--muted-foreground)]">{a.note}</div>}
                              {a.repayments.length > 0 && (
                                <div className="mt-1 space-y-0.5 text-[11px] text-[var(--muted-foreground)]">
                                  {a.repayments.map((r) => (
                                    <div key={r.id}>
                                      &#10003; {formatDateIndo(r.date)}: {formatRp(r.amount)} ({r.note})
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-right whitespace-nowrap">
                              <div className="font-semibold">{formatRp(a.amount)}</div>
                              {isLoan && (
                                <div className="text-[10px] text-[var(--muted-foreground)]">
                                  {formatRp(a.installmentAmount || 0)}/bln · {paidPct}% lunas
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-right font-semibold text-[var(--error)] whitespace-nowrap">
                              {formatRp(a.remainingAmount)}
                            </td>
                            <td className="py-2.5 px-2 text-center whitespace-nowrap">
                              {a.status === 'paid' ? (
                                <span className="px-2 py-0.5 rounded border border-[var(--success)] text-[var(--success)] font-medium">
                                  Lunas
                                </span>
                              ) : a.status === 'partial' ? (
                                <span className="px-2 py-0.5 rounded border border-[var(--warning)] text-[var(--warning)] font-medium">
                                  Dicicil
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--error)] font-medium">
                                  Belum Lunas
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 pl-2 text-right whitespace-nowrap space-x-1">
                              {a.remainingAmount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRepayTarget(a);
                                    const suggested =
                                      a.type === 'loan' && a.installmentAmount && a.installmentAmount > 0
                                        ? Math.min(a.remainingAmount, a.installmentAmount)
                                        : a.remainingAmount;
                                    setRepayAmountStr(formatPlain(suggested));
                                    setRepayNote(a.type === 'loan' ? 'Cicilan pinjaman' : '');
                                  }}
                                  className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
                                >
                                  Bayar
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDelete(a.id)}
                                className="px-2 py-1 rounded border border-[var(--border)] hover:text-[var(--error)] cursor-pointer"
                                title="Hapus"
                              >
                                &times;
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : unlocked ? (
        <>
          <section className="bg-[var(--card)] border border-[var(--primary)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="pb-3 border-b border-[var(--card-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h2 className="text-sm font-semibold">Kasbon &amp; Pinjaman — {unlocked.employee.name}</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Nominal dari <strong>Laci Kasir</strong> otomatis mengurangi Saldo Akhir Laci Shift di{' '}
                  <strong>{outletMap.get(selectedOutletId)?.name || selectedOutletId}</strong>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                <span className="px-3 py-1.5 rounded-lg bg-[var(--secondary)] text-xs font-semibold tabular-nums">
                  Kasbon: {formatRp(unlocked.summary.kasbonRemaining)}
                  {unlocked.summary.loanRemaining > 0 &&
                    ` · Pinjaman: ${formatRp(unlocked.summary.loanRemaining)} (${formatRp(unlocked.summary.monthlyInstallmentDue)}/bln)`}
                </span>
                <button
                  type="button"
                  onClick={() => lockKasbon()}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-semibold cursor-pointer"
                >
                  Kunci &amp; Tutup
                </button>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitKasbon(false);
              }}
              className="space-y-3.5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-4 space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Karyawan (Terverifikasi PIN)</label>
                  <div className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold">
                    {unlocked.employee.name} ({unlocked.employee.payType === 'daily' ? 'Part-Time' : 'Bulanan'})
                  </div>
                </div>
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Outlet</label>
                  <div className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold">
                    {outletMap.get(selectedOutletId)?.name || selectedOutletId}
                  </div>
                </div>
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Tanggal</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs tabular-nums"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Shift</label>
                  <select
                    value={shift}
                    onChange={(e) => setShift(Number(e.target.value) === 2 ? 2 : 1)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                  >
                    <option value={1}>Shift 1</option>
                    <option value={2}>Shift 2</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-[var(--muted-foreground)] block">Sumber Dana Kasbon</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'drawer', title: 'Dari Laci Kasir', desc: 'Otomatis potong saldo kas laci shift' },
                      { id: 'owner_transfer', title: 'Transfer Owner', desc: 'Langsung dari rekening / kas Owner' },
                      { id: 'mixed', title: 'Gabungan (Laci + Owner)', desc: 'Sebagian laci, kurangnya ditransfer Owner' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSourceMode(m.id)}
                      className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        sourceMode === m.id
                          ? 'border-[var(--primary)] bg-[var(--secondary)]'
                          : 'border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[var(--foreground)]">{m.title}</div>
                      <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                {sourceMode !== 'owner_transfer' && (
                  <div className={sourceMode === 'mixed' ? 'sm:col-span-3 space-y-1' : 'sm:col-span-4 space-y-1'}>
                    <label className="text-xs text-[var(--muted-foreground)] block">Ambil dari Laci Kasir (Rp)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={drawerStr}
                      onChange={(e) => setDrawerStr(formatPlain(parseNum(e.target.value)))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tabular-nums"
                    />
                  </div>
                )}
                {sourceMode !== 'drawer' && (
                  <div className={sourceMode === 'mixed' ? 'sm:col-span-3 space-y-1' : 'sm:col-span-4 space-y-1'}>
                    <label className="text-xs text-[var(--muted-foreground)] block">Transfer / Bayar Owner (Rp)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={ownerStr}
                      onChange={(e) => setOwnerStr(formatPlain(parseNum(e.target.value)))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tabular-nums"
                    />
                  </div>
                )}
                <div className={sourceMode === 'mixed' ? 'sm:col-span-4 space-y-1' : 'sm:col-span-5 space-y-1'}>
                  <label className="text-xs text-[var(--muted-foreground)] block">Keterangan Kasbon</label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Misal: Keperluan mendadak"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                  />
                </div>
                <div className={sourceMode === 'mixed' ? 'sm:col-span-2' : 'sm:col-span-3'}>
                  <button
                    type="submit"
                    disabled={submitting || totalKasbon <= 0}
                    className="w-full py-2 px-3 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    {submitting ? 'Menyimpan...' : `Catat ${totalKasbon > 0 ? formatRp(totalKasbon) : 'Kasbon'}`}
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* Crew Personal History Table */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--card-border)]">
              <h3 className="text-sm font-semibold">Riwayat Kasbon &amp; Pinjaman — {unlocked.employee.name}</h3>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'paid')}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium self-start sm:self-auto"
              >
                <option value="all">Semua Status</option>
                <option value="active">Belum Lunas / Dicicil</option>
                <option value="paid">Sudah Lunas</option>
              </select>
            </div>
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[600px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 px-2 font-medium">Jenis</th>
                    <th className="py-2 px-2 font-medium">Sumber &amp; Keterangan</th>
                    <th className="py-2 px-2 font-medium text-right">Total</th>
                    <th className="py-2 px-2 font-medium text-right">Sisa</th>
                    <th className="py-2 px-2 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                  {filteredAdvances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[var(--muted-foreground)]">
                        Belum ada catatan kasbon maupun pinjaman.
                      </td>
                    </tr>
                  ) : (
                    filteredAdvances.map((a) => (
                      <tr key={a.id} className="hover:bg-[var(--background)]">
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <div>{formatDateIndo(a.date)}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)]">
                            {a.type === 'loan' ? 'Pinjaman' : `Shift ${a.shift} ${a.time ? `· ${a.time}` : ''}`}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          {a.type === 'loan' ? (
                            <span className="px-2 py-0.5 rounded border border-[var(--primary)] text-[var(--primary)] font-semibold">
                              Pinjaman {a.tenorMonths} bln
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">Kasbon</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="font-medium">
                            {a.source === 'drawer'
                              ? 'Laci Kasir'
                              : a.source === 'owner_transfer'
                                ? 'Transfer Owner'
                                : `Gabungan (${formatRp(a.drawerAmount)} + ${formatRp(a.ownerTransferAmount)})`}
                          </div>
                          {a.note && <div className="text-[11px] text-[var(--muted-foreground)]">{a.note}</div>}
                          {a.repayments.length > 0 && (
                            <div className="mt-1 space-y-0.5 text-[11px] text-[var(--muted-foreground)]">
                              {a.repayments.map((r) => (
                                <div key={r.id}>
                                  &#10003; {formatDateIndo(r.date)}: {formatRp(r.amount)} ({r.note})
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right whitespace-nowrap">
                          <div className="font-semibold">{formatRp(a.amount)}</div>
                          {a.type === 'loan' && (
                            <div className="text-[10px] text-[var(--muted-foreground)]">
                              {formatRp(a.installmentAmount || 0)}/bln
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right font-semibold text-[var(--error)] whitespace-nowrap">
                          {formatRp(a.remainingAmount)}
                        </td>
                        <td className="py-2.5 px-2 text-center whitespace-nowrap">
                          {a.status === 'paid' ? (
                            <span className="px-2 py-0.5 rounded border border-[var(--success)] text-[var(--success)] font-medium">
                              Lunas
                            </span>
                          ) : a.status === 'partial' ? (
                            <span className="px-2 py-0.5 rounded border border-[var(--warning)] text-[var(--warning)] font-medium">
                              Dicicil
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--error)] font-medium">
                              Belum Lunas
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {/* Owner New Installment Loan Modal */}
      {loanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Catat Pinjaman Berjangka (Dicicil)</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Dana pinjaman dari Owner &amp; otomatis ditagihkan per cicilan bulanan di Payroll.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLoanModalOpen(false)}
                className="text-xs text-[var(--muted-foreground)] px-2 py-1 cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={submitNewLoan} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Karyawan</label>
                  <select
                    value={loanEmpId}
                    onChange={(e) => setLoanEmpId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                  >
                    {summaryByEmployee.map((e) => (
                      <option key={e.employeeId} value={e.employeeId}>
                        {e.employeeName} ({e.roleTitle})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Tanggal Pencairan</label>
                  <input
                    type="date"
                    value={loanDate}
                    onChange={(e) => setLoanDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Total Pinjaman (Rp)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder="cth: 5.000.000"
                  value={loanAmountStr}
                  onChange={(e) => updateLoanAmountOrTenor(formatPlain(parseNum(e.target.value)), loanTenor)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm font-semibold tabular-nums"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 items-start">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--muted-foreground)] block">Tenor (Bulan)</label>
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={loanTenor}
                    onChange={(e) => {
                      const t = Math.max(2, Math.min(60, Number(e.target.value) || 2));
                      updateLoanAmountOrTenor(loanAmountStr, t);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tabular-nums"
                  />
                  <div className="flex flex-wrap gap-1">
                    {[3, 6, 12, 24].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => updateLoanAmountOrTenor(loanAmountStr, t)}
                        className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${
                          loanTenor === t
                            ? 'border-[var(--primary)] bg-[var(--secondary)] font-semibold'
                            : 'border-[var(--border)] text-[var(--muted-foreground)]'
                        }`}
                      >
                        {t} bln
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Cicilan / Bulan (Rp)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={loanInstallmentStr}
                    onChange={(e) => {
                      setLoanInstallmentCustom(true);
                      setLoanInstallmentStr(formatPlain(parseNum(e.target.value)));
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold text-[var(--primary)] tabular-nums"
                  />
                  <span className="text-[10px] text-[var(--muted-foreground)] block">
                    Ditagihkan otomatis per bulan di Payroll
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Keterangan / Keperluan</label>
                <input
                  type="text"
                  value={loanNote}
                  onChange={(e) => setLoanNote(e.target.value)}
                  placeholder="Misal: Keperluan darurat keluarga, cicil 12x"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setLoanModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingLoan || parseNum(loanAmountStr) <= 0}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingLoan ? 'Menyimpan...' : 'Simpan Pinjaman'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Over-Limit Confirmation Modal */}
      {limitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--warning)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--warning)]">Peringatan Melebihi Limit Kasbon</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{limitModal.message}</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLimitModal(null)}
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setLimitModal(null);
                  submitKasbon(true);
                }}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
              >
                Tetap Catat Kasbon
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Repayment Modal */}
      {repayTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-sm w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-semibold">
                {repayTarget.type === 'loan' ? 'Bayar Cicilan Pinjaman' : 'Pelunasan Kasbon'} — {repayTarget.employeeName}
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Sisa saat ini: <strong className="text-[var(--error)]">{formatRp(repayTarget.remainingAmount)}</strong>
              </p>
            </div>
            <form onSubmit={submitManualRepayment} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Nominal Bayar (Rp)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={repayAmountStr}
                  onChange={(e) => setRepayAmountStr(formatPlain(parseNum(e.target.value)))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Metode Pengembalian</label>
                <select
                  value={repayMethod}
                  onChange={(e) => setRepayMethod(e.target.value as 'cash_return' | 'transfer_return')}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                >
                  <option value="transfer_return">Transfer ke Owner</option>
                  <option value="cash_return">Tunai Langsung ke Owner</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Catatan</label>
                <input
                  type="text"
                  value={repayNote}
                  onChange={(e) => setRepayNote(e.target.value)}
                  placeholder="Misal: Cicilan bulan ke-2"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRepayTarget(null)}
                  className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
                >
                  Simpan Pembayaran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

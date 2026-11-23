'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatDateIndo,
  formatDateTimeShort,
  formatPlain,
  formatRp,
  getMonthRangeWib,
  parseNum,
} from '@/lib/calc';
import { downloadPayslipPdf } from '@/lib/payslip-pdf';
import type { OutletPublic, PayrollItemRecord, PayrollRunRecord } from '@/lib/types';

interface PayrollViewProps {
  outlets: OutletPublic[];
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

function recalcItem(it: PayrollItemRecord): PayrollItemRecord {
  const grossPay = it.basePay + it.mealTotal + it.overtimePay + it.bonus;
  const netPay = Math.max(0, grossPay - it.lateDeduction - it.kasbonDeduction - it.otherDeduction);
  return { ...it, grossPay, netPay };
}

export default function PayrollView({ outlets, onToast }: PayrollViewProps) {
  const defaultMonth = getMonthRangeWib();
  const [loading, setLoading] = useState(true);
  const [payrolls, setPayrolls] = useState<PayrollRunRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'editor' | 'history'>('editor');

  // Editor state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [periodLabel, setPeriodLabel] = useState(defaultMonth.label);
  const [fromDate, setFromDate] = useState(defaultMonth.fromDate);
  const [toDate, setToDate] = useState(defaultMonth.toDate);
  const [outletId, setOutletId] = useState('all');
  const [draftItems, setDraftItems] = useState<PayrollItemRecord[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editor filter & accordion state
  const [searchQuery, setSearchQuery] = useState('');
  const [fillFilter, setFillFilter] = useState<'all' | 'unfilled' | 'filled'>('all');
  const [expandedEmpIds, setExpandedEmpIds] = useState<Set<string>>(() => new Set());

  // History accordion & WA modal
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());
  const [slipModalText, setSlipModalText] = useState<string | null>(null);

  const loadPayrolls = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const res = await fetch('/api/payroll', { cache: 'no-store', signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat riwayat payroll.');
        if (signal?.aborted) return;
        setPayrolls(data.payrolls || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onToast(err instanceof Error ? err.message : 'Gagal memuat payroll.', 'error');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadPayrolls(controller.signal);
    return () => controller.abort();
  }, [loadPayrolls]);

  async function handleGeneratePreview() {
    setGenerating(true);
    try {
      const params = new URLSearchParams({
        mode: 'preview',
        from: fromDate,
        to: toDate,
        outletId,
      });
      const res = await fetch(`/api/payroll?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menarik data payroll.');
      setEditingId(null);
      setDraftItems(data.items || []);
      setExpandedEmpIds(new Set());
      setSearchQuery('');
      setFillFilter('all');
      onToast(`Daftar ${data.items?.length || 0} kru & saldo kasbon aktif siap diisi manual.`, 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memuat daftar kru.', 'error');
    } finally {
      setGenerating(false);
    }
  }

  function updateDraftItem(employeeId: string, patch: Partial<PayrollItemRecord>) {
    setDraftItems((prev) =>
      prev.map((it) => (it.employeeId === employeeId ? recalcItem({ ...it, ...patch }) : it))
    );
  }

  function removeDraftItem(employeeId: string) {
    setDraftItems((prev) => prev.filter((it) => it.employeeId !== employeeId));
    setExpandedEmpIds((prev) => {
      const next = new Set(prev);
      next.delete(employeeId);
      return next;
    });
  }

  function toggleExpandEmp(employeeId: string) {
    setExpandedEmpIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function toggleExpandRun(runId: string) {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  async function savePayroll(finalize: boolean) {
    if (draftItems.length === 0) return onToast('Muat daftar kru terlebih dahulu.', 'warning');
    if (finalize) {
      const overKasbon = draftItems.find((it) => it.kasbonDeduction > it.grossPay);
      if (overKasbon) {
        onToast(
          `Potongan kasbon ${overKasbon.employeeName} (${formatRp(overKasbon.kasbonDeduction)}) melebihi gaji kotor (${formatRp(overKasbon.grossPay)}). Isi nominal gaji atau sesuaikan potongan kasbon.`,
          'warning'
        );
        return;
      }
      const unfilled = draftItems.filter((it) => it.grossPay <= 0).length;
      const confirmMsg =
        unfilled > 0
          ? `Ada ${unfilled} kru dengan gaji kotor Rp 0. Tetap Finalisasi & Tandai Dibayar? Potongan kasbon/cicilan akan otomatis dipotong dan payroll dikunci.`
          : 'Finalisasi & Tandai Dibayar? Potongan kasbon/cicilan tiap karyawan akan otomatis mengurangi saldo hutang mereka dan payroll dikunci.';
      if (!window.confirm(confirmMsg)) {
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId || undefined,
          periodLabel: periodLabel.trim() || `${fromDate} s/d ${toDate}`,
          fromDate,
          toDate,
          outletId,
          items: draftItems,
          finalize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan payroll.');
      setPayrolls(data.payrolls || []);
      if (finalize) {
        const finalizedId = data.payroll?.id;
        setDraftItems([]);
        setEditingId(null);
        setExpandedEmpIds(new Set());
        if (finalizedId) setExpandedRunIds(new Set([finalizedId]));
        setActiveTab('history');
        onToast('Payroll difinalisasi & dibayar! Saldo kasbon/cicilan karyawan otomatis diperbarui.', 'success');
      } else {
        setEditingId(data.payroll?.id || null);
        onToast('Draft payroll tersimpan.', 'info');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan payroll.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDraft(id: string) {
    if (!window.confirm('Hapus draft payroll ini?')) return;
    try {
      const res = await fetch(`/api/payroll?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus draft.');
      setPayrolls(data.payrolls || []);
      if (editingId === id) {
        setEditingId(null);
        setDraftItems([]);
      }
      onToast('Draft payroll dihapus.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus.', 'error');
    }
  }

  function buildSlipWa(run: Pick<PayrollRunRecord, 'periodLabel' | 'fromDate' | 'toDate'>, it: PayrollItemRecord): string {
    return [
      `*SLIP GAJI — BARA COFFEE*`,
      `Periode : ${run.periodLabel} (${formatDateIndo(run.fromDate)} – ${formatDateIndo(run.toDate)})`,
      `Nama    : ${it.employeeName} (${it.roleTitle})`,
      `Skema   : ${it.payType === 'daily' ? 'Part-Time Harian' : 'Bulanan'}`,
      `Absensi : ${it.daysPresent} hadir${it.fullShiftCount ? ` (${it.fullShiftCount}x full shift)` : ''} · ${it.lateCount} telat · ${it.overtimeHours} jam lembur`,
      ``,
      `*PENDAPATAN*`,
      `• Gaji Pokok   : ${formatRp(it.basePay)}`,
      it.mealTotal > 0 ? `• Uang Makan   : ${formatRp(it.mealTotal)}` : '',
      it.overtimePay > 0 ? `• Lembur       : ${formatRp(it.overtimePay)}` : '',
      it.bonus > 0 ? `• Bonus        : ${formatRp(it.bonus)}` : '',
      `Total Kotor    : ${formatRp(it.grossPay)}`,
      ``,
      `*POTONGAN*`,
      it.lateDeduction > 0 ? `• Pot. Telat   : -${formatRp(it.lateDeduction)}` : '',
      it.kasbonDeduction > 0 ? `• Pot. Kasbon  : -${formatRp(it.kasbonDeduction)}` : '',
      it.otherDeduction > 0 ? `• Pot. Lainnya : -${formatRp(it.otherDeduction)}` : '',
      it.lateDeduction + it.kasbonDeduction + it.otherDeduction === 0 ? `• Tidak ada potongan` : '',
      ``,
      `*GAJI BERSIH (DITERIMA): ${formatRp(it.netPay)}*`,
      it.note ? `Catatan: ${it.note}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  function exportPayrollCsv(run: PayrollRunRecord) {
    const headers = [
      'Periode',
      'Karyawan',
      'Jabatan',
      'Tipe Gaji',
      'Hadir',
      'Full Shift',
      'Telat',
      'Lembur (Jam)',
      'Gaji Pokok',
      'Uang Makan',
      'Lembur (Rp)',
      'Bonus',
      'Gaji Kotor',
      'Pot. Telat',
      'Pot. Kasbon',
      'Pot. Lain',
      'Gaji Bersih',
      'Catatan',
    ];
    const rows = run.items.map((it) => [
      run.periodLabel,
      it.employeeName,
      it.roleTitle,
      it.payType === 'daily' ? 'Part-Time Harian' : 'Bulanan',
      it.daysPresent,
      it.fullShiftCount || 0,
      it.lateCount,
      it.overtimeHours,
      it.basePay,
      it.mealTotal,
      it.overtimePay,
      it.bonus,
      it.grossPay,
      it.lateDeduction,
      it.kasbonDeduction,
      it.otherDeduction,
      it.netPay,
      it.note,
    ]);
    const csv =
      '\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bara-coffee-payroll-${run.fromDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast('CSV Payroll diunduh.', 'success');
  }

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);

  const { filledCount, unfilledCount, draftTotals } = useMemo(() => {
    let filled = 0;
    let gross = 0;
    let kasbon = 0;
    let net = 0;
    draftItems.forEach((it) => {
      if (it.grossPay > 0) filled++;
      gross += it.grossPay;
      kasbon += it.kasbonDeduction;
      net += it.netPay;
    });
    return {
      filledCount: filled,
      unfilledCount: draftItems.length - filled,
      draftTotals: { gross, kasbon, net },
    };
  }, [draftItems]);

  const filteredDraftItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return draftItems.filter((it) => {
      if (fillFilter === 'unfilled' && it.grossPay > 0) return false;
      if (fillFilter === 'filled' && it.grossPay <= 0) return false;
      if (q && !it.employeeName.toLowerCase().includes(q) && !it.roleTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [draftItems, fillFilter, searchQuery]);

  const progressPct = draftItems.length > 0 ? Math.round((filledCount / draftItems.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Minimalist Top Bar + 2-Tab Switcher */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Payroll Karyawan</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Input gaji manual per kru · absensi sebagai referensi · kasbon &amp; cicilan terpotong otomatis.
          </p>
        </div>
        <div className="inline-grid grid-cols-2 p-1 rounded-lg bg-[var(--background)] border border-[var(--border)] self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
              activeTab === 'editor'
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
            }`}
          >
            Input Payroll
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
            }`}
          >
            Riwayat ({payrolls.length})
          </button>
        </div>
      </section>

      {activeTab === 'editor' ? (
        <div className="space-y-4">
          {/* Compact Period Setup Bar */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <div className="grid grid-cols-2 sm:grid-cols-12 gap-2.5 items-end">
              <div className="col-span-2 sm:col-span-3 space-y-1">
                <label className="text-[11px] text-[var(--muted-foreground)] block">Label Periode</label>
                <input
                  type="text"
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  placeholder="Misal: November 2026"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                />
              </div>
              <div className="col-span-1 sm:col-span-2 space-y-1">
                <label className="text-[11px] text-[var(--muted-foreground)] block">Dari Tanggal</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs tabular-nums"
                />
              </div>
              <div className="col-span-1 sm:col-span-2 space-y-1">
                <label className="text-[11px] text-[var(--muted-foreground)] block">Sampai Tanggal</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs tabular-nums"
                />
              </div>
              <div className="col-span-2 sm:col-span-2 space-y-1">
                <label className="text-[11px] text-[var(--muted-foreground)] block">Outlet</label>
                <select
                  value={outletId}
                  onChange={(e) => setOutletId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                >
                  <option value="all">Semua Outlet</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <button
                  type="button"
                  disabled={generating}
                  onClick={handleGeneratePreview}
                  className="w-full py-2 px-3 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {generating
                    ? 'Memuat Kru...'
                    : draftItems.length > 0
                      ? 'Muat Ulang Daftar Kru'
                      : 'Muat Daftar Kru & Kasbon'}
                </button>
              </div>
            </div>
          </section>

          {draftItems.length === 0 ? (
            <section className="bg-[var(--card)] border border-dashed border-[var(--border)] rounded-xl p-8 text-center space-y-2">
              <div className="text-sm font-semibold">Belum Ada Daftar Kru Dimuat</div>
              <p className="text-xs text-[var(--muted-foreground)] max-w-md mx-auto leading-relaxed">
                1. Pilih rentang tanggal periode &amp; klik <strong>Muat Daftar Kru &amp; Kasbon</strong>.
                <br />
                2. Isi gaji pokok/bonus masing-masing kru secara manual (referensi absen &amp; tagihan kasbon muncul otomatis).
                <br />
                3. Klik <strong>Finalisasi &amp; Bayar</strong> untuk mengarsipkan slip PDF &amp; memotong kasbon.
              </p>
            </section>
          ) : (
            <>
              {/* Slim 3-KPI Summary Strip */}
              <section className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 tabular-nums">
                <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                    <span>Progres Input Gaji</span>
                    <span className="font-semibold text-[var(--foreground)]">
                      {filledCount} / {draftItems.length} kru
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--primary)] transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
                <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3">
                  <p className="text-[11px] text-[var(--muted-foreground)]">Total Pot. Kasbon / Cicilan</p>
                  <p className="text-base font-semibold text-[var(--error)] mt-0.5">
                    -{formatRp(draftTotals.kasbon)}
                  </p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">Total Kotor: {formatRp(draftTotals.gross)}</p>
                </div>
                <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3">
                  <p className="text-[11px] text-[var(--muted-foreground)]">Total Gaji Bersih ({periodLabel})</p>
                  <p className="text-base font-bold text-[var(--primary)] mt-0.5">{formatRp(draftTotals.net)}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {editingId ? 'Mode Edit Draft' : 'Draft baru'}
                  </p>
                </div>
              </section>

              {/* Expandable Minimalist Crew List */}
              <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3">
                {/* Search & Fill Filter Toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[var(--card-border)]">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama kru atau posisi..."
                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs w-full sm:w-56"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'all', label: `Semua (${draftItems.length})` },
                        { id: 'unfilled', label: `Belum Diisi (${unfilledCount})` },
                        { id: 'filled', label: `Sudah Diisi (${filledCount})` },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFillFilter(f.id)}
                        className={`px-2.5 py-1 rounded-md border text-[11px] transition-colors cursor-pointer ${
                          fillFilter === f.id
                            ? 'bg-[var(--secondary)] border-[var(--primary)] text-[var(--foreground)] font-semibold'
                            : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Compact Crew Rows */}
                <div className="space-y-2">
                  {filteredDraftItems.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">
                      Tidak ada kru yang sesuai filter ini.
                    </div>
                  ) : (
                    filteredDraftItems.map((it) => {
                      const isExpanded = expandedEmpIds.has(it.employeeId);
                      const isFilled = it.grossPay > 0;
                      const kasbonOverGross = it.kasbonDeduction > it.grossPay;
                      const oName =
                        it.outletId === 'all'
                          ? 'Semua Outlet (Rolling)'
                          : outletMap.get(it.outletId)?.name || it.outletId;

                      return (
                        <div
                          key={it.employeeId}
                          className={`rounded-xl border transition-colors ${
                            kasbonOverGross
                              ? 'border-[var(--warning)] bg-[var(--background)]'
                              : isExpanded
                                ? 'border-[var(--primary)] bg-[var(--background)]'
                                : 'border-[var(--border)] bg-[var(--background)]'
                          }`}
                        >
                          {/* Main Compact Row */}
                          <div className="p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            {/* Left: Identity + Reference Attendance */}
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    isFilled ? 'bg-[var(--success)]' : 'bg-[var(--border)]'
                                  }`}
                                  title={isFilled ? 'Sudah diisi' : 'Belum diisi'}
                                />
                                <span className="text-sm font-semibold">{it.employeeName}</span>
                                <span className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[10px] font-medium">
                                  {it.payType === 'daily' ? 'Part-Time' : 'Bulanan'} · {it.roleTitle}
                                </span>
                              </div>
                              <div className="text-[11px] text-[var(--muted-foreground)] tabular-nums pl-4">
                                Ref. Absen: <strong className="text-[var(--foreground)]">{it.daysPresent} hadir</strong>
                                {it.fullShiftCount ? (
                                  <span className="text-[var(--primary)] font-semibold">
                                    {' '}
                                    ({it.fullShiftCount}x Full Shift)
                                  </span>
                                ) : null}{' '}
                                · {it.lateCount} telat · {it.overtimeHours}j lembur
                                {it.mealTotal + it.overtimePay + it.bonus > 0 &&
                                  ` · Tunjangan/Bonus +${formatRp(it.mealTotal + it.overtimePay + it.bonus)}`}
                              </div>
                            </div>

                            {/* Right: Quick BasePay Input + Kasbon Pill + Net Pay + Rincian Toggle */}
                            <div className="grid grid-cols-12 sm:flex sm:items-center gap-2 sm:gap-2.5 tabular-nums pl-4 lg:pl-0">
                              <div className="col-span-6 sm:w-36">
                                <label className="text-[10px] text-[var(--muted-foreground)] block sm:hidden mb-0.5">
                                  Gaji Pokok / Upah
                                </label>
                                <div className="relative">
                                  <span className="hidden sm:inline absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted-foreground)]">
                                    Pokok
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Gaji Pokok"
                                    value={it.basePay === 0 ? '' : formatPlain(it.basePay)}
                                    onChange={(e) => updateDraftItem(it.employeeId, { basePay: parseNum(e.target.value) })}
                                    className="w-full pl-2.5 sm:pl-11 pr-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-right text-xs font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                                  />
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleExpandEmp(it.employeeId)}
                                title="Klik untuk atur rincian & potongan kasbon"
                                className={`col-span-6 sm:w-auto px-2.5 py-1.5 rounded-lg border text-right sm:text-center text-[11px] cursor-pointer ${
                                  it.kasbonDeduction > 0
                                    ? kasbonOverGross
                                      ? 'border-[var(--warning)] text-[var(--warning)] bg-[var(--card)] font-semibold'
                                      : 'border-[var(--border)] text-[var(--error)] bg-[var(--card)] font-medium'
                                    : 'border-[var(--border)] text-[var(--muted-foreground)] bg-[var(--card)]'
                                }`}
                              >
                                Kasbon {it.kasbonDeduction > 0 ? `-${formatRp(it.kasbonDeduction)}` : 'Rp 0'}
                              </button>

                              <div className="col-span-7 sm:w-28 sm:text-right">
                                <div className="text-[10px] text-[var(--muted-foreground)]">Bersih</div>
                                <div className="text-xs sm:text-sm font-bold text-[var(--primary)]">
                                  {formatRp(it.netPay)}
                                </div>
                              </div>

                              <div className="col-span-5 sm:w-auto flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => toggleExpandEmp(it.employeeId)}
                                  className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-[11px] font-medium cursor-pointer whitespace-nowrap"
                                >
                                  {isExpanded ? 'Tutup ▲' : 'Rincian ▼'}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Expandable Detail Drawer */}
                          {isExpanded && (
                            <div className="border-t border-[var(--card-border)] bg-[var(--card)]/60 p-3 sm:p-3.5 rounded-b-xl space-y-3">
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                <div className="space-y-1">
                                  <label className="text-[11px] text-[var(--muted-foreground)] block">
                                    Uang Makan / Transport
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={formatPlain(it.mealTotal)}
                                    onChange={(e) =>
                                      updateDraftItem(it.employeeId, { mealTotal: parseNum(e.target.value) })
                                    }
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-right text-xs tabular-nums"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] text-[var(--muted-foreground)] block">Upah Lembur</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={formatPlain(it.overtimePay)}
                                    onChange={(e) =>
                                      updateDraftItem(it.employeeId, { overtimePay: parseNum(e.target.value) })
                                    }
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-right text-xs tabular-nums"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] text-[var(--muted-foreground)] block">
                                    Bonus / Insentif
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={formatPlain(it.bonus)}
                                    onChange={(e) => updateDraftItem(it.employeeId, { bonus: parseNum(e.target.value) })}
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-right text-xs tabular-nums"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] text-[var(--muted-foreground)] block">
                                    Pot. Telat / Disiplin
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={formatPlain(it.lateDeduction)}
                                    onChange={(e) =>
                                      updateDraftItem(it.employeeId, { lateDeduction: parseNum(e.target.value) })
                                    }
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-right text-xs tabular-nums"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] text-[var(--muted-foreground)] block">Pot. Lainnya</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={formatPlain(it.otherDeduction)}
                                    onChange={(e) =>
                                      updateDraftItem(it.employeeId, { otherDeduction: parseNum(e.target.value) })
                                    }
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-right text-xs tabular-nums"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <label className="text-[11px] text-[var(--muted-foreground)] block">
                                      Pot. Kasbon / Cicilan
                                    </label>
                                    {it.activeKasbonBefore > 0 && (
                                      <span className="flex items-center gap-1.5 text-[10px]">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateDraftItem(it.employeeId, {
                                              kasbonDeduction: it.suggestedKasbonDeduction ?? it.activeKasbonBefore,
                                            })
                                          }
                                          className="text-[var(--primary)] hover:underline cursor-pointer"
                                        >
                                          Tagihan
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => updateDraftItem(it.employeeId, { kasbonDeduction: 0 })}
                                          className="text-[var(--muted-foreground)] hover:underline cursor-pointer"
                                        >
                                          Rp 0
                                        </button>
                                      </span>
                                    )}
                                  </div>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={formatPlain(it.kasbonDeduction)}
                                    onChange={(e) =>
                                      updateDraftItem(it.employeeId, { kasbonDeduction: parseNum(e.target.value) })
                                    }
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-right text-xs font-semibold text-[var(--error)] tabular-nums"
                                  />
                                  {it.activeKasbonBefore > 0 && (
                                    <div className="text-[10px] text-[var(--muted-foreground)] tabular-nums">
                                      Sisa hutang: {formatRp(it.activeKasbonBefore)}
                                      {it.suggestedKasbonDeduction !== undefined &&
                                        it.suggestedKasbonDeduction < it.activeKasbonBefore &&
                                        ` · Tagihan bln ini: ${formatRp(it.suggestedKasbonDeduction)}`}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                                <input
                                  type="text"
                                  value={it.note}
                                  onChange={(e) => updateDraftItem(it.employeeId, { note: e.target.value })}
                                  placeholder="Catatan slip (opsional, misal: rajin / evaluasi shift)"
                                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                                />
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      downloadPayslipPdf({
                                        periodLabel: periodLabel.trim() || `${fromDate} s/d ${toDate}`,
                                        fromDate,
                                        toDate,
                                        status: 'draft',
                                        paidAt: null,
                                        outletName: oName,
                                        item: it,
                                      });
                                      onToast(`Slip PDF ${it.employeeName} diunduh.`, 'success');
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg border border-[var(--primary)] text-[var(--primary)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                                  >
                                    PDF
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSlipModalText(buildSlipWa({ periodLabel, fromDate, toDate }, it))}
                                    className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                                  >
                                    WA
                                  </button>
                                  {draftItems.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeDraftItem(it.employeeId)}
                                      className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:text-[var(--error)] text-xs cursor-pointer"
                                    >
                                      Keluarkan
                                    </button>
                                  )}
                                </div>
                              </div>

                              {kasbonOverGross && (
                                <div className="px-3 py-1.5 rounded-lg border border-[var(--warning)] bg-[var(--background)] text-[11px] text-[var(--warning)] font-medium">
                                  Potongan kasbon ({formatRp(it.kasbonDeduction)}) melebihi gaji kotor (
                                  {formatRp(it.grossPay)}). Isi nominal gaji atau klik Rp 0 / sesuaikan potongan.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Bottom Action Bar */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 tabular-nums">
                  <div className="text-xs text-[var(--muted-foreground)]">
                    <strong className="text-[var(--foreground)]">
                      {filledCount}/{draftItems.length} kru diisi
                    </strong>{' '}
                    · Total Bersih:{' '}
                    <strong className="text-sm text-[var(--primary)]">{formatRp(draftTotals.net)}</strong>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => savePayroll(false)}
                      className="flex-1 sm:flex-initial px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                    >
                      Simpan Draft
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => savePayroll(true)}
                      className="flex-1 sm:flex-initial px-4 py-2 rounded-lg bg-[var(--success)] text-white text-xs font-semibold hover:opacity-90 cursor-pointer"
                    >
                      {saving ? 'Menyimpan...' : 'Finalisasi & Bayar'}
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      ) : (
        /* TAB 2: Minimalist Accordion History */
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3">
          {loading ? (
            <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">Memuat riwayat payroll...</div>
          ) : payrolls.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">
              Belum ada payroll tersimpan. Buka tab <strong>Input Payroll</strong> untuk memulai.
            </div>
          ) : (
            <div className="space-y-2.5">
              {payrolls.map((run) => {
                const isOpen = expandedRunIds.has(run.id);
                return (
                  <div
                    key={run.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden"
                  >
                    <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">{run.periodLabel}</span>
                          {run.status === 'paid' ? (
                            <span className="px-2 py-0.5 rounded border border-[var(--success)] text-[var(--success)] text-[11px] font-medium">
                              Dibayar {run.paidAt ? `· ${formatDateTimeShort(run.paidAt)}` : ''}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--warning)] text-[11px] font-medium">
                              Draft
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)] tabular-nums">
                          {formatDateIndo(run.fromDate)} – {formatDateIndo(run.toDate)} · {run.items.length} kru · Pot.
                          Kasbon {formatRp(run.totalKasbonDeducted)} ·{' '}
                          <strong className="text-[var(--primary)]">Bersih {formatRp(run.totalNet)}</strong>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleExpandRun(run.id)}
                          className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                        >
                          {isOpen ? 'Tutup ▲' : `Lihat Slip (${run.items.length}) ▼`}
                        </button>
                        {run.status === 'draft' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(run.id);
                                setPeriodLabel(run.periodLabel);
                                setFromDate(run.fromDate);
                                setToDate(run.toDate);
                                setOutletId(run.outletId);
                                setDraftItems(run.items);
                                setExpandedEmpIds(new Set());
                                setActiveTab('editor');
                                onToast('Draft dibuka di tab Input Payroll.', 'info');
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDraft(run.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:text-[var(--error)] text-xs cursor-pointer"
                            >
                              Hapus
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => exportPayrollCsv(run)}
                          className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                        >
                          CSV
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-[var(--card-border)] bg-[var(--card)]/60 p-3 -mx-0 overflow-x-auto">
                        <table className="w-full min-w-[540px] text-xs text-left border-collapse">
                          <thead>
                            <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                              <th className="py-1.5 pr-3 font-medium">Karyawan</th>
                              <th className="py-1.5 px-2 font-medium text-right">Gaji Kotor</th>
                              <th className="py-1.5 px-2 font-medium text-right">Pot. Kasbon</th>
                              <th className="py-1.5 px-2 font-medium text-right">Gaji Bersih</th>
                              <th className="py-1.5 pl-2 font-medium text-right">Slip</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                            {run.items.map((it) => {
                              const oName =
                                it.outletId === 'all'
                                  ? 'Semua Outlet'
                                  : outlets.find((o) => o.id === it.outletId)?.name || it.outletId;
                              return (
                                <tr key={it.employeeId} className="hover:bg-[var(--background)]">
                                  <td className="py-2 pr-3 whitespace-nowrap">
                                    <span className="font-semibold">{it.employeeName}</span>
                                    <span className="text-[11px] text-[var(--muted-foreground)] ml-1.5">
                                      ({it.roleTitle})
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-right whitespace-nowrap">{formatRp(it.grossPay)}</td>
                                  <td className="py-2 px-2 text-right whitespace-nowrap text-[var(--error)]">
                                    {it.kasbonDeduction > 0 ? `-${formatRp(it.kasbonDeduction)}` : '-'}
                                  </td>
                                  <td className="py-2 px-2 text-right whitespace-nowrap font-bold text-[var(--primary)]">
                                    {formatRp(it.netPay)}
                                  </td>
                                  <td className="py-2 pl-2 text-right whitespace-nowrap space-x-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        downloadPayslipPdf({
                                          periodLabel: run.periodLabel,
                                          fromDate: run.fromDate,
                                          toDate: run.toDate,
                                          status: run.status,
                                          paidAt: run.paidAt,
                                          outletName: oName,
                                          item: it,
                                        });
                                        onToast(`Slip PDF ${it.employeeName} diunduh.`, 'success');
                                      }}
                                      className="px-2 py-0.5 rounded bg-[var(--primary)] text-[var(--primary-foreground)] text-[11px] font-medium hover:opacity-90 cursor-pointer"
                                    >
                                      PDF
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSlipModalText(buildSlipWa(run, it))}
                                      className="px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-[11px] cursor-pointer"
                                    >
                                      WA
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Slip Gaji WA Modal */}
      {slipModalText !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Slip Gaji untuk WhatsApp</h3>
              <button
                type="button"
                onClick={() => setSlipModalText(null)}
                className="text-xs text-[var(--muted-foreground)] px-2 py-1 cursor-pointer"
              >
                Tutup
              </button>
            </div>
            <textarea
              readOnly
              rows={14}
              value={slipModalText}
              className="w-full p-3 rounded-lg border border-[var(--border)] bg-[var(--background)] font-mono text-xs leading-relaxed"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSlipModalText(null)}
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
                      await navigator.clipboard.writeText(slipModalText);
                      copied = true;
                    }
                  } catch {
                    copied = false;
                  }
                  if (!copied) {
                    try {
                      const ta = document.createElement('textarea');
                      ta.value = slipModalText;
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
                    onToast('Slip gaji disalin untuk WhatsApp!', 'success');
                    setSlipModalText(null);
                  } else {
                    onToast('Gagal menyalin otomatis. Salin manual dari kotak teks.', 'warning');
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

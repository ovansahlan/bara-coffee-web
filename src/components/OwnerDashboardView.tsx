'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_CASH_DROP_METHODS, calcShiftMetrics, formatDateIndo, formatDateTimeShort, formatRp, getLocalDateStr } from '@/lib/calc';
import type { AppSettingsPublic, OutletPublic, ShiftRecord } from '@/lib/types';

interface TodayOutletCard {
  outlet: OutletPublic;
  omsetToday: number;
  expenseToday: number;
  runningCash: number;
  shift1Status: string;
  shift1Diff: number | null;
  shift2Status: string;
  shift2Diff: number | null;
  suggestedShift: 1 | 2;
}

interface OwnerDashboardViewProps {
  settings: AppSettingsPublic;
  onOpenShift: (outletId: string, date: string, shift: 1 | 2) => void;
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

function StatusBadge({ status, diff }: { status: string; diff: number | null }) {
  if (status === 'balanced') {
    return (
      <span className="px-2 py-0.5 rounded text-xs border border-[var(--success)] text-[var(--success)] font-medium">
        Balance &#10003;
      </span>
    );
  }
  if (status === 'surplus') {
    return (
      <span className="px-2 py-0.5 rounded text-xs border border-[var(--warning)] text-[var(--warning)] font-medium">
        Lebih +{formatRp(diff)}
      </span>
    );
  }
  if (status === 'deficit') {
    return (
      <span className="px-2 py-0.5 rounded text-xs border border-[var(--error)] text-[var(--error)] font-medium">
        Kurang {formatRp(diff)}
      </span>
    );
  }
  if (status === 'draft') {
    return (
      <span className="px-2 py-0.5 rounded text-xs border border-[var(--border)] text-[var(--muted-foreground)]">
        Draft
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-xs bg-[var(--secondary)] text-[var(--muted-foreground)]">
      Belum Input
    </span>
  );
}

export default function OwnerDashboardView({
  settings,
  onOpenShift,
  onToast,
}: OwnerDashboardViewProps) {
  const [loading, setLoading] = useState(true);
  const [outletFilter, setOutletFilter] = useState('all');
  const [rangeFilter, setRangeFilter] = useState('7days');
  const [expCatFilter, setExpCatFilter] = useState('all');
  const [dropMethodFilter, setDropMethodFilter] = useState('all');

  const [today, setToday] = useState(getLocalDateStr(0));
  const [outlets, setOutlets] = useState<OutletPublic[]>([]);
  const [todayCards, setTodayCards] = useState<TodayOutletCard[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ShiftRecord | null>(null);

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ outletId: outletFilter, range: rangeFilter });
      const res = await fetch(`/api/owner/dashboard?${params.toString()}`, { cache: 'no-store', signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat Dashboard Owner.');
      if (signal?.aborted) return;
      setToday(data.today);
      setOutlets(data.outlets || []);
      setTodayCards(data.todayCards || []);
      setShifts(data.shifts || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onToast(err instanceof Error ? err.message : 'Gagal memuat Dashboard.', 'error');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [outletFilter, rangeFilter, onToast]);

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard]);

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const todayCombinedOmset = useMemo(
    () => todayCards.reduce((s, c) => s + c.omsetToday, 0),
    [todayCards]
  );

  const summary = useMemo(() => {
    let omset = 0,
      tunai = 0,
      qris = 0,
      online = 0,
      edc = 0,
      expense = 0,
      cashDrop = 0,
      balanced = 0,
      issue = 0,
      draft = 0;

    shifts.forEach((r) => {
      const m = calcShiftMetrics(r);
      omset += m.totalOmset;
      tunai += r.breakdown.tunai;
      qris += r.breakdown.qris;
      online += r.breakdown.online;
      edc += r.breakdown.edc;
      expense += m.totalExpense;
      cashDrop += m.cashDrop;
      if (m.status === 'balanced') balanced++;
      else if (m.status === 'surplus' || m.status === 'deficit') issue++;
      else draft++;
    });

    return { omset, tunai, qris, online, edc, expense, cashDrop, balanced, issue, draft };
  }, [shifts]);

  const alerts = useMemo(
    () =>
      shifts.filter((r) => {
        const st = calcShiftMetrics(r).status;
        return st === 'deficit' || st === 'surplus' || st === 'draft';
      }),
    [shifts]
  );

  const allCorrections = useMemo(() => {
    const arr: Array<{
      outletId: string;
      outletName: string;
      date: string;
      shift: 1 | 2;
      id: string;
      actor: string;
      reason: string;
      changes: string[];
      at: string;
    }> = [];
    shifts.forEach((r) => {
      const o = outletMap.get(r.outletId);
      r.correctionLogs.forEach((log) => {
        arr.push({
          outletId: r.outletId,
          outletName: o?.name || r.outletId,
          date: r.date,
          shift: r.shift,
          id: log.id,
          actor: log.actor,
          reason: log.reason,
          changes: log.changes,
          at: log.at,
        });
      });
    });
    return arr.sort((a, b) => b.at.localeCompare(a.at));
  }, [shifts, outletMap]);

  const allExpenses = useMemo(() => {
    const items = shifts.flatMap((r) => {
      const o = outletMap.get(r.outletId);
      return r.expenses.map((e) => ({
        ...e,
        outletName: o?.name || r.outletId,
        cashier: r.cashier,
      }));
    });
    return items.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.shift !== b.shift) return b.shift - a.shift;
      return b.time.localeCompare(a.time);
    });
  }, [shifts, outletMap]);

  const expenseCategories = useMemo(() => {
    const set = new Set(settings.expenseCategories);
    allExpenses.forEach((e) => set.add(e.category));
    return [...set];
  }, [settings.expenseCategories, allExpenses]);

  const filteredExpenses = useMemo(
    () => (expCatFilter === 'all' ? allExpenses : allExpenses.filter((e) => e.category === expCatFilter)),
    [allExpenses, expCatFilter]
  );

  const allCashDrops = useMemo(() => {
    const items = shifts.flatMap((r) => {
      const o = outletMap.get(r.outletId);
      const outletName = o?.name || r.outletId;
      if (r.cashDrops && r.cashDrops.length > 0) {
        return r.cashDrops.map((d) => ({
          ...d,
          outletName,
          cashier: r.cashier,
        }));
      }
      if (r.cashDrop > 0) {
        return [
          {
            id: `legacy-drop-${r.id}`,
            shiftId: r.id,
            outletId: r.outletId,
            outletName,
            date: r.date,
            shift: r.shift,
            cashier: r.cashier,
            method: 'Setor Owner',
            note: r.balanceNote || 'Setoran shift tercatat',
            amount: r.cashDrop,
            time: '',
          },
        ];
      }
      return [];
    });
    return items.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.shift !== b.shift) return b.shift - a.shift;
      return b.time.localeCompare(a.time);
    });
  }, [shifts, outletMap]);

  const cashDropMethods = useMemo(() => {
    const set = new Set(DEFAULT_CASH_DROP_METHODS);
    allCashDrops.forEach((d) => set.add(d.method));
    return [...set];
  }, [allCashDrops]);

  const filteredCashDrops = useMemo(
    () =>
      dropMethodFilter === 'all'
        ? allCashDrops
        : allCashDrops.filter((d) => d.method === dropMethodFilter),
    [allCashDrops, dropMethodFilter]
  );

  async function confirmDeleteShift() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/shifts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus shift.');
      onToast('Laporan shift dihapus & saldo berjalan diperbarui.', 'info');
      loadDashboard();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus shift.', 'error');
    }
  }

  function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
    const csv =
      '\uFEFF' +
      [
        headers.join(','),
        ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportOmsetCsv() {
    if (shifts.length === 0) return onToast('Tidak ada data untuk diekspor.', 'warning');
    downloadCsv(
      `bara-coffee-rekap-${today}.csv`,
      [
        'Tanggal',
        'Outlet',
        'Shift',
        'Kasir',
        'Total Omset',
        'Tunai',
        'QRIS',
        'Online Delivery',
        'EDC/Transfer',
        'Saldo Sebelumnya',
        'Total Pengeluaran',
        'Setor ke Owner',
        'Saldo Akhir Seharusnya',
        'Uang Fisik',
        'Selisih',
        'Status',
        'Catatan',
      ],
      shifts.map((r) => {
        const m = calcShiftMetrics(r);
        return [
          r.date,
          outletMap.get(r.outletId)?.name || r.outletId,
          `Shift ${r.shift}`,
          r.cashier,
          m.totalOmset,
          r.breakdown.tunai,
          r.breakdown.qris,
          r.breakdown.online,
          r.breakdown.edc,
          m.openingCash,
          m.totalExpense,
          m.cashDrop,
          m.expectedCash,
          r.actualCash ?? '',
          m.diff ?? '',
          m.status,
          r.balanceNote.replace(/\r?\n/g, ' '),
        ];
      })
    );
    onToast('CSV Rekap Omset diunduh.', 'success');
  }

  function exportExpensesCsv() {
    if (filteredExpenses.length === 0) return onToast('Tidak ada data pengeluaran.', 'warning');
    downloadCsv(
      `bara-coffee-pengeluaran-${today}.csv`,
      ['Tanggal', 'Jam', 'Outlet', 'Shift', 'Kasir', 'Kategori', 'Keterangan', 'Nominal'],
      filteredExpenses.map((e) => [
        e.date,
        e.time,
        e.outletName,
        `Shift ${e.shift}`,
        e.cashier,
        e.category,
        e.desc,
        e.amount,
      ])
    );
    onToast('CSV Detail Pengeluaran diunduh.', 'success');
  }

  function exportCashDropsCsv() {
    if (filteredCashDrops.length === 0) return onToast('Tidak ada data setoran ke Owner/Bank.', 'warning');
    downloadCsv(
      `bara-coffee-setoran-owner-${today}.csv`,
      ['Tanggal', 'Jam', 'Outlet', 'Shift', 'Kasir', 'Metode', 'Keterangan', 'Nominal'],
      filteredCashDrops.map((d) => [
        d.date,
        d.time,
        d.outletName,
        `Shift ${d.shift}`,
        d.cashier,
        d.method,
        d.note,
        d.amount,
      ])
    );
    onToast('CSV Riwayat Setoran diunduh.', 'success');
  }

  const totalPay = summary.tunai + summary.qris + summary.online + summary.edc;
  const chartColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

  return (
    <div className="space-y-5">
      {/* Today Live Monitor */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Pemantauan Hari Ini ({formatDateIndo(today)})</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Status live Shift 1 &amp; Shift 2, omset hari ini, serta Saldo Kas Berjalan tiap outlet.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-xs font-semibold tabular-nums px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)]">
              Total Omset Hari Ini: {formatRp(todayCombinedOmset)}
            </span>
            <button
              type="button"
              onClick={() => loadDashboard()}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
            >
              Segarkan
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {todayCards.map((c) => (
            <div key={c.outlet.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{c.outlet.name}</h3>
                  <p className="text-xs text-[var(--muted-foreground)]">{c.outlet.location || 'Outlet Bara Coffee'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenShift(c.outlet.id, today, c.suggestedShift)}
                  className="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                >
                  Audit &rarr;
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 tabular-nums">
                <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--card-border)]">
                  <div className="text-[11px] sm:text-xs text-[var(--muted-foreground)]">Omset Hari Ini</div>
                  <div className="text-sm font-semibold mt-0.5">{formatRp(c.omsetToday)}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--card-border)]">
                  <div className="text-[11px] sm:text-xs text-[var(--muted-foreground)]">Pengeluaran</div>
                  <div className="text-sm font-semibold text-[var(--error)] mt-0.5">{formatRp(c.expenseToday)}</div>
                </div>
                <div className="col-span-2 sm:col-span-1 p-2.5 rounded-lg bg-[var(--background)] border border-[var(--card-border)]">
                  <div className="text-[11px] sm:text-xs text-[var(--muted-foreground)]">Saldo Kas Berjalan</div>
                  <div className="text-sm font-semibold text-[var(--primary)] mt-0.5">{formatRp(c.runningCash)}</div>
                </div>
              </div>
              <div className="pt-2 border-t border-[var(--card-border)] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--muted-foreground)]">Shift 1:</span>
                  <StatusBadge status={c.shift1Status} diff={c.shift1Diff} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--muted-foreground)]">Shift 2:</span>
                  <StatusBadge status={c.shift2Status} diff={c.shift2Diff} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <section className="bg-[var(--card)] border border-[var(--warning)] rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[var(--warning)]">
              Perlu Perhatian Owner (Selisih Kas / Belum Check Balance)
            </h3>
            <span className="text-xs font-semibold tabular-nums text-[var(--warning)]">{alerts.length} catatan</span>
          </div>
          <div className="divide-y divide-[var(--card-border)]">
            {alerts.slice(0, 6).map((r) => {
              const m = calcShiftMetrics(r);
              return (
                <div key={r.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium">{outletMap.get(r.outletId)?.name || r.outletId}</span>
                    <span className="text-[var(--muted-foreground)]">
                      {' '}
                      &middot; {formatDateIndo(r.date)} &middot; Shift {r.shift}
                      {r.cashier ? ` (${r.cashier})` : ''}
                    </span>
                    {r.balanceNote && (
                      <div className="text-[var(--muted-foreground)] truncate mt-0.5">Catatan: {r.balanceNote}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={m.status} diff={m.diff} />
                    <button
                      type="button"
                      onClick={() => onOpenShift(r.outletId, r.date, r.shift)}
                      className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
                    >
                      Periksa
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Correction Audit Trail */}
      {allCorrections.length > 0 && (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold">Jejak Koreksi Omset &amp; Shift (Audit Owner)</h3>
            <span className="text-xs text-[var(--muted-foreground)] tabular-nums">{allCorrections.length} koreksi</span>
          </div>
          <div className="divide-y divide-[var(--card-border)]">
            {allCorrections.slice(0, 6).map((c) => (
              <div key={c.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 text-xs">
                <div className="space-y-1 min-w-0">
                  <div>
                    <span className="font-semibold">{c.outletName}</span>
                    <span className="text-[var(--muted-foreground)]">
                      {' '}
                      &middot; {formatDateIndo(c.date)} &middot; Shift {c.shift} &middot; oleh {c.actor} (
                      {formatDateTimeShort(c.at)})
                    </span>
                  </div>
                  <div className="text-[var(--muted-foreground)]">
                    Alasan: <span className="text-[var(--foreground)]">{c.reason}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 tabular-nums">
                    {c.changes.map((ch, idx) => (
                      <span key={idx} className="px-2 py-0.5 rounded bg-[var(--background)] border border-[var(--border)]">
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenShift(c.outletId, c.date, c.shift)}
                  className="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium shrink-0 self-start cursor-pointer"
                >
                  Lihat Shift
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 w-full md:w-auto">
          <div className="space-y-1">
            <label className="text-xs text-[var(--muted-foreground)] block">Filter Outlet</label>
            <select
              value={outletFilter}
              onChange={(e) => setOutletFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
            >
              <option value="all">Semua Outlet ({outlets.length})</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[var(--muted-foreground)] block">Periode</label>
            <select
              value={rangeFilter}
              onChange={(e) => setRangeFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
            >
              <option value="today">Hari Ini</option>
              <option value="7days">7 Hari Terakhir</option>
              <option value="30days">30 Hari Terakhir</option>
              <option value="all">Semua Riwayat</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={exportOmsetCsv}
          className="w-full sm:w-auto px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
        >
          Ekspor CSV Omset
        </button>
      </section>

      {loading ? (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center text-xs text-[var(--muted-foreground)]">
          Memuat rekap lintas outlet...
        </div>
      ) : (
        <>
          {/* Consolidated KPIs */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Total Omset</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatRp(summary.omset)}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{shifts.length} laporan shift</p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Total Masuk Tunai</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatRp(summary.tunai)}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5 tabular-nums">
                Setor Owner: <strong className="text-[var(--primary)]">{formatRp(summary.cashDrop)}</strong>
              </p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Total Pengeluaran Kas Kecil</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-[var(--error)]">{formatRp(summary.expense)}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Neto tunai: {formatRp(summary.tunai - summary.expense)}
              </p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Kepatuhan Check Balance</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-[var(--success)]">
                {summary.balanced} Balance
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                {summary.issue} selisih &middot; {summary.draft} belum cek
              </p>
            </div>
          </section>

          {/* Outlet Comparison & Payment Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section className="lg:col-span-7 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Perbandingan Per Outlet</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Omset, tunai, pengeluaran kas kecil, dan status check balance per cabang.
                </p>
              </div>
              <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                <table className="w-full min-w-[540px] text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                      <th className="py-2 pr-3 font-medium">Outlet</th>
                      <th className="py-2 px-2 font-medium text-right">Omset</th>
                      <th className="py-2 px-2 font-medium text-right">Tunai</th>
                      <th className="py-2 px-2 font-medium text-right">Pengeluaran</th>
                      <th className="py-2 pl-2 font-medium text-right">Status Shift</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                    {outlets.map((o) => {
                      const rows = shifts.filter((r) => r.outletId === o.id);
                      let omset = 0,
                        tunai = 0,
                        exp = 0,
                        bal = 0,
                        iss = 0;
                      rows.forEach((r) => {
                        const m = calcShiftMetrics(r);
                        omset += m.totalOmset;
                        tunai += r.breakdown.tunai;
                        exp += m.totalExpense;
                        if (m.status === 'balanced') bal++;
                        if (m.status === 'surplus' || m.status === 'deficit') iss++;
                      });
                      return (
                        <tr key={o.id}>
                          <td className="py-2.5 pr-3">
                            <div className="font-medium">{o.name}</div>
                            <div className="text-[var(--muted-foreground)]">{o.location}</div>
                          </td>
                          <td className="py-2.5 px-2 text-right font-semibold">{formatRp(omset)}</td>
                          <td className="py-2.5 px-2 text-right">{formatRp(tunai)}</td>
                          <td className="py-2.5 px-2 text-right text-[var(--error)]">{formatRp(exp)}</td>
                          <td className="py-2.5 pl-2 text-right">
                            <span className="text-[var(--success)] font-medium">{bal} OK</span>
                            {iss > 0 && <span className="text-[var(--error)] ml-1.5 font-medium">{iss} Selisih</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="lg:col-span-5 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Komposisi Metode Pembayaran</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Proporsi Tunai, QRIS, Online Delivery &amp; EDC/Transfer.
                </p>
              </div>
              <div className="space-y-3 pt-1">
                {[
                  { label: 'Tunai (Cash)', val: summary.tunai, color: 'var(--chart-1)' },
                  { label: 'QRIS', val: summary.qris, color: 'var(--chart-2)' },
                  { label: 'Online Delivery', val: summary.online, color: 'var(--chart-3)' },
                  { label: 'EDC / Transfer', val: summary.edc, color: 'var(--chart-4)' },
                ].map((m) => {
                  const pct = totalPay > 0 ? Math.round((m.val / totalPay) * 100) : 0;
                  return (
                    <div key={m.label} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{m.label}</span>
                        <span className="tabular-nums text-[var(--muted-foreground)]">
                          <strong className="text-[var(--foreground)]">{formatRp(m.val)}</strong> ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--secondary)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Shift History Table */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Riwayat &amp; Audit Laporan Shift Semua Outlet</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Klik &ldquo;Audit&rdquo; untuk memeriksa atau mengoreksi detail shift cabang tersebut.
                </p>
              </div>
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums">{shifts.length} laporan</span>
            </div>
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[780px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 px-2 font-medium">Outlet</th>
                    <th className="py-2 px-2 font-medium">Shift / Kasir</th>
                    <th className="py-2 px-2 font-medium text-right">Total Omset</th>
                    <th className="py-2 px-2 font-medium text-right">Tunai</th>
                    <th className="py-2 px-2 font-medium text-right">Pengeluaran</th>
                    <th className="py-2 px-2 font-medium text-right">Setor Owner</th>
                    <th className="py-2 px-2 font-medium text-right">Saldo Akhir</th>
                    <th className="py-2 px-2 font-medium text-center">Check Balance</th>
                    <th className="py-2 pl-2 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                  {shifts.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-[var(--muted-foreground)]">
                        Belum ada data laporan shift pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    shifts.map((r) => {
                      const m = calcShiftMetrics(r);
                      return (
                        <tr key={r.id} className="hover:bg-[var(--background)]">
                          <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateIndo(r.date)}</td>
                          <td className="py-2.5 px-2 font-medium whitespace-nowrap">
                            {outletMap.get(r.outletId)?.name || r.outletId}
                          </td>
                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <span>Shift {r.shift}</span>
                            {r.cashier && <span className="text-[var(--muted-foreground)]"> &middot; {r.cashier}</span>}
                            {r.correctionLogs.length > 0 && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[var(--warning)] font-medium">
                                Dikoreksi ({r.correctionLogs.length})
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right font-semibold whitespace-nowrap">
                            {formatRp(m.totalOmset)}
                          </td>
                          <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatRp(r.breakdown.tunai)}</td>
                          <td className="py-2.5 px-2 text-right text-[var(--error)] whitespace-nowrap">
                            {formatRp(m.totalExpense)}
                          </td>
                          <td className="py-2.5 px-2 text-right font-medium text-[var(--primary)] whitespace-nowrap">
                            {m.cashDrop > 0 ? formatRp(m.cashDrop) : '-'}
                          </td>
                          <td className="py-2.5 px-2 text-right font-medium whitespace-nowrap">
                            {formatRp(m.expectedCash)}
                          </td>
                          <td className="py-2.5 px-2 text-center whitespace-nowrap">
                            <StatusBadge status={m.status} diff={m.diff} />
                          </td>
                          <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onOpenShift(r.outletId, r.date, r.shift)}
                              className="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
                            >
                              Audit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(r)}
                              title="Hapus laporan"
                              className="ml-1 px-2 py-1 rounded border border-[var(--border)] hover:text-[var(--error)] cursor-pointer"
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
          </section>

          {/* Rekap & Riwayat Setor ke Owner / Bank */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--card-border)]">
              <div>
                <h2 className="text-sm font-semibold">Rekap &amp; Riwayat Setor ke Owner / Bank</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Pelacakan seluruh setoran kas dari outlet ke Owner / rekening bank sesuai filter outlet &amp; periode.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={dropMethodFilter}
                  onChange={(e) => setDropMethodFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                >
                  <option value="all">Semua Metode</option>
                  {cashDropMethods.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={exportCashDropsCsv}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                >
                  CSV Setoran
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--card-border)] space-y-1">
                <div className="text-xs text-[var(--muted-foreground)]">Total Setor Periode Ini</div>
                <div className="text-base font-semibold tabular-nums text-[var(--primary)]">
                  {formatRp(allCashDrops.reduce((s, d) => s + d.amount, 0))}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] tabular-nums">
                  {allCashDrops.length} kali setoran
                </div>
              </div>
              {outlets.map((o) => {
                const matched = allCashDrops.filter((d) => d.outletId === o.id);
                const total = matched.reduce((s, d) => s + d.amount, 0);
                return (
                  <div
                    key={o.id}
                    className="p-3 rounded-lg bg-[var(--background)] border border-[var(--card-border)] space-y-1"
                  >
                    <div className="text-xs font-medium truncate">{o.name}</div>
                    <div className="text-base font-semibold tabular-nums text-[var(--primary)]">
                      {formatRp(total)}
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] tabular-nums">
                      {matched.length} transaksi setoran
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[780px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Tanggal &amp; Jam</th>
                    <th className="py-2 px-2 font-medium">Outlet</th>
                    <th className="py-2 px-2 font-medium">Shift / Kasir</th>
                    <th className="py-2 px-2 font-medium">Metode</th>
                    <th className="py-2 px-2 font-medium">Keterangan</th>
                    <th className="py-2 px-2 font-medium text-right">Nominal</th>
                    <th className="py-2 pl-2 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                  {filteredCashDrops.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-7 text-center text-[var(--muted-foreground)]">
                        Belum ada riwayat setoran ke Owner / Bank pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    filteredCashDrops.map((d) => (
                      <tr key={d.id} className="hover:bg-[var(--background)]">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatDateIndo(d.date)}{' '}
                          {d.time && <span className="text-[var(--muted-foreground)]">{d.time}</span>}
                        </td>
                        <td className="py-2 px-2 font-medium whitespace-nowrap">{d.outletName}</td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          Shift {d.shift}
                          {d.cashier && <span className="text-[var(--muted-foreground)]"> &middot; {d.cashier}</span>}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">{d.method}</span>
                        </td>
                        <td className="py-2 px-2 text-[var(--muted-foreground)]">{d.note || '-'}</td>
                        <td className="py-2 px-2 text-right font-semibold text-[var(--primary)] whitespace-nowrap">
                          {formatRp(d.amount)}
                        </td>
                        <td className="py-2 pl-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onOpenShift(d.outletId, d.date, d.shift)}
                            className="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
                          >
                            Lihat Shift
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredCashDrops.length > 0 && (
                  <tfoot className="border-t border-[var(--border)] font-semibold tabular-nums">
                    <tr>
                      <td colSpan={5} className="py-2.5 pr-3 text-right text-[var(--muted-foreground)]">
                        Total Setoran ({filteredCashDrops.length} transaksi
                        {dropMethodFilter !== 'all' ? ` · ${dropMethodFilter}` : ''})
                      </td>
                      <td className="py-2.5 px-2 text-right text-[var(--primary)] whitespace-nowrap">
                        {formatRp(filteredCashDrops.reduce((s, d) => s + d.amount, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* Rekap & Detail Pengeluaran Kas Kecil */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--card-border)]">
              <div>
                <h2 className="text-sm font-semibold">Rekap &amp; Detail Pengeluaran Kas Kecil</h2>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Rincian item pengeluaran per kategori (Minuman, Makanan, Lain-Lain) sesuai filter outlet &amp; periode.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={expCatFilter}
                  onChange={(e) => setExpCatFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                >
                  <option value="all">Semua Kategori</option>
                  {expenseCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={exportExpensesCsv}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
                >
                  CSV Pengeluaran
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {expenseCategories.map((cat, idx) => {
                const matched = allExpenses.filter((e) => e.category === cat);
                const total = matched.reduce((s, e) => s + e.amount, 0);
                const grand = allExpenses.reduce((s, e) => s + e.amount, 0);
                const pct = grand > 0 ? Math.round((total / grand) * 100) : 0;
                return (
                  <div
                    key={cat}
                    className="p-3 rounded-lg bg-[var(--background)] border border-[var(--card-border)] space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{cat}</span>
                      <span className="text-[var(--muted-foreground)] tabular-nums">
                        {matched.length} item &middot; {pct}%
                      </span>
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-[var(--error)]">{formatRp(total)}</div>
                    <div className="h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: chartColors[idx % chartColors.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[780px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Tanggal &amp; Jam</th>
                    <th className="py-2 px-2 font-medium">Outlet</th>
                    <th className="py-2 px-2 font-medium">Shift / Kasir</th>
                    <th className="py-2 px-2 font-medium">Kategori</th>
                    <th className="py-2 px-2 font-medium">Keterangan Pengeluaran</th>
                    <th className="py-2 pl-2 font-medium text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-7 text-center text-[var(--muted-foreground)]">
                        Tidak ada detail pengeluaran pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    filteredExpenses.map((it) => (
                      <tr key={it.id} className="hover:bg-[var(--background)]">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatDateIndo(it.date)}{' '}
                          {it.time && <span className="text-[var(--muted-foreground)]">{it.time}</span>}
                        </td>
                        <td className="py-2 px-2 font-medium whitespace-nowrap">{it.outletName}</td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          Shift {it.shift}
                          {it.cashier && <span className="text-[var(--muted-foreground)]"> &middot; {it.cashier}</span>}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">{it.category}</span>
                        </td>
                        <td className="py-2 px-2">{it.desc}</td>
                        <td className="py-2 pl-2 text-right font-semibold text-[var(--error)] whitespace-nowrap">
                          -{formatRp(it.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredExpenses.length > 0 && (
                  <tfoot className="border-t border-[var(--border)] font-semibold tabular-nums">
                    <tr>
                      <td colSpan={5} className="py-2.5 pr-3 text-right text-[var(--muted-foreground)]">
                        Total ({filteredExpenses.length} item{expCatFilter !== 'all' ? ` · ${expCatFilter}` : ''})
                      </td>
                      <td className="py-2.5 pl-2 text-right text-[var(--error)] whitespace-nowrap">
                        -{formatRp(filteredExpenses.reduce((s, e) => s + e.amount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </>
      )}

      {/* Confirm Delete Shift Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-sm w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Hapus Laporan Shift</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Laporan {formatDateIndo(deleteTarget.date)} Shift {deleteTarget.shift} akan dihapus permanen dan saldo
                kas berjalan pada shift berikutnya akan dihitung ulang otomatis.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDeleteShift}
                className="px-4 py-2 rounded-lg bg-[var(--error)] text-white text-xs font-semibold cursor-pointer"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

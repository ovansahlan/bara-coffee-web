'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_CASH_DROP_METHODS, calcShiftMetrics, formatDateIndo, formatDateTimeShort, formatRp, getLocalDateStr } from '@/lib/calc';
import type { AppSettingsPublic, OutletPublic, OwnerExpenseRecord, ShiftRecord } from '@/lib/types';

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
  const [ownerExpenses, setOwnerExpenses] = useState<OwnerExpenseRecord[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ShiftRecord | null>(null);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [detailTab, setDetailTab] = useState<'shifts' | 'expenses' | 'cashdrops' | 'audit'>('shifts');

  async function handleSyncGoogleSheet() {
    setSyncingSheet(true);
    try {
      const res = await fetch('/api/sync-sheets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal sinkronisasi ke Google Sheets.');
      onToast('Data berhasil disinkronkan ke Google Sheets!', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal sinkronisasi Google Sheets.', 'error');
    } finally {
      setSyncingSheet(false);
    }
  }

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
      setOwnerExpenses(data.ownerExpenses || []);
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
  const totalOwnerExpense = useMemo(
    () => ownerExpenses.reduce((s, e) => s + e.amount, 0),
    [ownerExpenses]
  );
  const chartColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

  return (
    <div className="space-y-4">
      {/* Today Live Monitor */}
      <section className="space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Hari Ini &middot; {formatDateIndo(today)}</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Pantauan omset, pengeluaran, &amp; saldo kas berjalan tiap outlet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <span className="text-xs font-semibold tabular-nums px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)]">
              Omset Hari Ini: {formatRp(todayCombinedOmset)}
            </span>
            <button
              type="button"
              disabled={syncingSheet}
              onClick={handleSyncGoogleSheet}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 text-xs font-semibold cursor-pointer"
            >
              {syncingSheet ? 'Menyinkronkan...' : 'Sync Sheet'}
            </button>
            <button
              type="button"
              onClick={() => loadDashboard()}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
            >
              Segarkan
            </button>
          </div>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
          <div className="-mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto">
            <table className="w-full min-w-[680px] text-xs text-left border-collapse tabular-nums">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="py-2 pr-3 font-medium">Outlet</th>
                  <th className="py-2 px-2 font-medium text-right">Omset Hari Ini</th>
                  <th className="py-2 px-2 font-medium text-right">Belanja Kasir</th>
                  <th className="py-2 px-2 font-medium text-right">Saldo Kas Berjalan</th>
                  <th className="py-2 px-2 font-medium text-center">Shift 1</th>
                  <th className="py-2 px-2 font-medium text-center">Shift 2</th>
                  <th className="py-2 pl-2 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)]">
                {todayCards.map((c) => (
                  <tr key={c.outlet.id} className="hover:bg-[var(--background)]">
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <div className="font-semibold text-[var(--foreground)]">{c.outlet.name}</div>
                      {c.outlet.location && (
                        <div className="text-[11px] text-[var(--muted-foreground)]">{c.outlet.location}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right font-semibold whitespace-nowrap">
                      {formatRp(c.omsetToday)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-medium text-[var(--error)] whitespace-nowrap">
                      {formatRp(c.expenseToday)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-semibold text-[var(--primary)] whitespace-nowrap">
                      {formatRp(c.runningCash)}
                    </td>
                    <td className="py-2.5 px-2 text-center whitespace-nowrap">
                      <StatusBadge status={c.shift1Status} diff={c.shift1Diff} />
                    </td>
                    <td className="py-2.5 px-2 text-center whitespace-nowrap">
                      <StatusBadge status={c.shift2Status} diff={c.shift2Diff} />
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenShift(c.outlet.id, today, c.suggestedShift)}
                        className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
                      >
                        Audit &rarr;
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {todayCards.length > 0 && (
                <tfoot>
                  <tr className="border-t border-[var(--border)] bg-[var(--secondary)]/50 font-semibold">
                    <td className="py-2 pr-3">Total Semua Outlet</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{formatRp(todayCombinedOmset)}</td>
                    <td className="py-2 px-2 text-right text-[var(--error)] whitespace-nowrap">
                      {formatRp(todayCards.reduce((s, c) => s + c.expenseToday, 0))}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--primary)] whitespace-nowrap">
                      {formatRp(todayCards.reduce((s, c) => s + c.runningCash, 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>

      {/* Compact Attention Banner */}
      {(alerts.length > 0 || allCorrections.length > 0) && (
        <section className="bg-[var(--card)] border border-[var(--warning)]/70 rounded-xl px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {alerts.length > 0 && (
              <span className="font-semibold text-[var(--warning)]">
                {alerts.length} shift selisih / belum check balance
              </span>
            )}
            {allCorrections.length > 0 && (
              <span className="text-[var(--muted-foreground)]">
                &middot; {allCorrections.length} jejak koreksi shift
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDetailTab('audit')}
            className="self-start sm:self-auto px-2.5 py-1 rounded-md border border-[var(--warning)]/60 text-[var(--warning)] hover:bg-[var(--warning)]/10 font-medium cursor-pointer"
          >
            Lihat Detail Audit &rarr;
          </button>
        </section>
      )}

      {/* Filters */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
          <select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
            aria-label="Filter Outlet"
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
          >
            <option value="all">Semua Outlet ({outlets.length})</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            value={rangeFilter}
            onChange={(e) => setRangeFilter(e.target.value)}
            aria-label="Filter Periode"
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
          >
            <option value="today">Hari Ini</option>
            <option value="7days">7 Hari Terakhir</option>
            <option value="30days">30 Hari Terakhir</option>
            <option value="all">Semua Riwayat</option>
          </select>
        </div>
        <button
          type="button"
          onClick={exportOmsetCsv}
          className="w-full sm:w-auto px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
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
              <p className="text-[11px] text-[var(--muted-foreground)]">Total Omset</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums mt-0.5">{formatRp(summary.omset)}</p>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{shifts.length} laporan shift</p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-[11px] text-[var(--muted-foreground)]">Tunai &amp; Setor Owner</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums mt-0.5">{formatRp(summary.tunai)}</p>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 tabular-nums">
                Setor: <strong className="text-[var(--primary)]">{formatRp(summary.cashDrop)}</strong>
              </p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-[11px] text-[var(--muted-foreground)]">Total Pengeluaran</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums mt-0.5 text-[var(--error)]">
                {formatRp(summary.expense + totalOwnerExpense)}
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 tabular-nums">
                Kasir: {formatRp(summary.expense)} &middot; Owner: {formatRp(totalOwnerExpense)}
              </p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-[11px] text-[var(--muted-foreground)]">Check Balance</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums mt-0.5 text-[var(--success)]">
                {summary.balanced} Balance
              </p>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                {summary.issue} selisih &middot; {summary.draft} belum cek
              </p>
            </div>
          </section>

          {/* Outlet Comparison & Payment Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <section className="lg:col-span-7 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-2.5">
              <h2 className="text-sm font-semibold">Perbandingan Per Outlet</h2>
              <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                <table className="w-full min-w-[480px] text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                      <th className="py-1.5 pr-3 font-medium">Outlet</th>
                      <th className="py-1.5 px-2 font-medium text-right">Omset</th>
                      <th className="py-1.5 px-2 font-medium text-right">Tunai</th>
                      <th className="py-1.5 px-2 font-medium text-right">Pengeluaran</th>
                      <th className="py-1.5 pl-2 font-medium text-right">Status</th>
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
                          <td className="py-2 pr-3 font-medium">{o.name}</td>
                          <td className="py-2 px-2 text-right font-semibold">{formatRp(omset)}</td>
                          <td className="py-2 px-2 text-right">{formatRp(tunai)}</td>
                          <td className="py-2 px-2 text-right text-[var(--error)]">{formatRp(exp)}</td>
                          <td className="py-2 pl-2 text-right whitespace-nowrap">
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

            <section className="lg:col-span-5 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-2.5">
              <h2 className="text-sm font-semibold">Komposisi Pembayaran</h2>
              <div className="space-y-2.5 pt-1">
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
                      <div className="h-1.5 rounded-full bg-[var(--secondary)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Tabbed Detail Area */}
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-1.5 pb-3 border-b border-[var(--card-border)]">
              {(
                [
                  { id: 'shifts' as const, label: `Laporan Shift (${shifts.length})` },
                  { id: 'expenses' as const, label: `Pengeluaran (${allExpenses.length + ownerExpenses.length})` },
                  { id: 'cashdrops' as const, label: `Setor Owner/Bank (${allCashDrops.length})` },
                  { id: 'audit' as const, label: `Audit & Selisih (${alerts.length + allCorrections.length})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDetailTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    detailTab === t.id
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                      : 'bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* TAB 1: LAPORAN SHIFT */}
            {detailTab === 'shifts' && (
              <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                      <th className="py-2 pr-3 font-medium">Tanggal</th>
                      <th className="py-2 px-2 font-medium">Outlet</th>
                      <th className="py-2 px-2 font-medium">Shift / Kasir</th>
                      <th className="py-2 px-2 font-medium text-right">Omset</th>
                      <th className="py-2 px-2 font-medium text-right">Tunai</th>
                      <th className="py-2 px-2 font-medium text-right">Belanja</th>
                      <th className="py-2 px-2 font-medium text-right">Setor</th>
                      <th className="py-2 px-2 font-medium text-right">Saldo Akhir</th>
                      <th className="py-2 px-2 font-medium text-center">Status</th>
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
                            <td className="py-2 pr-3 whitespace-nowrap">{formatDateIndo(r.date)}</td>
                            <td className="py-2 px-2 font-medium whitespace-nowrap">
                              {outletMap.get(r.outletId)?.name || r.outletId}
                            </td>
                            <td className="py-2 px-2 whitespace-nowrap">
                              <span>S{r.shift}</span>
                              {r.cashier && <span className="text-[var(--muted-foreground)]"> &middot; {r.cashier}</span>}
                              {r.correctionLogs.length > 0 && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[var(--secondary)] text-[var(--warning)] font-medium">
                                  Koreksi ({r.correctionLogs.length})
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right font-semibold whitespace-nowrap">
                              {formatRp(m.totalOmset)}
                            </td>
                            <td className="py-2 px-2 text-right whitespace-nowrap">{formatRp(r.breakdown.tunai)}</td>
                            <td className="py-2 px-2 text-right text-[var(--error)] whitespace-nowrap">
                              {formatRp(m.totalExpense)}
                            </td>
                            <td className="py-2 px-2 text-right font-medium text-[var(--primary)] whitespace-nowrap">
                              {m.cashDrop > 0 ? formatRp(m.cashDrop) : '-'}
                            </td>
                            <td className="py-2 px-2 text-right font-medium whitespace-nowrap">
                              {formatRp(m.expectedCash)}
                            </td>
                            <td className="py-2 px-2 text-center whitespace-nowrap">
                              <StatusBadge status={m.status} diff={m.diff} />
                            </td>
                            <td className="py-2 pl-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onOpenShift(r.outletId, r.date, r.shift)}
                                className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
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
            )}

            {/* TAB 2: PENGELUARAN (KAS KECIL + OWNER) */}
            {detailTab === 'expenses' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-xs text-[var(--muted-foreground)]">
                    Ringkasan pengeluaran kas kecil per kategori &amp; outlet, serta pengeluaran langsung owner.
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={expCatFilter}
                      onChange={(e) => setExpCatFilter(e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                    >
                      <option value="all">Semua Kategori Kas Kecil</option>
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

                {/* Category Summary Cards */}
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

                {/* Matrix Outlet x Category */}
                {outlets.length > 0 && expenseCategories.length > 0 && (
                  <div className="rounded-lg border border-[var(--card-border)] bg-[var(--background)] p-3 space-y-2">
                    <h4 className="text-xs font-semibold">Ringkasan Kas Kecil per Kategori &amp; Outlet</h4>
                    <div className="-mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto">
                      <table className="w-full min-w-[560px] text-xs text-left border-collapse tabular-nums">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                            <th className="py-1.5 pr-3 font-medium">Outlet</th>
                            {expenseCategories.map((cat) => (
                              <th key={cat} className="py-1.5 px-2 font-medium text-right">
                                {cat}
                              </th>
                            ))}
                            <th className="py-1.5 pl-2 font-medium text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--card-border)]">
                          {outlets.map((o) => {
                            const outletExps = allExpenses.filter((e) => e.outletName === o.name);
                            const outletTotal = outletExps.reduce((s, e) => s + e.amount, 0);
                            return (
                              <tr key={o.id}>
                                <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{o.name}</td>
                                {expenseCategories.map((cat) => {
                                  const catSum = outletExps
                                    .filter((e) => e.category === cat)
                                    .reduce((s, e) => s + e.amount, 0);
                                  return (
                                    <td
                                      key={cat}
                                      className={`py-1.5 px-2 text-right whitespace-nowrap ${
                                        catSum > 0 ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'
                                      }`}
                                    >
                                      {catSum > 0 ? formatRp(catSum) : '-'}
                                    </td>
                                  );
                                })}
                                <td className="py-1.5 pl-2 text-right font-semibold text-[var(--error)] whitespace-nowrap">
                                  {formatRp(outletTotal)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[var(--border)] bg-[var(--secondary)]/60 font-semibold">
                            <td className="py-1.5 pr-3">Total per Kategori</td>
                            {expenseCategories.map((cat) => {
                              const catGrand = allExpenses
                                .filter((e) => e.category === cat)
                                .reduce((s, e) => s + e.amount, 0);
                              return (
                                <td key={cat} className="py-1.5 px-2 text-right whitespace-nowrap">
                                  {formatRp(catGrand)}
                                </td>
                              );
                            })}
                            <td className="py-1.5 pl-2 text-right text-[var(--error)] whitespace-nowrap">
                              {formatRp(allExpenses.reduce((s, e) => s + e.amount, 0))}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* Detail Kas Kecil */}
                <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-xs text-left border-collapse">
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
                          <td colSpan={6} className="py-6 text-center text-[var(--muted-foreground)]">
                            Tidak ada detail pengeluaran kas kecil pada filter ini.
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
                              S{it.shift}
                              {it.cashier ? ` · ${it.cashier}` : ''}
                            </td>
                            <td className="py-2 px-2 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">
                                {it.category}
                              </span>
                            </td>
                            <td className="py-2 px-2">{it.desc}</td>
                            <td className="py-2 pl-2 text-right font-semibold text-[var(--error)] whitespace-nowrap">
                              -{formatRp(it.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pengeluaran Langsung Owner */}
                <div className="pt-3 border-t border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold">Pengeluaran Langsung Owner (Belanja Bahan &amp; Operasional)</h4>
                    <span className="text-xs font-semibold tabular-nums text-[var(--error)]">
                      Total: {formatRp(totalOwnerExpense)}
                    </span>
                  </div>
                  {ownerExpenses.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)] py-3 text-center border border-dashed border-[var(--border)] rounded-lg">
                      Belum ada pengeluaran langsung owner pada rentang filter ini. Input lewat tab <strong>Pengeluaran Owner</strong>.
                    </p>
                  ) : (
                    <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                      <table className="w-full min-w-[640px] text-xs text-left border-collapse tabular-nums">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                            <th className="py-2 pr-3 font-medium">Tanggal</th>
                            <th className="py-2 px-2 font-medium">Kategori</th>
                            <th className="py-2 px-2 font-medium">Outlet Terkait</th>
                            <th className="py-2 px-2 font-medium">Keterangan</th>
                            <th className="py-2 pl-2 font-medium text-right">Nominal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--card-border)]">
                          {ownerExpenses.slice(0, 12).map((it) => (
                            <tr key={it.id} className="hover:bg-[var(--background)]">
                              <td className="py-2 pr-3 whitespace-nowrap">{formatDateIndo(it.date)}</td>
                              <td className="py-2 px-2 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">
                                  {it.category}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                {it.outletIds.map((id) => outletMap.get(id)?.name || id).join(', ')}
                              </td>
                              <td className="py-2 px-2">{it.description}</td>
                              <td className="py-2 pl-2 text-right font-semibold text-[var(--error)] whitespace-nowrap">
                                -{formatRp(it.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: SETOR OWNER / BANK */}
            {detailTab === 'cashdrops' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-[var(--muted-foreground)]">
                    Total setoran periode ini:{' '}
                    <strong className="text-[var(--primary)]">
                      {formatRp(allCashDrops.reduce((s, d) => s + d.amount, 0))}
                    </strong>
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

                <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-xs text-left border-collapse">
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
                        filteredCashDrops.map((it) => (
                          <tr key={it.id} className="hover:bg-[var(--background)]">
                            <td className="py-2 pr-3 whitespace-nowrap">
                              {formatDateIndo(it.date)}{' '}
                              {it.time && <span className="text-[var(--muted-foreground)]">{it.time}</span>}
                            </td>
                            <td className="py-2 px-2 font-medium whitespace-nowrap">{it.outletName}</td>
                            <td className="py-2 px-2 whitespace-nowrap">
                              S{it.shift}
                              {it.cashier ? ` · ${it.cashier}` : ''}
                            </td>
                            <td className="py-2 px-2 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">
                                {it.method}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-[var(--muted-foreground)]">{it.note || '-'}</td>
                            <td className="py-2 px-2 text-right font-semibold text-[var(--primary)] whitespace-nowrap">
                              {formatRp(it.amount)}
                            </td>
                            <td className="py-2 pl-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onOpenShift(it.outletId, it.date, it.shift)}
                                className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
                              >
                                Lihat Shift
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 4: AUDIT & SELISIH */}
            {detailTab === 'audit' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-[var(--warning)]">
                    Selisih Kas / Belum Check Balance ({alerts.length})
                  </h4>
                  {alerts.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)] py-3">
                      Semua laporan shift pada filter ini sudah balance.
                    </p>
                  ) : (
                    <div className="divide-y divide-[var(--card-border)]">
                      {alerts.map((r) => {
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
                                <div className="text-[var(--muted-foreground)] truncate mt-0.5">
                                  Catatan: {r.balanceNote}
                                </div>
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
                  )}
                </div>

                {allCorrections.length > 0 && (
                  <div className="pt-3 border-t border-[var(--border)] space-y-2">
                    <h4 className="text-xs font-semibold">Jejak Koreksi Omset &amp; Shift ({allCorrections.length})</h4>
                    <div className="divide-y divide-[var(--card-border)]">
                      {allCorrections.map((c) => (
                        <div key={c.id} className="py-2 flex flex-col sm:flex-row sm:items-start justify-between gap-2 text-xs">
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
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded bg-[var(--background)] border border-[var(--border)]"
                                >
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
                  </div>
                )}
              </div>
            )}
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

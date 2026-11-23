'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { calcShiftMetrics, formatDateIndo, formatRp, getLocalDateStr } from '@/lib/calc';
import type { AppSettingsPublic, OutletPublic, ShiftRecord } from '@/lib/types';

interface KasirHistoryViewProps {
  outlet: OutletPublic;
  settings: AppSettingsPublic;
  onOpenShift: (date: string, shift: 1 | 2) => void;
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

export default function KasirHistoryView({
  outlet,
  settings,
  onOpenShift,
  onToast,
}: KasirHistoryViewProps) {
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('7days');
  const [catFilter, setCatFilter] = useState('all');
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const today = getLocalDateStr(0);
      const from =
        range === 'today'
          ? today
          : range === '7days'
            ? getLocalDateStr(-6)
            : range === '30days'
              ? getLocalDateStr(-29)
              : '';
      const params = new URLSearchParams();
      if (from) params.set('from', from);

      const res = await fetch(`/api/shifts?${params.toString()}`, { cache: 'no-store', signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat riwayat.');
      if (signal?.aborted) return;
      setShifts(data.shifts || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onToast(err instanceof Error ? err.message : 'Gagal memuat riwayat.', 'error');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [range, onToast]);

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  const totals = useMemo(() => {
    let omset = 0,
      tunai = 0,
      expense = 0,
      cashDrop = 0,
      balanced = 0;
    shifts.forEach((r) => {
      const m = calcShiftMetrics(r);
      omset += m.totalOmset;
      tunai += r.breakdown.tunai;
      expense += m.totalExpense;
      cashDrop += m.cashDrop;
      if (m.status === 'balanced') balanced++;
    });
    return { omset, tunai, expense, cashDrop, balanced };
  }, [shifts]);

  const allCashDrops = useMemo(() => {
    const items = shifts.flatMap((r) => {
      if (r.cashDrops && r.cashDrops.length > 0) {
        return r.cashDrops.map((d) => ({ ...d, cashier: r.cashier }));
      }
      if (r.cashDrop > 0) {
        return [
          {
            id: `legacy-drop-${r.id}`,
            shiftId: r.id,
            outletId: r.outletId,
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
  }, [shifts]);

  const allExpenses = useMemo(
    () =>
      shifts
        .flatMap((r) => r.expenses.map((e) => ({ ...e, cashier: r.cashier })))
        .sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          if (a.shift !== b.shift) return b.shift - a.shift;
          return b.time.localeCompare(a.time);
        }),
    [shifts]
  );

  const categories = useMemo(() => {
    const set = new Set(settings.expenseCategories);
    allExpenses.forEach((e) => set.add(e.category));
    return [...set];
  }, [settings.expenseCategories, allExpenses]);

  const filteredExpenses = useMemo(
    () => (catFilter === 'all' ? allExpenses : allExpenses.filter((e) => e.category === catFilter)),
    [allExpenses, catFilter]
  );

  return (
    <div className="space-y-5">
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Riwayat Shift — {outlet.name}</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Hanya menampilkan data shift milik outlet ini (terisolasi dari server).
          </p>
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
        >
          <option value="today">Hari Ini</option>
          <option value="7days">7 Hari Terakhir</option>
          <option value="30days">30 Hari Terakhir</option>
          <option value="all">Semua Riwayat</option>
        </select>
      </section>

      {loading ? (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center text-xs text-[var(--muted-foreground)]">
          Memuat riwayat outlet...
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Omset Outlet Ini</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatRp(totals.omset)}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{shifts.length} laporan shift</p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Tunai Masuk</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatRp(totals.tunai)}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5 tabular-nums">
                Setor Owner: <strong className="text-[var(--primary)]">{formatRp(totals.cashDrop)}</strong>
              </p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Pengeluaran Kas Kecil</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-[var(--error)]">{formatRp(totals.expense)}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Outlet ini saja</p>
            </div>
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
              <p className="text-xs text-[var(--muted-foreground)]">Status Balance</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-[var(--success)]">
                {totals.balanced} / {shifts.length}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Shift cocok</p>
            </div>
          </section>

          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Daftar Shift Tercatat</h3>
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums">{shifts.length} laporan</span>
            </div>
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
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
                      <td colSpan={9} className="py-8 text-center text-[var(--muted-foreground)]">
                        Belum ada riwayat shift untuk outlet ini.
                      </td>
                    </tr>
                  ) : (
                    shifts.map((r) => {
                      const m = calcShiftMetrics(r);
                      return (
                        <tr key={r.id} className="hover:bg-[var(--background)]">
                          <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateIndo(r.date)}</td>
                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <span className="font-medium">Shift {r.shift}</span>
                            {r.cashier && <span className="text-[var(--muted-foreground)]"> &middot; {r.cashier}</span>}
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
                            {m.status === 'balanced' ? (
                              <span className="px-2 py-0.5 rounded border border-[var(--success)] text-[var(--success)] font-medium">
                                Balance &#10003;
                              </span>
                            ) : m.status === 'surplus' ? (
                              <span className="px-2 py-0.5 rounded border border-[var(--warning)] text-[var(--warning)] font-medium">
                                +{formatRp(m.diff)}
                              </span>
                            ) : m.status === 'deficit' ? (
                              <span className="px-2 py-0.5 rounded border border-[var(--error)] text-[var(--error)] font-medium">
                                {formatRp(m.diff)}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--muted-foreground)]">
                                Draft
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onOpenShift(r.date, r.shift)}
                              className="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] font-medium cursor-pointer"
                            >
                              Buka
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

          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--card-border)]">
              <div>
                <h3 className="text-sm font-semibold">Riwayat Setor ke Owner / Bank — Outlet Ini</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Catatan setoran kas dari {outlet.name} ke Owner / rekening bank pada periode terpilih.
                </p>
              </div>
              <span className="text-xs font-semibold tabular-nums text-[var(--primary)]">
                Total: {formatRp(allCashDrops.reduce((s, d) => s + d.amount, 0))}
              </span>
            </div>

            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Tanggal &amp; Jam</th>
                    <th className="py-2 px-2 font-medium">Shift / Kasir</th>
                    <th className="py-2 px-2 font-medium">Metode</th>
                    <th className="py-2 px-2 font-medium">Keterangan</th>
                    <th className="py-2 pl-2 font-medium text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                  {allCashDrops.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-7 text-center text-[var(--muted-foreground)]">
                        Belum ada setoran ke Owner / Bank pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    allCashDrops.map((d) => (
                      <tr key={d.id} className="hover:bg-[var(--background)]">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatDateIndo(d.date)}{' '}
                          {d.time && <span className="text-[var(--muted-foreground)]">{d.time}</span>}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          Shift {d.shift}
                          {d.cashier && <span className="text-[var(--muted-foreground)]"> &middot; {d.cashier}</span>}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">{d.method}</span>
                        </td>
                        <td className="py-2 px-2 text-[var(--muted-foreground)]">{d.note || '-'}</td>
                        <td className="py-2 pl-2 text-right font-semibold text-[var(--primary)] whitespace-nowrap">
                          {formatRp(d.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {allCashDrops.length > 0 && (
                  <tfoot className="border-t border-[var(--border)] font-semibold tabular-nums">
                    <tr>
                      <td colSpan={4} className="py-2.5 pr-3 text-right text-[var(--muted-foreground)]">
                        Total Setoran ({allCashDrops.length} transaksi)
                      </td>
                      <td className="py-2.5 pl-2 text-right text-[var(--primary)] whitespace-nowrap">
                        {formatRp(allCashDrops.reduce((s, d) => s + d.amount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--card-border)]">
              <div>
                <h3 className="text-sm font-semibold">Detail Pengeluaran Outlet Ini</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Rincian pengeluaran kas kecil per kategori untuk {outlet.name}.
                </p>
              </div>
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium self-start sm:self-auto"
              >
                <option value="all">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Tanggal &amp; Jam</th>
                    <th className="py-2 px-2 font-medium">Shift / Kasir</th>
                    <th className="py-2 px-2 font-medium">Kategori</th>
                    <th className="py-2 px-2 font-medium">Keterangan Pengeluaran</th>
                    <th className="py-2 pl-2 font-medium text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-7 text-center text-[var(--muted-foreground)]">
                        Belum ada pengeluaran pada periode/kategori ini.
                      </td>
                    </tr>
                  ) : (
                    filteredExpenses.map((it) => (
                      <tr key={it.id} className="hover:bg-[var(--background)]">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatDateIndo(it.date)}{' '}
                          {it.time && <span className="text-[var(--muted-foreground)]">{it.time}</span>}
                        </td>
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
                      <td colSpan={4} className="py-2.5 pr-3 text-right text-[var(--muted-foreground)]">
                        Total ({filteredExpenses.length} item)
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
    </div>
  );
}

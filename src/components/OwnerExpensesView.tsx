'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateIndo, formatRp, getLocalDateStr } from '@/lib/calc';
import type { OutletPublic, OwnerExpenseRecord } from '@/lib/types';

interface OwnerExpensesViewProps {
  outlets: OutletPublic[];
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

const OWNER_CATEGORIES = ['Belanja Bahan', 'Operasional', 'Perlengkapan', 'Lain-Lain'] as const;
const PAYMENT_METHODS = ['Transfer', 'Cash Owner', 'QRIS', 'Lainnya'] as const;

export default function OwnerExpensesView({ outlets, onToast }: OwnerExpensesViewProps) {
  const [expenses, setExpenses] = useState<OwnerExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [date, setDate] = useState(getLocalDateStr(0));
  const [category, setCategory] = useState<string>('Belanja Bahan');
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>(() => outlets.map((o) => o.id));
  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Transfer');
  const [notes, setNotes] = useState('');

  // Filter state
  const [fromDate, setFromDate] = useState(getLocalDateStr(-29));
  const [toDate, setToDate] = useState(getLocalDateStr(0));
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterOutlet, setFilterOutlet] = useState<string>('all');

  useEffect(() => {
    if (outlets.length > 0 && selectedOutlets.length === 0) {
      setSelectedOutlets(outlets.map((o) => o.id));
    }
  }, [outlets, selectedOutlets.length]);

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      const res = await fetch(`/api/owner-expenses?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data.');
      setExpenses(data.expenses || []);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memuat pengeluaran owner.', 'error');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, onToast]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const toggleOutlet = (outletId: string) => {
    setSelectedOutlets((prev) =>
      prev.includes(outletId) ? prev.filter((id) => id !== outletId) : [...prev, outletId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Math.round(Number(amountInput.replace(/[^\d]/g, '') || 0));
    if (selectedOutlets.length === 0) {
      onToast('Pilih minimal 1 outlet tujuan pengeluaran.', 'warning');
      return;
    }
    if (!description.trim() || numericAmount <= 0) {
      onToast('Keterangan dan nominal (> 0) wajib diisi.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/owner-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          category,
          outletIds: selectedOutlets,
          description: description.trim(),
          amount: numericAmount,
          paymentMethod,
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan.');
      onToast('Pengeluaran owner berhasil dicatat.', 'success');
      setDescription('');
      setAmountInput('');
      setNotes('');
      await loadExpenses();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan pengeluaran owner.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Hapus catatan pengeluaran owner ini?')) return;
    try {
      const res = await fetch(`/api/owner-expenses?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus.');
      onToast('Catatan pengeluaran owner dihapus.', 'info');
      setExpenses((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus catatan.', 'error');
    }
  };

  const filtered = useMemo(() => {
    return expenses.filter((item) => {
      if (filterCategory !== 'all' && item.category !== filterCategory) return false;
      if (filterOutlet !== 'all' && !item.outletIds.includes(filterOutlet)) return false;
      return true;
    });
  }, [expenses, filterCategory, filterOutlet]);

  const summary = useMemo(() => {
    const total = filtered.reduce((s, e) => s + e.amount, 0);
    const bahan = filtered
      .filter((e) => e.category === 'Belanja Bahan')
      .reduce((s, e) => s + e.amount, 0);
    const operasional = filtered
      .filter((e) => e.category === 'Operasional')
      .reduce((s, e) => s + e.amount, 0);
    const lainnya = total - bahan - operasional;
    return { total, bahan, operasional, lainnya };
  }, [filtered]);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <h2 className="text-base sm:text-lg font-semibold">Pengeluaran Langsung Owner</h2>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          Catat belanja bahan langsung oleh owner dan biaya operasional (listrik, WiFi, sewa, dll) untuk satu atau beberapa outlet sekaligus.
        </p>

        {/* Form Input */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Tanggal</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Nominal (Rp)</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Contoh: 250.000"
                value={amountInput}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, '');
                  setAmountInput(digits ? Number(digits).toLocaleString('id-ID') : '');
                }}
                required
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Metode Bayar</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Kategori Pills */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
              Kategori Pengeluaran
            </label>
            <div className="flex flex-wrap gap-1.5">
              {OWNER_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    category === cat
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]'
                      : 'bg-[var(--background)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--secondary)]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
              {category === 'Belanja Bahan'
                ? 'Contoh: Biji kopi, susu UHT, sirup, cup, es batu, bahan makanan.'
                : category === 'Operasional'
                  ? 'Contoh: Tagihan listrik, WiFi/internet, air PDAM, sewa tempat, kebersihan.'
                  : 'Contoh: Perbaikan alat, servis mesin kopi, atau keperluan lain.'}
            </p>
          </div>

          {/* Multi-select Outlet */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">
                Outlet Terkait ({selectedOutlets.length} dari {outlets.length} dipilih)
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedOutlets(outlets.map((o) => o.id))}
                  className="text-[var(--primary)] hover:underline cursor-pointer font-medium"
                >
                  Pilih Semua
                </button>
                <span className="text-[var(--muted-foreground)]">&middot;</span>
                <button
                  type="button"
                  onClick={() => setSelectedOutlets([])}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline cursor-pointer"
                >
                  Reset
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {outlets.map((o) => {
                const checked = selectedOutlets.includes(o.id);
                return (
                  <label
                    key={o.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'border-[var(--primary)] bg-[var(--primary)]/5 font-medium text-[var(--foreground)]'
                        : 'border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOutlet(o.id)}
                      className="accent-[var(--primary)] w-3.5 h-3.5 shrink-0"
                    />
                    <span className="truncate">{o.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
                Keterangan / Nama Item
              </label>
              <input
                type="text"
                placeholder="Contoh: Beli Biji Kopi 5kg / Bayar WiFi & Listrik"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">
                Catatan Tambahan (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: Nota supplier / periode tagihan"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs sm:text-sm font-semibold hover:opacity-95 disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Menyimpan...' : 'Simpan Pengeluaran Owner'}
            </button>
          </div>
        </form>
      </div>

      {/* Ringkasan Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5">
          <div className="text-[11px] text-[var(--muted-foreground)]">Total Pengeluaran Owner</div>
          <div className="text-base sm:text-lg font-bold tabular-nums text-[var(--error)] mt-1">
            {formatRp(summary.total)}
          </div>
          <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{filtered.length} transaksi</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5">
          <div className="text-[11px] text-[var(--muted-foreground)]">Belanja Bahan</div>
          <div className="text-base sm:text-lg font-bold tabular-nums mt-1">{formatRp(summary.bahan)}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5">
          <div className="text-[11px] text-[var(--muted-foreground)]">Operasional (Listrik/WiFi/dll)</div>
          <div className="text-base sm:text-lg font-bold tabular-nums mt-1">{formatRp(summary.operasional)}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5">
          <div className="text-[11px] text-[var(--muted-foreground)]">Perlengkapan &amp; Lainnya</div>
          <div className="text-base sm:text-lg font-bold tabular-nums mt-1">{formatRp(summary.lainnya)}</div>
        </div>
      </div>

      {/* Filter & Riwayat */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Riwayat Pengeluaran Owner</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
            />
            <span className="text-xs text-[var(--muted-foreground)]">s/d</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
            >
              <option value="all">Semua Kategori</option>
              {OWNER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filterOutlet}
              onChange={(e) => setFilterOutlet(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
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

        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                <th className="py-2 pr-3 font-medium">Tanggal</th>
                <th className="py-2 px-2 font-medium">Kategori</th>
                <th className="py-2 px-2 font-medium">Outlet Terkait</th>
                <th className="py-2 px-2 font-medium">Keterangan</th>
                <th className="py-2 px-2 font-medium">Metode</th>
                <th className="py-2 px-2 font-medium text-right">Nominal</th>
                <th className="py-2 pl-2 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted-foreground)]">
                    Memuat data pengeluaran owner...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted-foreground)]">
                    Belum ada pengeluaran owner pada filter ini.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const outletLabels = item.outletIds.map((id) => outletMap.get(id)?.name || id);
                  return (
                    <tr key={item.id} className="hover:bg-[var(--background)]">
                      <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateIndo(item.date)}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-[var(--secondary)] font-medium">
                          {item.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex flex-wrap gap-1">
                          {outletLabels.map((name, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--background)] text-[11px]"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-medium text-[var(--foreground)]">{item.description}</div>
                        {item.notes && (
                          <div className="text-[11px] text-[var(--muted-foreground)]">{item.notes}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-[var(--muted-foreground)]">
                        {item.paymentMethod}
                      </td>
                      <td className="py-2.5 px-2 text-right font-semibold text-[var(--error)] whitespace-nowrap">
                        {formatRp(item.amount)}
                      </td>
                      <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          className="text-[11px] text-[var(--error)] hover:underline cursor-pointer"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

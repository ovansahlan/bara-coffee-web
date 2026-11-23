'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SHIFT_SCHEDULE, formatDateTimeShort, formatPlain, formatRp, parseNum } from '@/lib/calc';
import type { AppSettingsAdmin, EmployeeAdmin, OutletAdmin, ShiftScheduleConfig } from '@/lib/types';

interface SettingsViewProps {
  onSettingsUpdated: () => Promise<void>;
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

type SettingsTab = 'team' | 'outlets' | 'security';

export default function SettingsView({ onSettingsUpdated, onToast }: SettingsViewProps) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AppSettingsAdmin | null>(null);
  const [outlets, setOutlets] = useState<OutletAdmin[]>([]);
  const [employees, setEmployees] = useState<EmployeeAdmin[]>([]);
  const [activeTab, setActiveTab] = useState<SettingsTab>('team');

  // Team filters & Add/Edit modal
  const [empSearch, setEmpSearch] = useState('');
  const [empOutletFilter, setEmpOutletFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [empModal, setEmpModal] = useState<{ mode: 'add' | 'edit'; emp: EmployeeAdmin } | null>(null);
  const [savingEmp, setSavingEmp] = useState(false);
  const [showEmpPin, setShowEmpPin] = useState(false);

  // Outlet Add/Edit modal & Schedule
  const [outletModal, setOutletModal] = useState<{ mode: 'add' | 'edit'; outlet: OutletAdmin } | null>(null);
  const [savingOutlet, setSavingOutlet] = useState(false);
  const [showOutletPin, setShowOutletPin] = useState(false);
  const [schedule, setSchedule] = useState<ShiftScheduleConfig>(DEFAULT_SHIFT_SCHEDULE);

  // Security & Categories & Google Sheets Sync
  const [ownerPinInput, setOwnerPinInput] = useState('');
  const [showOwnerPin, setShowOwnerPin] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [sheetsUrlInput, setSheetsUrlInput] = useState('');
  const [syncingSheets, setSyncingSheets] = useState(false);

  // Delete confirmations
  const [deleteOutletTarget, setDeleteOutletTarget] = useState<OutletAdmin | null>(null);
  const [deleteEmpTarget, setDeleteEmpTarget] = useState<EmployeeAdmin | null>(null);

  const loadSettings = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const [setRes, empRes] = await Promise.all([
          fetch('/api/settings', { cache: 'no-store', signal }),
          fetch('/api/employees?admin=1', { cache: 'no-store', signal }),
        ]);
        const [setData, empData] = await Promise.all([setRes.json(), empRes.json()]);
        if (!setRes.ok) throw new Error(setData.error || 'Gagal memuat pengaturan.');
        if (signal?.aborted) return;
        setSettings(setData.settings);
        setOwnerPinInput(setData.settings.ownerPin);
        setSheetsUrlInput(setData.settings.googleSheetsWebhookUrl || '');
        setSchedule(setData.settings.shiftSchedule || DEFAULT_SHIFT_SCHEDULE);
        setOutlets(setData.outlets || []);
        setEmployees(empData.employees || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onToast(err instanceof Error ? err.message : 'Gagal memuat pengaturan.', 'error');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  async function patchSettings(payload: Record<string, unknown>, successMsg: string): Promise<boolean> {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan.');
      setSettings(data.settings);
      setOwnerPinInput(data.settings.ownerPin);
      setSheetsUrlInput(data.settings.googleSheetsWebhookUrl || '');
      setSchedule(data.settings.shiftSchedule || DEFAULT_SHIFT_SCHEDULE);
      setOutlets(data.outlets || []);
      await onSettingsUpdated();
      onToast(successMsg, 'success');
      return true;
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan.', 'error');
      return false;
    }
  }

  async function saveEmployee(emp: EmployeeAdmin, msg: string): Promise<boolean> {
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emp),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan karyawan.');
      setEmployees(data.employees || []);
      onToast(msg, 'success');
      return true;
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan karyawan.', 'error');
      return false;
    }
  }

  async function confirmDeleteEmployee(id: string, name: string) {
    try {
      const res = await fetch(`/api/employees?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus karyawan.');
      setEmployees(data.employees || []);
      onToast(`Karyawan "${name}" dihapus.`, 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus karyawan.', 'error');
    }
  }

  function openAddEmployeeModal() {
    setShowEmpPin(true);
    setEmpModal({
      mode: 'add',
      emp: {
        id: `emp-${Date.now()}`,
        name: '',
        roleTitle: 'Barista',
        outletId: outlets[0]?.id || 'all',
        payType: 'monthly',
        pin: '',
        baseSalary: 0,
        dailyRate: 0,
        mealAllowance: 0,
        overtimeRatePerHour: 0,
        latePenalty: 0,
        kasbonLimit: 500000,
        active: true,
      },
    });
  }

  function openEditEmployeeModal(emp: EmployeeAdmin) {
    setShowEmpPin(false);
    setEmpModal({ mode: 'edit', emp: { ...emp } });
  }

  async function handleSubmitEmpModal(e: React.FormEvent) {
    e.preventDefault();
    if (!empModal) return;
    const cleanedName = empModal.emp.name.trim();
    const cleanedPin = empModal.emp.pin.replace(/[^0-9]/g, '');
    if (cleanedName.length < 2) return onToast('Nama karyawan minimal 2 karakter.', 'warning');
    if (cleanedPin.length < 4 || cleanedPin.length > 8) {
      return onToast('PIN pribadi harus 4–8 digit angka.', 'warning');
    }

    setSavingEmp(true);
    const ok = await saveEmployee(
      { ...empModal.emp, name: cleanedName, roleTitle: empModal.emp.roleTitle.trim() || 'Barista', pin: cleanedPin },
      empModal.mode === 'add' ? `Kru "${cleanedName}" ditambahkan.` : `Data "${cleanedName}" diperbarui.`
    );
    setSavingEmp(false);
    if (ok) setEmpModal(null);
  }

  function openAddOutletModal() {
    const nextNum = outlets.length + 1;
    setShowOutletPin(true);
    setOutletModal({
      mode: 'add',
      outlet: {
        id: `outlet-${Date.now()}`,
        name: `Bara Coffee - Outlet ${nextNum}`,
        location: `Cabang ${nextNum}`,
        defaultOpeningCash: 0,
        pin: '',
        sortOrder: nextNum,
      },
    });
  }

  function openEditOutletModal(outlet: OutletAdmin) {
    setShowOutletPin(false);
    setOutletModal({ mode: 'edit', outlet: { ...outlet } });
  }

  async function handleSubmitOutletModal(e: React.FormEvent) {
    e.preventDefault();
    if (!outletModal) return;
    const cleanedName = outletModal.outlet.name.trim();
    const cleanedPin = outletModal.outlet.pin.replace(/[^0-9]/g, '');
    if (!cleanedName) return onToast('Nama outlet wajib diisi.', 'warning');
    if (cleanedPin.length < 4 || cleanedPin.length > 8) {
      return onToast('PIN outlet harus 4–8 digit angka.', 'warning');
    }

    setSavingOutlet(true);
    const ok = await patchSettings(
      {
        action: 'upsert_outlet',
        ...outletModal.outlet,
        name: cleanedName,
        location: outletModal.outlet.location.trim(),
        pin: cleanedPin,
      },
      outletModal.mode === 'add' ? `Outlet "${cleanedName}" ditambahkan.` : `Pengaturan "${cleanedName}" disimpan.`
    );
    setSavingOutlet(false);
    if (ok) setOutletModal(null);
  }

  function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const trimmed = newCat.trim();
    if (!trimmed) return;
    if (settings.expenseCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      onToast('Kategori sudah ada.', 'warning');
      return;
    }
    setNewCat('');
    patchSettings(
      {
        action: 'update_expense_categories',
        expenseCategories: [...settings.expenseCategories, trimmed],
      },
      `Kategori "${trimmed}" ditambahkan.`
    );
  }

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const activeEmpCount = useMemo(() => employees.filter((e) => e.active).length, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return employees
      .filter((e) => {
        if (!showInactive && !e.active) return false;
        if (empOutletFilter !== 'all' && e.outletId !== empOutletFilter) return false;
        if (q && !e.name.toLowerCase().includes(q) && !e.roleTitle.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [employees, showInactive, empOutletFilter, empSearch]);

  if (loading || !settings) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center text-xs text-[var(--muted-foreground)]">
        Memuat pengaturan Owner...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Minimalist Top Bar + 3-Tab Switcher */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Tim &amp; Pengaturan</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Kelola akun kru, outlet &amp; jadwal shift, kategori kas kecil, serta PIN keamanan Owner.
          </p>
        </div>
        <div className="grid grid-cols-3 p-1 rounded-lg bg-[var(--background)] border border-[var(--border)] self-stretch sm:self-start lg:self-auto">
          {(
            [
              { id: 'team' as const, label: `Tim & Kru (${activeEmpCount})` },
              { id: 'outlets' as const, label: `Outlet & Shift (${outlets.length})` },
              { id: 'security' as const, label: 'Kasir & Keamanan' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer truncate ${
                activeTab === t.id
                  ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* TAB 1: TIM & KRU */}
      {activeTab === 'team' && (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[var(--card-border)]">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                placeholder="Cari nama kru..."
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs w-44 sm:w-48"
              />
              <select
                value={empOutletFilter}
                onChange={(e) => setEmpOutletFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
              >
                <option value="all">Semua Outlet</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.location || o.name}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] cursor-pointer select-none px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)]">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="accent-[var(--primary)] cursor-pointer"
                />
                <span>Tampilkan nonaktif</span>
              </label>
            </div>
            <button
              type="button"
              onClick={openAddEmployeeModal}
              className="px-3.5 py-2 sm:py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 self-start sm:self-auto shrink-0 cursor-pointer"
            >
              + Tambah Kru
            </button>
          </div>

          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="py-2 pr-3 font-medium">Karyawan</th>
                  <th className="py-2 px-2 font-medium">Outlet</th>
                  <th className="py-2 px-2 font-medium">Skema</th>
                  <th className="py-2 px-2 font-medium text-right">Limit Kasbon</th>
                  <th className="py-2 px-2 font-medium text-center">PIN</th>
                  <th className="py-2 pl-2 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[var(--muted-foreground)]">
                      Belum ada kru yang sesuai filter.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => (
                    <tr key={emp.id} className={`hover:bg-[var(--background)] ${!emp.active ? 'opacity-55' : ''}`}>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              emp.active ? 'bg-[var(--success)]' : 'bg-[var(--muted-foreground)]'
                            }`}
                          />
                          <div>
                            <div className="font-semibold">
                              {emp.name}
                              {!emp.active && (
                                <span className="ml-1.5 text-[10px] font-normal text-[var(--muted-foreground)]">
                                  (Nonaktif)
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--muted-foreground)]">{emp.roleTitle}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-[var(--muted-foreground)]">
                        {emp.outletId === 'all'
                          ? 'Rolling (Semua)'
                          : outletMap.get(emp.outletId)?.location || outletMap.get(emp.outletId)?.name || emp.outletId}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[11px] font-medium">
                          {emp.payType === 'daily' ? 'Part-Time' : 'Bulanan'}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {emp.kasbonLimit > 0 ? formatRp(emp.kasbonLimit) : 'Tanpa batas'}
                      </td>
                      <td className="py-2.5 px-2 text-center whitespace-nowrap font-mono text-[var(--muted-foreground)]">
                        ••••
                      </td>
                      <td className="py-2.5 pl-2 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => openEditEmployeeModal(emp)}
                          className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-[11px] font-medium cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteEmpTarget(emp)}
                          className="px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--background)] hover:text-[var(--error)] text-xs cursor-pointer"
                          title="Hapus karyawan"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 2: OUTLET & JADWAL SHIFT */}
      {activeTab === 'outlets' && (
        <div className="space-y-4">
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--card-border)]">
              <div>
                <h3 className="text-sm font-semibold">Daftar Outlet &amp; PIN Otorisasi</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  PIN Outlet dipakai untuk otorisasi pendaftaran akun kru baru di cabang terkait.
                </p>
              </div>
              <button
                type="button"
                onClick={openAddOutletModal}
                className="px-3.5 py-2 sm:py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 self-start sm:self-auto shrink-0 cursor-pointer"
              >
                + Tambah Outlet
              </button>
            </div>

            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                    <th className="py-2 pr-3 font-medium">Nama Outlet</th>
                    <th className="py-2 px-2 font-medium">Lokasi</th>
                    <th className="py-2 px-2 font-medium text-right">Saldo Awal</th>
                    <th className="py-2 px-2 font-medium text-center">PIN Outlet</th>
                    <th className="py-2 pl-2 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                  {outlets.map((o) => (
                    <tr key={o.id} className="hover:bg-[var(--background)]">
                      <td className="py-2.5 pr-3 font-semibold whitespace-nowrap">{o.name}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap text-[var(--muted-foreground)]">
                        {o.location || '-'}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        {formatRp(o.defaultOpeningCash)}
                      </td>
                      <td className="py-2.5 px-2 text-center whitespace-nowrap font-mono text-[var(--muted-foreground)]">
                        ••••
                      </td>
                      <td className="py-2.5 pl-2 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => openEditOutletModal(o)}
                          className="px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-[11px] font-medium cursor-pointer"
                        >
                          Edit
                        </button>
                        {outlets.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setDeleteOutletTarget(o)}
                            className="px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--background)] hover:text-[var(--error)] text-xs cursor-pointer"
                            title="Hapus outlet"
                          >
                            &times;
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
            <div className="pb-2.5 border-b border-[var(--card-border)]">
              <h3 className="text-sm font-semibold">Jadwal Shift &amp; Toleransi Keterlambatan</h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                Menentukan status tepat waktu/telat dan menit lembur pada rekap absensi kru.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-4 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2">
                <span className="text-xs font-semibold block">Shift 1 (Pagi)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted-foreground)] block">Masuk</label>
                    <input
                      type="time"
                      value={schedule.shift1Start}
                      onChange={(e) => setSchedule((s) => ({ ...s, shift1Start: e.target.value }))}
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted-foreground)] block">Pulang</label>
                    <input
                      type="time"
                      value={schedule.shift1End}
                      onChange={(e) => setSchedule((s) => ({ ...s, shift1End: e.target.value }))}
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs tabular-nums"
                    />
                  </div>
                </div>
              </div>

              <div className="sm:col-span-4 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2">
                <span className="text-xs font-semibold block">Shift 2 (Sore)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted-foreground)] block">Masuk</label>
                    <input
                      type="time"
                      value={schedule.shift2Start}
                      onChange={(e) => setSchedule((s) => ({ ...s, shift2Start: e.target.value }))}
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-[var(--muted-foreground)] block">Pulang</label>
                    <input
                      type="time"
                      value={schedule.shift2End}
                      onChange={(e) => setSchedule((s) => ({ ...s, shift2End: e.target.value }))}
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs tabular-nums"
                    />
                  </div>
                </div>
              </div>

              <div className="sm:col-span-4 flex flex-col justify-between gap-2.5 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                <div className="space-y-1">
                  <label className="text-[11px] text-[var(--muted-foreground)] block">Toleransi Telat (Menit)</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={schedule.lateGraceMinutes}
                    onChange={(e) => setSchedule((s) => ({ ...s, lateGraceMinutes: Math.max(0, Number(e.target.value) || 0) }))}
                    className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs font-semibold tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patchSettings({ action: 'update_shift_schedule', shiftSchedule: schedule }, 'Jadwal shift diperbarui.')
                  }
                  className="w-full py-1.5 px-3 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                >
                  Simpan Jadwal
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: KASIR & KEAMANAN */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
            <div className="pb-2.5 border-b border-[var(--card-border)]">
              <h3 className="text-sm font-semibold">Keamanan Akses Owner</h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                Atur PIN Dashboard Owner serta kebijakan koreksi shift terkunci.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">PIN Dashboard Owner (4–8 angka)</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showOwnerPin ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={8}
                      value={ownerPinInput}
                      onChange={(e) => setOwnerPinInput(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full px-3 py-2 pr-14 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOwnerPin((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      {showOwnerPin ? 'Sembunyi' : 'Lihat'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      patchSettings({ action: 'update_owner_security', ownerPin: ownerPinInput }, 'PIN Owner diperbarui.')
                    }
                    className="px-3.5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
                  >
                    Simpan
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.requireOwnerPinForCorrection}
                  onChange={(e) =>
                    patchSettings(
                      { action: 'update_owner_security', requireOwnerPinForCorrection: e.target.checked },
                      e.target.checked
                        ? 'Koreksi shift terkunci kini wajib PIN Owner.'
                        : 'Koreksi shift terkunci dapat dilakukan kasir dengan alasan tercatat.'
                    )
                  }
                  className="accent-[var(--primary)] rounded mt-0.5 cursor-pointer"
                />
                <span>
                  <strong className="block text-[var(--foreground)]">Wajib PIN Owner saat Koreksi Shift Terkunci</strong>
                  <span className="text-[11px] text-[var(--muted-foreground)]">
                    Aktifkan agar perubahan angka pada shift yang sudah Check Balance memerlukan verifikasi PIN Owner.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
            <div className="pb-2.5 border-b border-[var(--card-border)]">
              <h3 className="text-sm font-semibold">Kategori Pengeluaran Kas Kecil</h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                Muncul pada form Input Pengeluaran Shift di halaman kasir.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {settings.expenseCategories.map((cat, idx) => (
                <span
                  key={cat}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                >
                  <span>{cat}</span>
                  {settings.expenseCategories.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        patchSettings(
                          {
                            action: 'update_expense_categories',
                            expenseCategories: settings.expenseCategories.filter((_, i) => i !== idx),
                          },
                          `Kategori "${cat}" dihapus.`
                        )
                      }
                      className="text-[var(--muted-foreground)] hover:text-[var(--error)] cursor-pointer"
                    >
                      &times;
                    </button>
                  )}
                </span>
              ))}
            </div>
            <form onSubmit={handleAddCategory} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="Tambah kategori baru (misal: Kemasan)"
                className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
              >
                Tambah
              </button>
            </form>
          </section>

          <section className="lg:col-span-2 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[var(--card-border)]">
              <div>
                <h3 className="text-sm font-semibold">Otomatisasi Rekap ke Google Sheets</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Hubungkan aplikasi ke Google Sheet Anda via Google Apps Script Web App agar transaksi, belanja, setor,
                  absensi, kasbon, dan payroll tersinkron otomatis.
                </p>
              </div>
              {settings.googleSheetsLastSync && (
                <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums shrink-0">
                  Sync terakhir: {formatDateTimeShort(settings.googleSheetsLastSync)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-8 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">
                  URL Web App Apps Script (https://script.google.com/macros/s/.../exec)
                </label>
                <input
                  type="url"
                  value={sheetsUrlInput}
                  onChange={(e) => setSheetsUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-mono"
                />
              </div>
              <div className="sm:col-span-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    patchSettings(
                      { action: 'update_google_sheets', googleSheetsWebhookUrl: sheetsUrlInput },
                      'URL Google Sheets Webhook disimpan.'
                    )
                  }
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-semibold cursor-pointer"
                >
                  Simpan URL
                </button>
                <button
                  type="button"
                  disabled={syncingSheets}
                  onClick={async () => {
                    setSyncingSheets(true);
                    try {
                      const res = await fetch('/api/sync-sheets', { method: 'POST' });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Gagal sinkronisasi.');
                      await loadSettings();
                      onToast('Sinkronisasi ke Google Sheets berhasil!', 'success');
                    } catch (err) {
                      onToast(err instanceof Error ? err.message : 'Gagal sinkronisasi.', 'error');
                    } finally {
                      setSyncingSheets(false);
                    }
                  }}
                  className="flex-1 px-3 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {syncingSheets ? 'Menyinkron...' : 'Sync Sekarang'}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)] text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(settings.googleSheetsAutoSync)}
                onChange={(e) =>
                  patchSettings(
                    { action: 'update_google_sheets', googleSheetsAutoSync: e.target.checked },
                    e.target.checked
                      ? 'Auto-Sync ke Google Sheets diaktifkan.'
                      : 'Auto-Sync ke Google Sheets dimatikan.'
                  )
                }
                className="accent-[var(--primary)] rounded mt-0.5 cursor-pointer"
              />
              <span>
                <strong className="block text-[var(--foreground)]">
                  Auto-Sync Otomatis setiap ada Transaksi, Absensi, Kasbon, atau Payroll
                </strong>
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  Berjalan di latar belakang setelah data tersimpan ke Supabase sehingga tidak memperlambat input kasir.
                </span>
              </span>
            </label>
          </section>
        </div>
      )}

      {/* ADD / EDIT EMPLOYEE MODAL */}
      {empModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">
                  {empModal.mode === 'add' ? 'Tambah Kru Baru' : `Edit Data — ${empModal.emp.name}`}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Nominal gaji diisi manual di Payroll; di sini cukup atur akun, outlet, PIN, dan limit kasbon.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEmpModal(null)}
                className="text-xs text-[var(--muted-foreground)] px-2 py-1 cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmitEmpModal} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Nama Lengkap</label>
                  <input
                    type="text"
                    required
                    value={empModal.emp.name}
                    onChange={(e) =>
                      setEmpModal((m) => (m ? { ...m, emp: { ...m.emp, name: e.target.value } } : null))
                    }
                    placeholder="cth: Raka Pratama"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Jabatan / Posisi</label>
                  <input
                    type="text"
                    value={empModal.emp.roleTitle}
                    onChange={(e) =>
                      setEmpModal((m) => (m ? { ...m, emp: { ...m.emp, roleTitle: e.target.value } } : null))
                    }
                    placeholder="Barista / Kasir"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Penempatan Outlet</label>
                  <select
                    value={empModal.emp.outletId}
                    onChange={(e) =>
                      setEmpModal((m) => (m ? { ...m, emp: { ...m.emp, outletId: e.target.value } } : null))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                  >
                    <option value="all">Rolling (Semua Outlet)</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Skema Kerja</label>
                  <select
                    value={empModal.emp.payType}
                    onChange={(e) =>
                      setEmpModal((m) =>
                        m ? { ...m, emp: { ...m.emp, payType: e.target.value === 'daily' ? 'daily' : 'monthly' } } : null
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                  >
                    <option value="monthly">Bulanan (Full-Time)</option>
                    <option value="daily">Part-Time Harian</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-[var(--muted-foreground)] block">PIN Pribadi (4–8 digit)</label>
                    <button
                      type="button"
                      onClick={() => setShowEmpPin((v) => !v)}
                      className="text-[11px] text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      {showEmpPin ? 'Sembunyi' : 'Lihat PIN'}
                    </button>
                  </div>
                  <input
                    type={showEmpPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={8}
                    required
                    placeholder="cth: 1234"
                    value={empModal.emp.pin}
                    onChange={(e) =>
                      setEmpModal((m) =>
                        m ? { ...m, emp: { ...m.emp, pin: e.target.value.replace(/[^0-9]/g, '') } } : null
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Limit Kasbon Harian (Rp)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0 = tanpa batas"
                    value={formatPlain(empModal.emp.kasbonLimit)}
                    onChange={(e) =>
                      setEmpModal((m) =>
                        m ? { ...m, emp: { ...m.emp, kasbonLimit: parseNum(e.target.value) } } : null
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs tabular-nums"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={empModal.emp.active}
                  onChange={(e) =>
                    setEmpModal((m) => (m ? { ...m, emp: { ...m.emp, active: e.target.checked } } : null))
                  }
                  className="accent-[var(--primary)] cursor-pointer"
                />
                <span>Akun Aktif (muncul di login outlet &amp; absensi)</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEmpModal(null)}
                  className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEmp}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingEmp ? 'Menyimpan...' : 'Simpan Data Kru'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT OUTLET MODAL */}
      {outletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">
                  {outletModal.mode === 'add' ? 'Tambah Outlet Baru' : `Edit Outlet — ${outletModal.outlet.name}`}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Atur nama cabang, saldo awal kas laci, serta PIN otorisasi outlet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOutletModal(null)}
                className="text-xs text-[var(--muted-foreground)] px-2 py-1 cursor-pointer"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmitOutletModal} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Nama Outlet</label>
                <input
                  type="text"
                  required
                  value={outletModal.outlet.name}
                  onChange={(e) =>
                    setOutletModal((m) => (m ? { ...m, outlet: { ...m.outlet, name: e.target.value } } : null))
                  }
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Lokasi / Cabang</label>
                  <input
                    type="text"
                    value={outletModal.outlet.location}
                    onChange={(e) =>
                      setOutletModal((m) => (m ? { ...m, outlet: { ...m.outlet, location: e.target.value } } : null))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Saldo Awal Pertama (Rp)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formatPlain(outletModal.outlet.defaultOpeningCash)}
                    onChange={(e) =>
                      setOutletModal((m) =>
                        m ? { ...m, outlet: { ...m.outlet, defaultOpeningCash: parseNum(e.target.value) } } : null
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[var(--muted-foreground)] block">PIN Otorisasi Outlet (4–8 angka)</label>
                  <button
                    type="button"
                    onClick={() => setShowOutletPin((v) => !v)}
                    className="text-[11px] text-[var(--primary)] hover:underline cursor-pointer"
                  >
                    {showOutletPin ? 'Sembunyi' : 'Lihat PIN'}
                  </button>
                </div>
                <input
                  type={showOutletPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={8}
                  required
                  placeholder="cth: 1111"
                  value={outletModal.outlet.pin}
                  onChange={(e) =>
                    setOutletModal((m) =>
                      m ? { ...m, outlet: { ...m.outlet, pin: e.target.value.replace(/[^0-9]/g, '') } } : null
                    )
                  }
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tabular-nums"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOutletModal(null)}
                  className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingOutlet}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {savingOutlet ? 'Menyimpan...' : 'Simpan Outlet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Outlet Modal */}
      {deleteOutletTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--error)] rounded-xl max-w-sm w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-[var(--error)]">Hapus Outlet Permanen?</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Anda akan menghapus <strong className="text-[var(--foreground)]">{deleteOutletTarget.name}</strong>.
                Seluruh riwayat shift, pengeluaran kas kecil, dan jejak audit koreksi milik outlet ini juga akan ikut
                terhapus permanen dan tidak bisa dikembalikan.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOutletTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = deleteOutletTarget.id;
                  const name = deleteOutletTarget.name;
                  setDeleteOutletTarget(null);
                  patchSettings({ action: 'delete_outlet', id }, `Outlet "${name}" dihapus.`);
                }}
                className="px-4 py-2 rounded-lg bg-[var(--error)] text-white text-xs font-semibold cursor-pointer"
              >
                Ya, Hapus Outlet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Employee Modal */}
      {deleteEmpTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-[var(--card)] border border-[var(--error)] rounded-xl max-w-sm w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-xl">
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-[var(--error)]">Hapus Karyawan Permanen?</h3>
              <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
                Menghapus <strong className="text-[var(--foreground)]">{deleteEmpTarget.name}</strong> juga akan
                menghapus riwayat absensi &amp; kasbon miliknya. Jika hanya resign, cukup nonaktifkan status aktifnya
                lewat tombol Edit.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteEmpTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-xs font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = deleteEmpTarget.id;
                  const name = deleteEmpTarget.name;
                  setDeleteEmpTarget(null);
                  confirmDeleteEmployee(id, name);
                }}
                className="px-4 py-2 rounded-lg bg-[var(--error)] text-white text-xs font-semibold cursor-pointer"
              >
                Hapus Permanen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { EmployeePublic, OutletPublic } from '@/lib/types';

interface LoginViewProps {
  onSuccess: () => Promise<boolean>;
}

type RoleTab = 'crew' | 'owner';
type CrewMode = 'login' | 'register' | 'reset';

const ROLE_TITLE_OPTIONS = ['Barista', 'Kasir', 'Head Bar', 'Kitchen'];

export default function LoginView({ onSuccess }: LoginViewProps) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [storageMode, setStorageMode] = useState<'local' | 'supabase' | 'unconfigured'>('supabase');
  const [outlets, setOutlets] = useState<OutletPublic[]>([]);
  const [employees, setEmployees] = useState<EmployeePublic[]>([]);
  const [loadError, setLoadError] = useState('');

  const [roleTab, setRoleTab] = useState<RoleTab>('crew');
  const [crewMode, setCrewMode] = useState<CrewMode>('login');

  // Login state
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Register state
  const [regName, setRegName] = useState('');
  const [regOutletId, setRegOutletId] = useState('');
  const [regRoleTitle, setRegRoleTitle] = useState('Barista');
  const [regPayType, setRegPayType] = useState<'daily' | 'monthly'>('daily');
  const [regNewPin, setRegNewPin] = useState('');
  const [regAuthPin, setRegAuthPin] = useState('');

  // Reset / Edit PIN state
  const [resetVerifyMode, setResetVerifyMode] = useState<'old_pin' | 'owner_pin'>('old_pin');
  const [resetVerifyPin, setResetVerifyPin] = useState('');
  const [resetNewPin, setResetNewPin] = useState('');

  const pinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/public-outlets', { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        setConfigured(Boolean(data.configured));
        if (data.storageMode) setStorageMode(data.storageMode);
        const nextOutlets: OutletPublic[] = Array.isArray(data.outlets) ? data.outlets : [];
        const nextEmployees: EmployeePublic[] = Array.isArray(data.employees) ? data.employees : [];
        setOutlets(nextOutlets);
        setEmployees(nextEmployees);
        const initialOutletId = nextOutlets[0]?.id || '';
        setSelectedOutletId(initialOutletId);
        const firstMatchingEmp =
          nextEmployees.find((e) => e.outletId === initialOutletId || e.outletId === 'all') ||
          nextEmployees[0];
        setSelectedEmpId(firstMatchingEmp?.id || '');
        setRegOutletId(initialOutletId || 'all');
        if (nextEmployees.length === 0) setCrewMode('register');
        if (data.error) setLoadError(data.error);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError('Tidak dapat terhubung ke server.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  function switchRoleTab(next: RoleTab) {
    setRoleTab(next);
    setCrewMode(employees.length === 0 && next === 'crew' ? 'register' : 'login');
    setPin('');
    setFormError('');
    requestAnimationFrame(() => pinInputRef.current?.focus());
  }

  function switchCrewMode(next: CrewMode) {
    setCrewMode(next);
    setFormError('');
    setPin('');
    setResetVerifyPin('');
    setResetNewPin('');
    setRegNewPin('');
    setRegAuthPin('');
    if (next === 'register' && selectedOutletId) {
      setRegOutletId(selectedOutletId);
    }
    if (next === 'login') {
      requestAnimationFrame(() => pinInputRef.current?.focus());
    }
  }

  const activeOutlet = outlets.find((o) => o.id === selectedOutletId) || outlets[0] || null;
  const outletEmployees = employees.filter(
    (e) => !activeOutlet || e.outletId === activeOutlet.id || e.outletId === 'all'
  );
  const activeEmployee =
    crewMode === 'reset'
      ? employees.find((e) => e.id === selectedEmpId) || employees[0] || null
      : outletEmployees.find((e) => e.id === selectedEmpId) || outletEmployees[0] || null;

  function handleOutletChange(nextOutletId: string) {
    setSelectedOutletId(nextOutletId);
    setFormError('');
    const nextEmps = employees.filter((e) => e.outletId === nextOutletId || e.outletId === 'all');
    if (!nextEmps.some((e) => e.id === selectedEmpId)) {
      setSelectedEmpId(nextEmps[0]?.id || '');
    }
    requestAnimationFrame(() => pinInputRef.current?.focus());
  }

  function getOutletLabel(outletId: string) {
    if (outletId === 'all') return 'Rolling';
    const o = outlets.find((item) => item.id === outletId);
    return o ? o.location || o.name : outletId;
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    if (roleTab === 'crew' && (!activeOutlet || !activeEmployee)) return;

    setSubmitting(true);
    setFormError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: roleTab,
          outletId: roleTab === 'crew' ? activeOutlet?.id || null : null,
          employeeId: roleTab === 'crew' ? activeEmployee?.id || null : null,
          pin: pin.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'PIN salah.');
        setSubmitting(false);
        return;
      }
      const hydrated = await onSuccess();
      if (!hydrated) {
        setFormError('Login berhasil tetapi sesi gagal dimuat. Pastikan cookie browser diizinkan.');
        setSubmitting(false);
      }
    } catch {
      setFormError('Terjadi kesalahan jaringan. Coba lagi.');
      setSubmitting(false);
    }
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (regName.trim().length < 2) {
      setFormError('Nama lengkap minimal 2 karakter.');
      return;
    }
    if (!/^\d{4,8}$/.test(regNewPin.trim())) {
      setFormError('PIN pribadi harus 4–8 digit angka.');
      return;
    }
    if (!regAuthPin.trim()) {
      setFormError('PIN Otorisasi (Outlet atau Owner) wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/crew-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          name: regName.trim(),
          outletId: regOutletId || outlets[0]?.id || 'all',
          activeOutletId: selectedOutletId || outlets[0]?.id || null,
          roleTitle: regRoleTitle.trim() || 'Barista',
          payType: regPayType,
          newPin: regNewPin.trim(),
          authPin: regAuthPin.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Gagal membuat akun kru.');
        setSubmitting(false);
        return;
      }
      const hydrated = await onSuccess();
      if (!hydrated) {
        setFormError('Akun dibuat, tetapi sesi gagal dimuat. Coba login ulang.');
        setSubmitting(false);
      }
    } catch {
      setFormError('Terjadi kesalahan jaringan. Coba lagi.');
      setSubmitting(false);
    }
  }

  async function handleResetPinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!activeEmployee) {
      setFormError('Pilih nama kru terlebih dahulu.');
      return;
    }
    if (!resetVerifyPin.trim()) {
      setFormError(resetVerifyMode === 'owner_pin' ? 'Masukkan PIN Owner.' : 'Masukkan PIN lama.');
      return;
    }
    if (!/^\d{4,8}$/.test(resetNewPin.trim())) {
      setFormError('PIN baru harus 4–8 digit angka.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/crew-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_pin',
          employeeId: activeEmployee.id,
          activeOutletId: selectedOutletId || outlets[0]?.id || null,
          verifyMode: resetVerifyMode,
          verifyPin: resetVerifyPin.trim(),
          newPin: resetNewPin.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Gagal mengubah PIN.');
        setSubmitting(false);
        return;
      }
      const hydrated = await onSuccess();
      if (!hydrated) {
        setFormError('PIN diubah, tetapi sesi gagal dimuat. Coba login ulang.');
        setSubmitting(false);
      }
    } catch {
      setFormError('Terjadi kesalahan jaringan. Coba lagi.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm sm:max-w-md space-y-3.5">
        {/* Compact Brand Header */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bara-logo.png"
              alt="Bara Coffee"
              className="h-9 sm:h-10 w-auto object-contain rounded-lg bg-white px-2 py-1 border border-[var(--card-border)] shrink-0"
            />
            <p className="text-[11px] font-medium text-[var(--muted-foreground)] leading-tight">
              Portal Kru, Kasir &amp; Owner
            </p>
          </div>
          {!loading && (
            <span
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                storageMode === 'local'
                  ? 'border border-[var(--warning)] text-[var(--warning)] bg-[var(--card)]'
                  : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
              }`}
            >
              {storageMode === 'local' ? 'Lokal Dummy' : 'Live Supabase'}
            </span>
          )}
        </div>

        {/* Main Card */}
        {!configured && !loading ? (
          <div className="bg-[var(--card)] border border-[var(--warning)] rounded-2xl p-4 space-y-2.5 text-xs">
            <h2 className="text-sm font-semibold text-[var(--warning)]">Konfigurasi Database Diperlukan</h2>
            <p className="text-[var(--muted-foreground)] leading-relaxed">
              Tambahkan <code className="px-1 py-0.5 rounded bg-[var(--secondary)]">NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-[var(--secondary)]">SUPABASE_SERVICE_ROLE_KEY</code>, dan{' '}
              <code className="px-1 py-0.5 rounded bg-[var(--secondary)]">SESSION_SECRET</code> di{' '}
              <code className="px-1 py-0.5 rounded bg-[var(--secondary)]">.env.local</code>, atau aktifkan{' '}
              <code className="px-1 py-0.5 rounded bg-[var(--secondary)]">USE_LOCAL_DB=true</code>.
            </p>
          </div>
        ) : loading ? (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-7 text-center text-xs text-[var(--muted-foreground)]">
            Memuat akses Bara Coffee...
          </div>
        ) : loadError ? (
          <div className="bg-[var(--card)] border border-[var(--error)] rounded-2xl p-4 text-xs text-[var(--error)] space-y-1.5">
            <div className="font-semibold">Gagal Terhubung ke Database</div>
            <p>{loadError}</p>
          </div>
        ) : (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
            {/* 2-Way Segmented Role Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--background)] border border-[var(--border)]">
              {(
                [
                  { id: 'crew' as const, label: 'Kru / Kasir' },
                  { id: 'owner' as const, label: 'Owner' },
                ] as const
              ).map((item) => {
                const active = roleTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => switchRoleTab(item.id)}
                    className={`py-2 px-2 rounded-lg text-xs transition-all cursor-pointer ${
                      active
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold shadow-sm'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-medium'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* KRU / KASIR - LOGIN MODE (OUTLET FIRST) */}
            {roleTab === 'crew' && crewMode === 'login' && (
              <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label htmlFor="login-outlet-select" className="text-xs font-medium text-[var(--muted-foreground)] block">
                    1. Pilih Outlet Bertugas
                  </label>
                  <select
                    id="login-outlet-select"
                    value={activeOutlet?.id || ''}
                    onChange={(e) => handleOutletChange(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  >
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="crew-select" className="text-xs font-medium text-[var(--muted-foreground)]">
                      2. Pilih Nama Kru
                    </label>
                    <button
                      type="button"
                      onClick={() => switchCrewMode('register')}
                      className="text-[11px] font-semibold text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      + Daftar Kru Baru
                    </button>
                  </div>

                  {outletEmployees.length > 0 ? (
                    <>
                      <select
                        id="crew-select"
                        value={activeEmployee?.id || ''}
                        onChange={(e) => {
                          setSelectedEmpId(e.target.value);
                          setFormError('');
                          requestAnimationFrame(() => pinInputRef.current?.focus());
                        }}
                        className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                      >
                        {outletEmployees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name} — {emp.roleTitle}
                            {emp.outletId === 'all' ? ' (Rolling)' : ''}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)] px-0.5 pt-0.5">
                        <span>Kasbon, Absensi &amp; Slip tetap dilindungi PIN pribadi</span>
                        <button
                          type="button"
                          onClick={() => switchCrewMode('reset')}
                          className="font-medium text-[var(--foreground)] hover:text-[var(--primary)] underline underline-offset-2 shrink-0 ml-2 cursor-pointer"
                        >
                          Lupa / Edit PIN?
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--background)] p-3 text-center space-y-2">
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Belum ada kru terdaftar untuk {activeOutlet?.name || 'outlet ini'}.
                      </p>
                      <button
                        type="button"
                        onClick={() => switchCrewMode('register')}
                        className="px-3 py-1.5 rounded-lg bg-[var(--secondary)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                      >
                        Daftar Kru di Outlet Ini
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="login-pin" className="text-xs font-medium text-[var(--muted-foreground)] block">
                    3. PIN Pribadi{activeEmployee ? ` (${activeEmployee.name})` : ''}
                  </label>
                  <input
                    ref={pinInputRef}
                    id="login-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    autoComplete="off"
                    placeholder="••••"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value.replace(/[^0-9]/g, ''));
                      setFormError('');
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-center text-lg tracking-[0.35em] font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                  {formError && <p className="text-xs text-[var(--error)] font-medium text-center pt-0.5">{formError}</p>}
                </div>

                <button
                  type="submit"
                  disabled={submitting || !pin || !activeOutlet || !activeEmployee}
                  className="w-full py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {submitting
                    ? 'Memverifikasi...'
                    : activeOutlet && activeEmployee
                      ? `Masuk ke ${activeOutlet.location || activeOutlet.name}`
                      : 'Masuk Kru / Kasir'}
                </button>
              </form>
            )}

            {/* KRU / KASIR - REGISTER MODE */}
            {roleTab === 'crew' && crewMode === 'register' && (
              <form onSubmit={handleRegisterSubmit} className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border)]">
                  <div>
                    <h2 className="text-xs font-semibold">Daftar Akun Kru Baru</h2>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      Gunakan PIN Outlet atau PIN Owner untuk otorisasi
                    </p>
                  </div>
                  {employees.length > 0 && (
                    <button
                      type="button"
                      onClick={() => switchCrewMode('login')}
                      className="text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer shrink-0"
                    >
                      &larr; Kembali
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-name" className="text-xs font-medium text-[var(--muted-foreground)] block">
                    Nama Lengkap
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    placeholder="cth: Raka Pratama"
                    value={regName}
                    onChange={(e) => {
                      setRegName(e.target.value);
                      setFormError('');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="reg-outlet" className="text-xs font-medium text-[var(--muted-foreground)] block">
                    Outlet Penugasan
                  </label>
                  <select
                    id="reg-outlet"
                    value={regOutletId}
                    onChange={(e) => {
                      setRegOutletId(e.target.value);
                      setFormError('');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  >
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                    <option value="all">Rolling (Semua Outlet)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label htmlFor="reg-role" className="text-xs font-medium text-[var(--muted-foreground)] block">
                      Posisi
                    </label>
                    <select
                      id="reg-role"
                      value={regRoleTitle}
                      onChange={(e) => setRegRoleTitle(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    >
                      {ROLE_TITLE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="reg-paytype" className="text-xs font-medium text-[var(--muted-foreground)] block">
                      Sistem Gaji
                    </label>
                    <select
                      id="reg-paytype"
                      value={regPayType}
                      onChange={(e) => setRegPayType(e.target.value === 'monthly' ? 'monthly' : 'daily')}
                      className="w-full px-2.5 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    >
                      <option value="daily">Part-Time Harian</option>
                      <option value="monthly">Bulanan</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label htmlFor="reg-pin" className="text-xs font-medium text-[var(--muted-foreground)] block">
                      Buat PIN Pribadi
                    </label>
                    <input
                      id="reg-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      autoComplete="off"
                      placeholder="4–8 digit"
                      value={regNewPin}
                      onChange={(e) => {
                        setRegNewPin(e.target.value.replace(/[^0-9]/g, ''));
                        setFormError('');
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-center text-sm tracking-widest font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="reg-auth-pin" className="text-xs font-medium text-[var(--muted-foreground)] block">
                      {regOutletId === 'all' ? 'PIN Owner' : 'PIN Outlet / Owner'}
                    </label>
                    <input
                      id="reg-auth-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      autoComplete="off"
                      placeholder="Otorisasi"
                      value={regAuthPin}
                      onChange={(e) => {
                        setRegAuthPin(e.target.value.replace(/[^0-9]/g, ''));
                        setFormError('');
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-center text-sm tracking-widest font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    />
                  </div>
                </div>

                {formError && <p className="text-xs text-[var(--error)] font-medium text-center">{formError}</p>}

                <button
                  type="submit"
                  disabled={submitting || !regName.trim() || !regNewPin || !regAuthPin}
                  className="w-full py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {submitting ? 'Membuat Akun...' : 'Buat Akun & Masuk'}
                </button>
              </form>
            )}

            {/* KRU / KASIR - RESET / EDIT PIN MODE */}
            {roleTab === 'crew' && crewMode === 'reset' && (
              <form onSubmit={handleResetPinSubmit} className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border)]">
                  <div>
                    <h2 className="text-xs font-semibold">Edit / Reset PIN Kru</h2>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      Ganti dengan PIN lama, atau reset via PIN Owner jika lupa
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchCrewMode('login')}
                    className="text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer shrink-0"
                  >
                    &larr; Kembali
                  </button>
                </div>

                <div className="space-y-1">
                  <label htmlFor="reset-crew-select" className="text-xs font-medium text-[var(--muted-foreground)] block">
                    Pilih Akun Kru
                  </label>
                  <select
                    id="reset-crew-select"
                    value={activeEmployee?.id || ''}
                    onChange={(e) => {
                      setSelectedEmpId(e.target.value);
                      setFormError('');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} — {getOutletLabel(emp.outletId)} ({emp.roleTitle})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-medium text-[var(--muted-foreground)] block">Metode Verifikasi</span>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--background)] border border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => {
                        setResetVerifyMode('old_pin');
                        setResetVerifyPin('');
                        setFormError('');
                      }}
                      className={`py-1.5 px-2 rounded-lg text-[11px] cursor-pointer transition-colors ${
                        resetVerifyMode === 'old_pin'
                          ? 'bg-[var(--secondary)] text-[var(--foreground)] font-semibold'
                          : 'text-[var(--muted-foreground)]'
                      }`}
                    >
                      Ingat PIN Lama
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetVerifyMode('owner_pin');
                        setResetVerifyPin('');
                        setFormError('');
                      }}
                      className={`py-1.5 px-2 rounded-lg text-[11px] cursor-pointer transition-colors ${
                        resetVerifyMode === 'owner_pin'
                          ? 'bg-[var(--secondary)] text-[var(--foreground)] font-semibold'
                          : 'text-[var(--muted-foreground)]'
                      }`}
                    >
                      Lupa (PIN Owner)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label htmlFor="reset-verify-pin" className="text-xs font-medium text-[var(--muted-foreground)] block">
                      {resetVerifyMode === 'owner_pin' ? 'PIN Owner' : 'PIN Lama'}
                    </label>
                    <input
                      id="reset-verify-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      autoComplete="off"
                      placeholder="••••"
                      value={resetVerifyPin}
                      onChange={(e) => {
                        setResetVerifyPin(e.target.value.replace(/[^0-9]/g, ''));
                        setFormError('');
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-center text-sm tracking-widest font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="reset-new-pin" className="text-xs font-medium text-[var(--muted-foreground)] block">
                      PIN Baru (4–8 digit)
                    </label>
                    <input
                      id="reset-new-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      autoComplete="off"
                      placeholder="••••"
                      value={resetNewPin}
                      onChange={(e) => {
                        setResetNewPin(e.target.value.replace(/[^0-9]/g, ''));
                        setFormError('');
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-center text-sm tracking-widest font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    />
                  </div>
                </div>

                {formError && <p className="text-xs text-[var(--error)] font-medium text-center">{formError}</p>}

                <button
                  type="submit"
                  disabled={submitting || !activeEmployee || !resetVerifyPin || !resetNewPin}
                  className="w-full py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {submitting ? 'Menyimpan PIN...' : 'Simpan PIN Baru & Masuk'}
                </button>
              </form>
            )}

            {/* OWNER MODE */}
            {roleTab === 'owner' && (
              <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                <div className="rounded-xl bg-[var(--background)] border border-[var(--border)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
                  Akses penuh Dashboard Multi-Outlet, Audit Shift, Rekap Absensi &amp; Kasbon, Payroll, dan Pengaturan.
                </div>

                <div className="space-y-1">
                  <label htmlFor="owner-pin" className="text-xs font-medium text-[var(--muted-foreground)] block">
                    PIN Owner
                  </label>
                  <input
                    ref={pinInputRef}
                    id="owner-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    autoComplete="off"
                    placeholder="••••"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value.replace(/[^0-9]/g, ''));
                      setFormError('');
                    }}
                    className="w-full px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-center text-lg tracking-[0.35em] font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                  {formError && <p className="text-xs text-[var(--error)] font-medium text-center pt-0.5">{formError}</p>}
                </div>

                <button
                  type="submit"
                  disabled={submitting || !pin}
                  className="w-full py-3 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                >
                  {submitting ? 'Memverifikasi...' : 'Buka Dashboard Owner'}
                </button>
              </form>
            )}
          </div>
        )}

        {storageMode === 'local' && !loading && !loadError && (
          <p className="text-center text-[11px] text-[var(--muted-foreground)] font-mono px-2">
            Demo PIN · Kru 1001/1002/2001 · Otorisasi Outlet 1111/2222 · Owner 9999
          </p>
        )}
      </div>
    </div>
  );
}

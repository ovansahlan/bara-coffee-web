'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getLocalDateStr } from '@/lib/calc';
import type { AppSettingsPublic, EmployeePublic, OutletPublic, UserRole } from '@/lib/types';
import LoginView from './LoginView';
import ShiftInputView from './ShiftInputView';
import OwnerDashboardView from './OwnerDashboardView';
import KasirHistoryView from './KasirHistoryView';
import SettingsView from './SettingsView';
import AttendanceView from './AttendanceView';
import CashAdvanceView from './CashAdvanceView';
import PayrollView from './PayrollView';
import CrewPayslipView from './CrewPayslipView';
import OwnerExpensesView from './OwnerExpensesView';

type ActiveTab =
  | 'owner'
  | 'owner-expenses'
  | 'input'
  | 'outlet-history'
  | 'absensi'
  | 'kasbon'
  | 'payroll'
  | 'slip-gaji'
  | 'pengaturan';

interface ToastState {
  msg: string;
  type: 'success' | 'warning' | 'error' | 'info';
}

function NavIcon({ id }: { id: ActiveTab }) {
  const cls = 'w-[18px] h-[18px] shrink-0';
  if (id === 'owner') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </svg>
    );
  }
  if (id === 'input') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 8h10" />
        <path d="M7 12h6" />
        <path d="M7 16h4" />
      </svg>
    );
  }
  if (id === 'absensi') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
    );
  }
  if (id === 'kasbon') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 12h.01" />
        <path d="M18 12h.01" />
      </svg>
    );
  }
  if (id === 'owner-expenses') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    );
  }
  if (id === 'payroll' || id === 'slip-gaji') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    );
  }
  if (id === 'outlet-history') {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function BaraCoffeeApp() {
  const [booting, setBooting] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [storageMode, setStorageMode] = useState<'local' | 'supabase' | 'unconfigured'>('supabase');
  const [role, setRole] = useState<UserRole>('outlet');
  const [currentEmployee, setCurrentEmployee] = useState<EmployeePublic | null>(null);
  const [outlets, setOutlets] = useState<OutletPublic[]>([]);
  const [settings, setSettings] = useState<AppSettingsPublic>({
    expenseCategories: ['Minuman', 'Makanan', 'Lain-Lain'],
    requireOwnerPinForCorrection: false,
  });

  const [tab, setTab] = useState<ActiveTab>('input');
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getLocalDateStr(0));
  const [selectedShift, setSelectedShift] = useState<1 | 2>(1);
  const [hasUnsavedShiftChanges, setHasUnsavedShiftChanges] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [todayAttendanceStatus, setTodayAttendanceStatus] = useState<{
    checkedIn: boolean;
    checkedOut: boolean;
    shift: 1 | 2 | 3 | null;
  } | null>(null);

  const showToast = useCallback((msg: string, type: ToastState['type'] = 'success') => {
    setToast({ msg, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.type === 'warning' ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const hydrateAuth = useCallback(async (resetTab = false): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = await res.json();
      if (data.storageMode) setStorageMode(data.storageMode);
      if (!data.authenticated || !data.session) {
        setAuthenticated(false);
        return false;
      }
      const nextRole: UserRole =
        data.session.role === 'owner' ? 'owner' : data.session.role === 'crew' ? 'crew' : 'outlet';
      const nextOutlets: OutletPublic[] = data.outlets || [];
      setRole(nextRole);
      setCurrentEmployee(nextRole === 'crew' ? data.employee || null : null);
      setTodayAttendanceStatus(nextRole === 'crew' ? data.todayAttendanceStatus || null : null);
      setOutlets(nextOutlets);
      if (data.settings) setSettings(data.settings);
      setSelectedOutletId((prev) => {
        if (nextRole === 'outlet') return data.session.outletId || nextOutlets[0]?.id || '';
        return nextOutlets.some((o) => o.id === prev) ? prev : nextOutlets[0]?.id || '';
      });
      if (resetTab) {
        setTab(nextRole === 'owner' ? 'owner' : 'input');
        setHasUnsavedShiftChanges(false);
        if (nextRole === 'crew' && data.employee && !data.todayAttendanceStatus?.checkedIn) {
          showToast(
            `Halo ${data.employee.name}, Anda belum absen masuk hari ini. Jangan lupa absen di tab Absensi!`,
            'warning'
          );
        }
      }
      setAuthenticated(true);
      return true;
    } catch {
      setAuthenticated(false);
      return false;
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    hydrateAuth(true);
  }, [hydrateAuth]);

  function confirmDiscardIfDirty(): boolean {
    if (tab === 'input' && hasUnsavedShiftChanges) {
      return window.confirm('Ada perubahan shift yang belum disimpan. Yakin ingin pindah halaman dan membatalkan perubahan?');
    }
    return true;
  }

  function handleSwitchTab(nextTab: ActiveTab) {
    if (nextTab === tab) return;
    if (!confirmDiscardIfDirty()) return;
    if (tab === 'absensi' && role === 'crew') {
      hydrateAuth(false);
    }
    setHasUnsavedShiftChanges(false);
    setTab(nextTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleLogout() {
    if (!confirmDiscardIfDirty()) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    setHasUnsavedShiftChanges(false);
    setCurrentEmployee(null);
    setAuthenticated(false);
    showToast('Akses dikunci.', 'info');
  }

  const lastActivityRef = useRef<number>(Date.now());
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 menit tidak aktif

  useEffect(() => {
    if (!authenticated) return;
    lastActivityRef.current = Date.now();

    const bumpActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const lockForInactivity = async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // ignore network error during auto-lock
      }
      setHasUnsavedShiftChanges(false);
      setCurrentEmployee(null);
      setTodayAttendanceStatus(null);
      setAuthenticated(false);
      showToast('Sesi terkunci otomatis karena tidak aktif selama 15 menit.', 'warning');
    };

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, bumpActivity, { passive: true }));

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        lockForInactivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        lockForInactivity();
      }
    }, 30_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bumpActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, [authenticated, showToast]);

  const toastMeta =
    toast?.type === 'success'
      ? {
          title: 'Berhasil',
          ring: 'border-[var(--success)]/35',
          badge: 'bg-emerald-50 text-[var(--success)]',
          icon: (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ),
        }
      : toast?.type === 'warning'
        ? {
            title: 'Pengingat',
            ring: 'border-[var(--warning)]/45',
            badge: 'bg-amber-50 text-[var(--warning)]',
            icon: (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            ),
          }
        : toast?.type === 'error'
          ? {
              title: 'Gagal',
              ring: 'border-[var(--error)]/40',
              badge: 'bg-red-50 text-[var(--error)]',
              icon: (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              ),
            }
          : {
              title: 'Info',
              ring: 'border-[var(--primary)]/30',
              badge: 'bg-[var(--secondary)] text-[var(--primary)]',
              icon: (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              ),
            };

  const toastNode = toast ? (
    <div
      onClick={() => setToast(null)}
      role="status"
      className={`animate-toast-in fixed z-50 top-4 sm:top-5 left-1/2 w-[calc(100%-2rem)] max-w-md px-3.5 py-3 rounded-2xl bg-white/95 backdrop-blur-md border ${toastMeta.ring} shadow-[0_14px_34px_-8px_rgba(1,38,105,0.22)] flex items-center justify-between gap-3 cursor-pointer`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${toastMeta.badge}`}>
          {toastMeta.icon}
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] leading-none mb-1">
            {toastMeta.title}
          </div>
          <div className="text-xs sm:text-[13px] font-medium text-[var(--foreground)] leading-snug">
            {toast.msg}
          </div>
        </div>
      </div>
      <span
        aria-label="Tutup notifikasi"
        className="w-6 h-6 rounded-full bg-[var(--background)] hover:bg-[var(--secondary)] text-[var(--muted-foreground)] flex items-center justify-center text-xs shrink-0 transition-colors"
      >
        &times;
      </span>
    </div>
  ) : null;

  if (booting) {
    return (
      <>
        {toastNode}
        <div className="min-h-screen flex items-center justify-center p-6 text-xs text-[var(--muted-foreground)]">
          Menghubungkan ke Bara Coffee...
        </div>
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
        {toastNode}
        <LoginView onSuccess={() => hydrateAuth(true)} />
      </>
    );
  }

  const isOwner = role === 'owner';
  const isCrew = role === 'crew';
  const currentOutlet = outlets.find((o) => o.id === selectedOutletId) || outlets[0];
  const modeText = storageMode === 'local' ? 'Mode Lokal Dummy' : 'Online Supabase';

  const navItems: Array<{ id: ActiveTab; label: string; shortLabel: string }> = isOwner
    ? [
        { id: 'owner', label: 'Dashboard', shortLabel: 'Home' },
        { id: 'owner-expenses', label: 'Pengeluaran Owner', shortLabel: 'Belanja' },
        { id: 'input', label: 'Input / Audit', shortLabel: 'Shift' },
        { id: 'absensi', label: 'Rekap Absensi', shortLabel: 'Absen' },
        { id: 'kasbon', label: 'Rekap Kasbon', shortLabel: 'Kasbon' },
        { id: 'payroll', label: 'Payroll', shortLabel: 'Payroll' },
        { id: 'pengaturan', label: 'Tim & Setting', shortLabel: 'Setting' },
      ]
    : isCrew
      ? [
          { id: 'input', label: 'Input Shift', shortLabel: 'Shift' },
          { id: 'absensi', label: 'Absensi', shortLabel: 'Absensi' },
          { id: 'kasbon', label: 'Kasbon', shortLabel: 'Kasbon' },
          { id: 'outlet-history', label: 'Riwayat', shortLabel: 'Riwayat' },
          { id: 'slip-gaji', label: 'Slip Gaji', shortLabel: 'Slip PDF' },
        ]
      : [
          { id: 'input', label: 'Input Shift', shortLabel: 'Shift' },
          { id: 'absensi', label: 'Absensi', shortLabel: 'Absensi' },
          { id: 'kasbon', label: 'Kasbon', shortLabel: 'Kasbon' },
          { id: 'outlet-history', label: 'Riwayat Outlet', shortLabel: 'Riwayat' },
          { id: 'slip-gaji', label: 'Slip Gaji', shortLabel: 'Slip PDF' },
        ];

  return (
    <div className="min-h-screen flex flex-col">
      {toastNode}

      {/* Sticky Compact Header */}
      <header className="sticky top-0 z-30 bg-[var(--background)]/95 backdrop-blur border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bara-logo.png"
              alt="Bara Coffee"
              className="h-7 sm:h-8 w-auto object-contain rounded-md bg-white px-1.5 py-0.5 border border-[var(--card-border)] shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] truncate max-w-[140px] sm:max-w-none ${
                    isOwner
                      ? 'font-semibold bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'font-medium bg-[var(--secondary)] text-[var(--foreground)]'
                  }`}
                >
                  {isOwner
                    ? 'Owner'
                    : isCrew
                      ? `${currentOutlet?.location || currentOutlet?.name || 'Outlet'} · ${currentEmployee?.name || 'Kru'}`
                      : `Kasir · ${currentOutlet?.location || currentOutlet?.name || ''}`}
                </span>
                {storageMode === 'local' && (
                  <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border border-[var(--warning)] text-[var(--warning)]">
                    Lokal
                  </span>
                )}
              </div>
              <p className="hidden sm:block text-[11px] text-[var(--muted-foreground)] truncate mt-0.5">
                {isOwner
                  ? `Pemantauan ${outlets.length} Outlet · Rekap Omset, Absensi, Kasbon & Payroll (${modeText})`
                  : isCrew
                    ? `${currentOutlet?.name || 'Outlet'} · Login: ${currentEmployee?.name || 'Kru'} · Menu Private Dilindungi PIN`
                    : `${currentOutlet?.name || ''} — Akses Terisolasi (${modeText})`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <nav className="hidden lg:flex items-center gap-1 p-1 rounded-lg bg-[var(--card)] border border-[var(--border)]">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSwitchTab(item.id)}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    tab === item.id
                      ? 'font-semibold bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer"
            >
              Kunci
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 pt-4 pb-24 lg:pb-8 space-y-4 sm:space-y-5">
        {tab === 'owner' && isOwner && (
          <OwnerDashboardView
            settings={settings}
            onOpenShift={(oid, date, shift) => {
              setSelectedOutletId(oid);
              setSelectedDate(date);
              setSelectedShift(shift);
              setTab('input');
            }}
            onToast={showToast}
          />
        )}

        {tab === 'owner-expenses' && isOwner && (
          <OwnerExpensesView outlets={outlets} onToast={showToast} />
        )}

        {tab === 'input' && currentOutlet && (
          <ShiftInputView
            role={role}
            outlets={outlets}
            settings={settings}
            selectedOutletId={currentOutlet.id}
            selectedDate={selectedDate}
            selectedShift={selectedShift}
            canSwitchOutlet={isOwner}
            defaultCashierName={isCrew ? currentEmployee?.name || '' : ''}
            todayAttendanceStatus={todayAttendanceStatus}
            onChangeContext={(next) => {
              if (next.outletId && isOwner) {
                setSelectedOutletId(next.outletId);
              }
              if (next.date) setSelectedDate(next.date);
              if (next.shift) setSelectedShift(next.shift);
            }}
            onDirtyChange={setHasUnsavedShiftChanges}
            onToast={showToast}
          />
        )}

        {tab === 'outlet-history' && (role === 'outlet' || isCrew) && currentOutlet && (
          <KasirHistoryView
            outlet={currentOutlet}
            settings={settings}
            onOpenShift={(date, shift) => {
              setSelectedDate(date);
              setSelectedShift(shift);
              setTab('input');
            }}
            onToast={showToast}
          />
        )}

        {tab === 'absensi' && currentOutlet && (
          <AttendanceView
            role={role}
            outlets={outlets}
            selectedOutletId={currentOutlet.id}
            currentEmployee={currentEmployee}
            settings={settings}
            onToast={showToast}
          />
        )}

        {tab === 'kasbon' && currentOutlet && (
          <CashAdvanceView
            role={role}
            outlets={outlets}
            selectedOutletId={currentOutlet.id}
            currentEmployee={currentEmployee}
            onToast={showToast}
          />
        )}

        {tab === 'slip-gaji' && !isOwner && (
          <CrewPayslipView currentEmployee={currentEmployee} outlets={outlets} onToast={showToast} />
        )}

        {tab === 'payroll' && isOwner && <PayrollView outlets={outlets} onToast={showToast} />}

        {tab === 'pengaturan' && isOwner && (
          <SettingsView onSettingsUpdated={() => hydrateAuth(false).then(() => undefined)} onToast={showToast} />
        )}
      </main>

      {/* Mobile & Tablet Bottom Navigation Bar */}
      <nav
        aria-label="Navigasi Utama"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--card)]/95 backdrop-blur border-t border-[var(--border)] safe-bottom"
      >
        <div
          className={`max-w-2xl mx-auto grid ${
            navItems.length === 7
              ? 'grid-cols-7'
              : navItems.length === 6
                ? 'grid-cols-6'
                : navItems.length === 5
                  ? 'grid-cols-5'
                  : navItems.length === 4
                    ? 'grid-cols-4'
                    : 'grid-cols-3'
          }`}
        >
          {navItems.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSwitchTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-2 px-1 transition-colors cursor-pointer ${
                  active ? 'text-[var(--primary)] font-semibold' : 'text-[var(--muted-foreground)] font-medium'
                }`}
              >
                {active && (
                  <span className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-[var(--primary)]" />
                )}
                <NavIcon id={item.id} />
                <span className="text-[10px] sm:text-[11px] leading-tight truncate max-w-full">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

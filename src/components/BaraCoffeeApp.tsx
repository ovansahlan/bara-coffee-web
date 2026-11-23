'use client';

import React, { useCallback, useEffect, useState } from 'react';
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

type ActiveTab =
  | 'owner'
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

  const showToast = useCallback((msg: string, type: ToastState['type'] = 'success') => {
    setToast({ msg, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
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
      setOutlets(nextOutlets);
      if (data.settings) setSettings(data.settings);
      setSelectedOutletId((prev) => {
        if (nextRole === 'outlet') return data.session.outletId || nextOutlets[0]?.id || '';
        return nextOutlets.some((o) => o.id === prev) ? prev : nextOutlets[0]?.id || '';
      });
      if (resetTab) {
        setTab(nextRole === 'owner' ? 'owner' : 'input');
        setHasUnsavedShiftChanges(false);
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

  const toastDotCls =
    toast?.type === 'success'
      ? 'bg-[var(--success)]'
      : toast?.type === 'warning'
        ? 'bg-[var(--warning)]'
        : toast?.type === 'error'
          ? 'bg-[var(--error)]'
          : 'bg-[var(--primary)]';

  const toastNode = toast ? (
    <div
      className={`fixed z-50 px-4 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-lg text-xs font-medium flex items-center gap-2 ${
        authenticated
          ? 'bottom-20 lg:bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm'
          : 'bottom-5 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${toastDotCls}`} />
      <span className="leading-snug">{toast.msg}</span>
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
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
                <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
                <path d="M6 2v3" />
                <path d="M10 2v3" />
                <path d="M14 2v3" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="text-sm sm:text-base font-semibold tracking-tight leading-tight">Bara Coffee</h1>
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
            navItems.length === 6
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

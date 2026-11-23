'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateIndo, formatDateTimeShort, formatRp } from '@/lib/calc';
import { downloadPayslipPdf } from '@/lib/payslip-pdf';
import type { CrewPayslipEntry, EmployeePublic, OutletPublic } from '@/lib/types';

interface CrewPayslipViewProps {
  currentEmployee?: EmployeePublic | null;
  outlets: OutletPublic[];
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

const IDLE_LOCK_MS = 120_000;

export default function CrewPayslipView({ currentEmployee, outlets, onToast }: CrewPayslipViewProps) {
  const [loadingEmps, setLoadingEmps] = useState(true);
  const [employees, setEmployees] = useState<EmployeePublic[]>([]);
  const [gateEmpId, setGateEmpId] = useState(currentEmployee?.id || '');
  const [gatePin, setGatePin] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [gateError, setGateError] = useState('');

  const [unlocked, setUnlocked] = useState<{
    employee: EmployeePublic;
    slips: CrewPayslipEntry[];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const outletParam = outlets[0]?.id ? `?outletId=${encodeURIComponent(outlets[0].id)}` : '';
    setLoadingEmps(true);
    fetch(`/api/employees${outletParam}`, { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Gagal memuat daftar kru.');
        const list: EmployeePublic[] = Array.isArray(d.employees) ? d.employees : [];
        setEmployees(list);
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
  }, [outlets, currentEmployee, onToast]);

  const lockView = useCallback((reason?: string) => {
    setUnlocked(null);
    setGatePin('');
    setGateError('');
    if (reason) onToast(reason, 'info');
  }, [onToast]);

  // Auto-lock after 2 minutes of inactivity on shared outlet device
  useEffect(() => {
    if (!unlocked) return;
    let timer = window.setTimeout(() => {
      lockView('Tampilan slip gaji dikunci otomatis setelah 2 menit tidak aktif.');
    }, IDLE_LOCK_MS);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lockView('Tampilan slip gaji dikunci otomatis setelah 2 menit tidak aktif.');
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
  }, [unlocked, lockView]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!gateEmpId) return setGateError('Pilih nama kru terlebih dahulu.');
    if (!gatePin.trim()) return setGateError('Masukkan PIN pribadi Anda.');

    setUnlocking(true);
    setGateError('');
    try {
      const res = await fetch('/api/payroll/crew-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: gateEmpId, pin: gatePin.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGateError(data.error || 'PIN pribadi salah.');
        return;
      }
      setUnlocked({
        employee: data.employee,
        slips: Array.isArray(data.slips) ? data.slips : [],
      });
      setGatePin('');
    } catch {
      setGateError('Gagal memverifikasi PIN. Periksa koneksi.');
    } finally {
      setUnlocking(false);
    }
  }

  const outletNameById = useMemo(() => new Map(outlets.map((o) => [o.id, o.name])), [outlets]);
  const totalReceived = useMemo(
    () => (unlocked ? unlocked.slips.reduce((s, x) => s + x.item.netPay, 0) : 0),
    [unlocked]
  );

  function handleDownloadPdf(slip: CrewPayslipEntry) {
    const outletName =
      slip.item.outletId === 'all'
        ? 'Semua Outlet (Rolling)'
        : outletNameById.get(slip.item.outletId) || slip.item.outletId;
    downloadPayslipPdf({
      periodLabel: slip.periodLabel,
      fromDate: slip.fromDate,
      toDate: slip.toDate,
      status: 'paid',
      paidAt: slip.paidAt,
      outletName,
      item: slip.item,
    });
    onToast(`Slip gaji PDF (${slip.periodLabel}) diunduh.`, 'success');
  }

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto py-2">
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[var(--secondary)] text-[11px] font-semibold text-[var(--primary)]">
              Dilindungi PIN Pribadi
            </div>
            <h2 className="text-sm font-semibold">Buka Slip Gaji (PDF)</h2>
            <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              Karena perangkat outlet dipakai bersama, masukkan PIN pribadi untuk melihat dan mengunduh slip gaji milik Anda sendiri.
            </p>
          </div>

          {loadingEmps ? (
            <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">Memuat daftar kru...</div>
          ) : (
            <form onSubmit={handleUnlock} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="slip-gate-emp" className="text-xs text-[var(--muted-foreground)] block">
                  Nama Kru
                </label>
                <select
                  id="slip-gate-emp"
                  value={gateEmpId}
                  onChange={(e) => {
                    setGateEmpId(e.target.value);
                    setGateError('');
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] text-xs sm:text-sm font-medium"
                >
                  {employees.length === 0 && <option value="">Belum ada kru aktif di outlet ini</option>}
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} — {emp.roleTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="slip-gate-pin" className="text-xs text-[var(--muted-foreground)] block">
                  PIN Pribadi
                </label>
                <input
                  id="slip-gate-pin"
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
                {unlocking ? 'Memverifikasi PIN...' : 'Buka Slip Gaji Saya'}
              </button>
            </form>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="bg-[var(--card)] border border-[var(--primary)] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Slip Gaji Pribadi — {unlocked.employee.name}</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            {unlocked.employee.roleTitle} ({unlocked.employee.payType === 'daily' ? 'Part-Time Harian' : 'Bulanan'}) ·{' '}
            {unlocked.slips.length} slip · Total Diterima{' '}
            <strong className="text-[var(--foreground)]">{formatRp(totalReceived)}</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={() => lockView()}
          className="px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-semibold shrink-0 self-start sm:self-auto cursor-pointer"
        >
          Kunci &amp; Tutup
        </button>
      </section>

      {unlocked.slips.length === 0 ? (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center text-xs text-[var(--muted-foreground)]">
          Belum ada slip gaji yang difinalisasi oleh Owner untuk {unlocked.employee.name}.
        </div>
      ) : (
        <div className="space-y-4">
          {unlocked.slips.map((slip) => {
            const it = slip.item;
            const totalDeductions = it.lateDeduction + it.kasbonDeduction + it.otherDeduction;
            return (
              <section
                key={slip.payrollId}
                className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--card-border)]">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{slip.periodLabel}</h3>
                      <span className="px-2 py-0.5 rounded border border-[var(--success)] text-[var(--success)] text-xs font-medium">
                        Dibayar {slip.paidAt ? `· ${formatDateTimeShort(slip.paidAt)}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5 tabular-nums">
                      Periode {formatDateIndo(slip.fromDate)} – {formatDateIndo(slip.toDate)} · {it.daysPresent} hadir
                      {it.fullShiftCount ? ` (${it.fullShiftCount}x full shift)` : ''} · {it.lateCount} telat ·{' '}
                      {it.overtimeHours} jam lembur
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(slip)}
                    className="w-full sm:w-auto px-3.5 py-2.5 sm:py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                  >
                    Unduh Slip Gaji (PDF)
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs tabular-nums">
                  <div className="p-3.5 rounded-lg bg-[var(--background)] border border-[var(--card-border)] space-y-2">
                    <div className="font-semibold text-[var(--foreground)]">Rincian Pendapatan</div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted-foreground)]">
                        {it.payType === 'daily' ? 'Upah Part-Time Harian' : 'Gaji Pokok Bulanan'}
                      </span>
                      <span className="font-medium">{formatRp(it.basePay)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted-foreground)]">Uang Makan / Transport</span>
                      <span className="font-medium">{formatRp(it.mealTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted-foreground)]">Upah Lembur</span>
                      <span className="font-medium">{formatRp(it.overtimePay)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted-foreground)]">Bonus / Insentif</span>
                      <span className="font-medium">{formatRp(it.bonus)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-[var(--border)] font-semibold">
                      <span>Total Gaji Kotor</span>
                      <span className="text-[var(--success)]">{formatRp(it.grossPay)}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[var(--background)] border border-[var(--card-border)] space-y-2 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="font-semibold text-[var(--foreground)]">Rincian Potongan</div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted-foreground)]">Potongan Keterlambatan</span>
                        <span className="font-medium text-[var(--error)]">-{formatRp(it.lateDeduction)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted-foreground)]">Potongan Kasbon</span>
                        <span className="font-medium text-[var(--error)]">-{formatRp(it.kasbonDeduction)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--muted-foreground)]">Potongan Lainnya</span>
                        <span className="font-medium text-[var(--error)]">-{formatRp(it.otherDeduction)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-[var(--border)] font-semibold">
                        <span>Total Potongan</span>
                        <span className="text-[var(--error)]">-{formatRp(totalDeductions)}</span>
                      </div>
                    </div>

                    <div className="mt-2 p-2.5 rounded-lg bg-[var(--secondary)] border border-[var(--primary)] flex items-center justify-between">
                      <span className="font-semibold text-[var(--primary)]">Gaji Bersih Diterima</span>
                      <span className="text-base font-bold text-[var(--primary)]">{formatRp(it.netPay)}</span>
                    </div>
                  </div>
                </div>

                {it.note && (
                  <div className="text-xs text-[var(--muted-foreground)]">
                    Catatan: <span className="text-[var(--foreground)]">{it.note}</span>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

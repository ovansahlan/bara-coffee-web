'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SHIFT_SCHEDULE,
  formatAttendanceShiftLabel,
  formatDateIndo,
  formatTimeWibFromIso,
  getLocalDateStr,
} from '@/lib/calc';
import type {
  AppSettingsPublic,
  AttendanceRecord,
  AttendanceShift,
  AttendanceStatus,
  EmployeePublic,
  OutletPublic,
  UserRole,
} from '@/lib/types';

interface AttendanceViewProps {
  role: UserRole;
  outlets: OutletPublic[];
  selectedOutletId: string;
  currentEmployee?: EmployeePublic | null;
  settings: AppSettingsPublic;
  onToast: (msg: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

function compressImageToJpeg(source: HTMLVideoElement | HTMLImageElement, maxWidth = 480, quality = 0.62): string {
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  const ratio = srcW > maxWidth ? maxWidth / srcW : 1;
  const w = Math.max(1, Math.round(srcW * ratio));
  const h = Math.max(1, Math.round(srcH * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung kompresi gambar canvas.');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

function estimateBase64Kb(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.max(1, Math.round((b64.length * 3) / 4 / 1024));
}

export default function AttendanceView({
  role,
  outlets,
  selectedOutletId,
  currentEmployee,
  settings,
  onToast,
}: AttendanceViewProps) {
  const isOwner = role === 'owner';
  const isCrew = role === 'crew';
  const schedule = settings.shiftSchedule || DEFAULT_SHIFT_SCHEDULE;

  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<EmployeePublic[]>([]);
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [today, setToday] = useState(getLocalDateStr(0));

  // Clock-in/out form (only for outlet or crew)
  const [clockOutletId, setClockOutletId] = useState(
    currentEmployee && currentEmployee.outletId !== 'all'
      ? currentEmployee.outletId
      : selectedOutletId || outlets[0]?.id || ''
  );
  const [clockShift, setClockShift] = useState<AttendanceShift>(1);
  const [clockEmpId, setClockEmpId] = useState(currentEmployee?.id || '');
  const [clockPin, setClockPin] = useState('');
  const [clockNote, setClockNote] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');

  // History filters
  const [filterOutlet, setFilterOutlet] = useState(isOwner ? 'all' : selectedOutletId);
  const [filterRange, setFilterRange] = useState<'today' | '7days' | '30days'>('7days');
  const [lightboxPhoto, setLightboxPhoto] = useState<{ src: string; caption: string } | null>(null);

  // Owner manual status form
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEmpId, setManualEmpId] = useState('');
  const [manualOutletId, setManualOutletId] = useState(outlets[0]?.id || '');
  const [manualDate, setManualDate] = useState(getLocalDateStr(0));
  const [manualShift, setManualShift] = useState<AttendanceShift>(1);
  const [manualStatus, setManualStatus] = useState<AttendanceStatus>('izin');
  const [manualNote, setManualNote] = useState('');

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (isCrew && currentEmployee) {
      setClockEmpId(currentEmployee.id);
      if (currentEmployee.outletId !== 'all') {
        setClockOutletId(currentEmployee.outletId);
      } else if (outlets[0]?.id) {
        setClockOutletId((prev) => prev || outlets[0].id);
      }
    } else if (role === 'outlet' && selectedOutletId) {
      setClockOutletId(selectedOutletId);
      setFilterOutlet(selectedOutletId);
    }
  }, [isCrew, currentEmployee, role, selectedOutletId, outlets]);

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const from =
          filterRange === 'today'
            ? getLocalDateStr(0)
            : filterRange === '7days'
              ? getLocalDateStr(-6)
              : getLocalDateStr(-29);
        const to = getLocalDateStr(0);

        const attParams = new URLSearchParams({ from, to });
        if (isOwner && filterOutlet !== 'all') attParams.set('outletId', filterOutlet);

        const empParams = new URLSearchParams();
        if (!isOwner && selectedOutletId) empParams.set('outletId', selectedOutletId);

        const [empRes, attRes] = await Promise.all([
          fetch(`/api/employees?${empParams.toString()}`, { cache: 'no-store', signal }),
          fetch(`/api/attendance?${attParams.toString()}`, { cache: 'no-store', signal }),
        ]);

        const [empData, attData] = await Promise.all([empRes.json(), attRes.json()]);
        if (!attRes.ok) throw new Error(attData.error || 'Gagal memuat absensi.');
        if (!empRes.ok) throw new Error(empData.error || 'Gagal memuat karyawan.');
        if (signal?.aborted) return;

        const emps: EmployeePublic[] = empData.employees || [];
        setEmployees(emps);
        setAttendances(attData.attendances || []);
        if (attData.today) setToday(attData.today);
        setClockEmpId((prev) => {
          if (emps.some((e) => e.id === prev)) return prev;
          if (currentEmployee && emps.some((e) => e.id === currentEmployee.id)) return currentEmployee.id;
          return emps[0]?.id || '';
        });
        setManualEmpId((prev) => (emps.some((e) => e.id === prev) ? prev : emps[0]?.id || ''));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onToast(err instanceof Error ? err.message : 'Gagal memuat absensi.', 'error');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filterOutlet, filterRange, isOwner, isCrew, role, selectedOutletId, currentEmployee, onToast]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  async function startCamera() {
    setCameraError('');
    setPhotoDataUrl(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Browser tidak mendukung kamera langsung. Gunakan tombol Kamera HP / File di bawah.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setCameraError('Akses kamera ditolak atau tidak tersedia. Gunakan tombol Kamera HP / File.');
    }
  }

  function captureFromCamera() {
    if (!videoRef.current || videoRef.current.videoWidth === 0) {
      onToast('Kamera belum siap, tunggu sebentar lalu coba lagi.', 'warning');
      return;
    }
    try {
      const compressed = compressImageToJpeg(videoRef.current, 480, 0.62);
      setPhotoDataUrl(compressed);
      stopCamera();
      onToast(`Foto selfie diambil & dikompres (${estimateBase64Kb(compressed)} KB).`, 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengambil foto.', 'error');
    }
  }

  function handleFileFallback(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const compressed = compressImageToJpeg(img, 480, 0.6);
          setPhotoDataUrl(compressed);
          stopCamera();
          onToast(`Foto berhasil dikompres (${estimateBase64Kb(compressed)} KB).`, 'info');
        } catch (err) {
          onToast(err instanceof Error ? err.message : 'Gagal mengompres foto.', 'error');
        }
      };
      img.onerror = () => onToast('File gambar tidak valid.', 'error');
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function submitClock(action: 'check_in' | 'check_out') {
    if (!clockEmpId) return onToast('Pilih nama karyawan terlebih dahulu.', 'warning');
    if (!clockPin.trim()) return onToast('Masukkan PIN pribadi karyawan.', 'warning');
    if (!photoDataUrl) return onToast('Wajib ambil foto selfie terlebih dahulu.', 'warning');

    setSubmitting(true);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          employeeId: clockEmpId,
          outletId: clockOutletId,
          shift: clockShift,
          pin: clockPin.trim(),
          photo: photoDataUrl,
          note: clockNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mencatat absensi.');
      setClockPin('');
      setClockNote('');
      setPhotoDataUrl(null);
      onToast(
        action === 'check_in'
          ? `Absen MASUK ${data.attendance.employeeName} tercatat (${formatTimeWibFromIso(data.attendance.checkInAt)} WIB).`
          : `Absen PULANG ${data.attendance.employeeName} tercatat (${formatTimeWibFromIso(data.attendance.checkOutAt)} WIB).`,
        'success'
      );
      loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mencatat absensi.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitManualAttendance(e: React.FormEvent) {
    e.preventDefault();
    if (!manualEmpId || !manualOutletId) return;
    try {
      const res = await fetch('/api/attendance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: manualEmpId,
          outletId: manualOutletId,
          date: manualDate,
          shift: manualShift,
          status: manualStatus,
          note: manualNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan absensi manual.');
      setManualNote('');
      setManualOpen(false);
      onToast('Status absensi manual tersimpan.', 'success');
      loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyimpan.', 'error');
    }
  }

  async function handleDeleteAttendance(id: string) {
    if (!window.confirm('Hapus catatan absensi ini?')) return;
    try {
      const res = await fetch(`/api/attendance?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus absensi.');
      onToast('Absensi dihapus.', 'info');
      loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus.', 'error');
    }
  }

  async function handleClearOvertime(a: AttendanceRecord) {
    try {
      const res = await fetch('/api/attendance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: a.id,
          employeeId: a.employeeId,
          outletId: a.outletId,
          date: a.date,
          shift: a.shift,
          status: a.status,
          lateMinutes: a.lateMinutes,
          overtimeMinutes: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menolkan lembur.');
      onToast(`Lembur ${a.employeeName} dinolkan (dianggap telat absen pulang).`, 'info');
      loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal memperbarui lembur.', 'error');
    }
  }

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const todayAttendances = useMemo(() => attendances.filter((a) => a.date === today), [attendances, today]);

  const activeOpenForSelected = useMemo(
    () => todayAttendances.find((a) => a.employeeId === clockEmpId && a.checkInAt && !a.checkOutAt),
    [todayAttendances, clockEmpId]
  );

  const summary = useMemo(() => {
    let hadir = 0,
      telat = 0,
      izinSakit = 0,
      alpha = 0,
      fullShift = 0,
      overtimeMin = 0;
    attendances.forEach((a) => {
      if (a.status === 'hadir') hadir++;
      else if (a.status === 'telat') telat++;
      else if (a.status === 'izin' || a.status === 'sakit') izinSakit++;
      else if (a.status === 'alpha') alpha++;
      if (a.shift === 3 && (a.status === 'hadir' || a.status === 'telat')) fullShift++;
      overtimeMin += a.overtimeMinutes || 0;
    });
    return {
      hadir,
      telat,
      izinSakit,
      alpha,
      fullShift,
      overtimeHours: Math.round((overtimeMin / 60) * 10) / 10,
    };
  }, [attendances]);

  const perEmployeeRecap = useMemo(() => {
    if (!isOwner) return [];
    const map = new Map<
      string,
      {
        employeeId: string;
        name: string;
        roleTitle: string;
        payType: 'monthly' | 'daily';
        hadir: number;
        telat: number;
        fullShift: number;
        lateMinutes: number;
        izinSakit: number;
        alpha: number;
        overtimeMinutes: number;
      }
    >();
    employees.forEach((e) => {
      map.set(e.id, {
        employeeId: e.id,
        name: e.name,
        roleTitle: e.roleTitle,
        payType: e.payType,
        hadir: 0,
        telat: 0,
        fullShift: 0,
        lateMinutes: 0,
        izinSakit: 0,
        alpha: 0,
        overtimeMinutes: 0,
      });
    });
    attendances.forEach((a) => {
      const row = map.get(a.employeeId) || {
        employeeId: a.employeeId,
        name: a.employeeName,
        roleTitle: '-',
        payType: 'monthly' as const,
        hadir: 0,
        telat: 0,
        fullShift: 0,
        lateMinutes: 0,
        izinSakit: 0,
        alpha: 0,
        overtimeMinutes: 0,
      };
      if (a.status === 'hadir') row.hadir++;
      else if (a.status === 'telat') {
        row.telat++;
        row.lateMinutes += a.lateMinutes || 0;
      } else if (a.status === 'izin' || a.status === 'sakit') row.izinSakit++;
      else if (a.status === 'alpha') row.alpha++;
      if (a.shift === 3 && (a.status === 'hadir' || a.status === 'telat')) row.fullShift++;
      row.overtimeMinutes += a.overtimeMinutes || 0;
      map.set(a.employeeId, row);
    });
    return [...map.values()];
  }, [isOwner, employees, attendances]);

  return (
    <div className="space-y-5">
      {/* Owner Header (Recap-Only + Manual Izin/Sakit/Alpha) OR Crew/Outlet Clock-in Card */}
      {isOwner ? (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Rekap &amp; Pemantauan Absensi Karyawan</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                Shift 1: {schedule.shift1Start}–{schedule.shift1End} · Shift 2: {schedule.shift2Start}–{schedule.shift2End} ·
                Full Shift: {schedule.shift1Start}–{schedule.shift2End} (Toleransi telat {schedule.lateGraceMinutes} mnt).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium self-start sm:self-auto cursor-pointer"
            >
              {manualOpen ? 'Tutup Input Manual' : '+ Input Izin / Sakit / Alpha'}
            </button>
          </div>

          {manualOpen && (
            <form
              onSubmit={submitManualAttendance}
              className="p-3.5 rounded-lg bg-[var(--background)] border border-[var(--border)] grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
            >
              <div className="sm:col-span-3 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Karyawan</label>
                <select
                  value={manualEmpId}
                  onChange={(e) => setManualEmpId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs"
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.payType === 'daily' ? 'Harian' : 'Bulanan'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Outlet</label>
                <select
                  value={manualOutletId}
                  onChange={(e) => setManualOutletId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs"
                >
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Tanggal</label>
                <input
                  type="date"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs"
                />
              </div>
              <div className="sm:col-span-1 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Shift</label>
                <select
                  value={manualShift}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setManualShift(v === 3 ? 3 : v === 2 ? 2 : 1);
                  }}
                  className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs"
                >
                  <option value={1}>Shift 1</option>
                  <option value={2}>Shift 2</option>
                  <option value={3}>Full Shift</option>
                </select>
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Status</label>
                <select
                  value={manualStatus}
                  onChange={(e) => setManualStatus(e.target.value as AttendanceStatus)}
                  className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs"
                >
                  <option value="izin">Izin</option>
                  <option value="sakit">Sakit</option>
                  <option value="alpha">Alpha</option>
                  <option value="hadir">Hadir (Manual)</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="w-full py-1.5 px-3 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold cursor-pointer"
                >
                  Simpan Status
                </button>
              </div>
              <div className="sm:col-span-12">
                <input
                  type="text"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="Catatan keterangan (opsional, misal: Surat dokter / izin keluarga)"
                  className="w-full px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] text-xs"
                />
              </div>
            </form>
          )}
        </section>
      ) : (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
          <div className="pb-3 border-b border-[var(--card-border)]">
            <h2 className="text-sm font-semibold">
              Absensi Karyawan — {outletMap.get(clockOutletId)?.name || 'Outlet Aktif'}
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Wajib foto selfie + verifikasi PIN pribadi setiap absen (Shift 1: {schedule.shift1Start}–{schedule.shift1End},
              Shift 2: {schedule.shift2Start}–{schedule.shift2End}, Full Shift: {schedule.shift1Start}–{schedule.shift2End})
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left: Selfie Capture & Compression */}
            <div className="lg:col-span-5 space-y-3 max-w-sm mx-auto w-full lg:max-w-none">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden aspect-[4/3] flex flex-col items-center justify-center relative">
                {cameraActive ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                ) : photoDataUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoDataUrl} alt="Preview Selfie Absensi" className="w-full h-full object-cover" />
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/70 text-white text-[11px] font-mono">
                      Terkompresi · {estimateBase64Kb(photoDataUrl)} KB
                    </span>
                  </>
                ) : (
                  <div className="p-6 text-center space-y-1.5">
                    <div className="text-xs font-medium text-[var(--foreground)]">Foto Selfie Wajib Diambil</div>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Foto otomatis dikompres (maks. 480px JPEG ~20–35 KB) agar hemat penyimpanan.
                    </p>
                  </div>
                )}
              </div>

              {cameraError && <p className="text-xs text-[var(--warning)]">{cameraError}</p>}

              <div className="flex flex-wrap items-center gap-2">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex-1 py-2 px-3 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-semibold hover:opacity-90 cursor-pointer"
                  >
                    {photoDataUrl ? 'Buka Kamera Ulang' : 'Buka Kamera Selfie'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={captureFromCamera}
                      className="flex-1 py-2 px-3 rounded-lg bg-[var(--success)] text-white text-xs font-semibold hover:opacity-90 cursor-pointer"
                    >
                      Ambil Foto Selfie
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="py-2 px-3 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium cursor-pointer"
                    >
                      Tutup
                    </button>
                  </>
                )}

                <label className="py-2 px-3 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-xs font-medium cursor-pointer">
                  <span>Kamera HP / File</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handleFileFallback}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Right: Form */}
            <div className="lg:col-span-7 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Outlet Absensi</label>
                  <div className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold">
                    {outletMap.get(clockOutletId)?.name || clockOutletId}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Shift Bertugas</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 1 as const, label: 'Shift 1', sub: 'Pagi' },
                        { id: 2 as const, label: 'Shift 2', sub: 'Sore' },
                        { id: 3 as const, label: 'Full Shift', sub: 'Seharian' },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setClockShift(s.id)}
                        className={`py-2 px-2 rounded-lg border text-xs font-medium cursor-pointer leading-tight ${
                          clockShift === s.id
                            ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)] font-semibold'
                            : 'bg-[var(--background)] border-[var(--border)] hover:bg-[var(--secondary)]'
                        }`}
                      >
                        <div>{s.label}</div>
                        <div className="text-[10px] opacity-80">{s.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">Nama Karyawan</label>
                  <select
                    value={clockEmpId}
                    onChange={(e) => {
                      setClockEmpId(e.target.value);
                      setClockPin('');
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
                  >
                    {employees.length === 0 && <option value="">Belum ada karyawan aktif</option>}
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} — {e.roleTitle} ({e.payType === 'daily' ? 'Part-Time' : 'Bulanan'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-[var(--muted-foreground)] block">PIN Pribadi Karyawan</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={clockPin}
                    onChange={(e) => setClockPin(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="••••"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-semibold tracking-widest tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[var(--muted-foreground)] block">Catatan (opsional)</label>
                <input
                  type="text"
                  value={clockNote}
                  onChange={(e) => setClockNote(e.target.value)}
                  placeholder="Misal: Tukar shift, lembur persiapan event, dll."
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs"
                />
              </div>

              {activeOpenForSelected && (
                <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--primary)] text-xs">
                  <strong>{activeOpenForSelected.employeeName}</strong> sudah Absen Masuk{' '}
                  <strong>{formatAttendanceShiftLabel(activeOpenForSelected.shift)}</strong> pukul{' '}
                  <strong className="tabular-nums">{formatTimeWibFromIso(activeOpenForSelected.checkInAt)} WIB</strong>.
                  Silakan ambil selfie untuk <strong>Absen Pulang</strong>.
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={submitting || !photoDataUrl || !clockPin || !clockEmpId}
                  onClick={() => submitClock('check_in')}
                  className="py-3 px-4 rounded-lg bg-[var(--success)] text-white text-xs sm:text-sm font-semibold hover:opacity-90 disabled:opacity-45 cursor-pointer"
                >
                  {submitting ? 'Memproses...' : 'Absen MASUK'}
                </button>
                <button
                  type="button"
                  disabled={submitting || !photoDataUrl || !clockPin || !clockEmpId}
                  onClick={() => submitClock('check_out')}
                  className="py-3 px-4 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-xs sm:text-sm font-semibold hover:opacity-90 disabled:opacity-45 cursor-pointer"
                >
                  {submitting ? 'Memproses...' : 'Absen PULANG'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Attendance KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Hadir Tepat Waktu</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--success)] mt-1">{summary.hadir}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Catatan periode terpilih</p>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Terlambat</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--warning)] mt-1">{summary.telat}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Lewat toleransi {schedule.lateGraceMinutes} mnt</p>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Izin / Sakit / Alpha</p>
          <p className="text-lg font-semibold tabular-nums mt-1">
            {summary.izinSakit} <span className="text-xs font-normal text-[var(--muted-foreground)]">izin/sakit</span> ·{' '}
            <span className="text-[var(--error)]">{summary.alpha}</span>
          </p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Rekap ketidakhadiran</p>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3.5">
          <p className="text-xs text-[var(--muted-foreground)]">Total Lembur &amp; Full Shift</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--primary)] mt-1">{summary.overtimeHours} jam</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{summary.fullShift}x Full Shift tercatat</p>
        </div>
      </section>

      {/* Owner Per-Employee Recap Table */}
      {isOwner && perEmployeeRecap.length > 0 && (
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Rekap Absensi Per Karyawan</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Ringkasan jumlah hadir, keterlambatan, izin/sakit, alpha, dan total lembur pada periode terpilih.
            </p>
          </div>
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
            <table className="w-full min-w-[600px] text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="py-2 pr-3 font-medium">Karyawan</th>
                  <th className="py-2 px-2 font-medium">Skema</th>
                  <th className="py-2 px-2 font-medium text-right">Hadir Tepat</th>
                  <th className="py-2 px-2 font-medium text-right">Telat</th>
                  <th className="py-2 px-2 font-medium text-right">Full Shift</th>
                  <th className="py-2 px-2 font-medium text-right">Izin / Sakit</th>
                  <th className="py-2 px-2 font-medium text-right">Alpha</th>
                  <th className="py-2 pl-2 font-medium text-right">Lembur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                {perEmployeeRecap.map((r) => (
                  <tr key={r.employeeId} className="hover:bg-[var(--background)]">
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <span className="font-semibold">{r.name}</span>
                      <span className="text-[var(--muted-foreground)]"> · {r.roleTitle}</span>
                    </td>
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      {r.payType === 'daily' ? 'Part-Time Harian' : 'Bulanan'}
                    </td>
                    <td className="py-2.5 px-2 text-right font-semibold text-[var(--success)]">{r.hadir}</td>
                    <td className="py-2.5 px-2 text-right text-[var(--warning)]">
                      {r.telat > 0 ? `${r.telat}x (${r.lateMinutes} mnt)` : '0'}
                    </td>
                    <td className="py-2.5 px-2 text-right font-semibold text-[var(--primary)]">
                      {r.fullShift > 0 ? `${r.fullShift}x` : '-'}
                    </td>
                    <td className="py-2.5 px-2 text-right">{r.izinSakit}</td>
                    <td className="py-2.5 px-2 text-right text-[var(--error)]">{r.alpha}</td>
                    <td className="py-2.5 pl-2 text-right font-medium text-[var(--primary)]">
                      {Math.round((r.overtimeMinutes / 60) * 10) / 10} jam
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Attendance History Table */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--card-border)]">
          <div>
            <h3 className="text-sm font-semibold">
              {isCrew ? 'Riwayat Absensi & Bukti Foto Saya' : 'Riwayat & Foto Selfie Absensi'}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Klik thumbnail foto selfie untuk memperbesar bukti kehadiran.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <select
                value={filterOutlet}
                onChange={(e) => setFilterOutlet(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
              >
                <option value="all">Semua Outlet</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={filterRange}
              onChange={(e) => setFilterRange(e.target.value as 'today' | '7days' | '30days')}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs font-medium"
            >
              <option value="today">Hari Ini</option>
              <option value="7days">7 Hari Terakhir</option>
              <option value="30days">30 Hari Terakhir</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">Memuat data absensi...</div>
        ) : (
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
            <table className="w-full min-w-[600px] text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="py-2 pr-3 font-medium">Tanggal</th>
                  {!isCrew && <th className="py-2 px-2 font-medium">Karyawan</th>}
                  {(isOwner || isCrew) && <th className="py-2 px-2 font-medium">Outlet</th>}
                  <th className="py-2 px-2 font-medium">Shift</th>
                  <th className="py-2 px-2 font-medium">Masuk &amp; Foto</th>
                  <th className="py-2 px-2 font-medium">Pulang &amp; Foto</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium">Lembur</th>
                  {isOwner && <th className="py-2 pl-2 font-medium text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)] tabular-nums">
                {attendances.length === 0 ? (
                  <tr>
                    <td colSpan={isOwner ? 9 : 7} className="py-8 text-center text-[var(--muted-foreground)]">
                      Belum ada data absensi pada filter ini.
                    </td>
                  </tr>
                ) : (
                  attendances.map((a) => (
                    <tr key={a.id} className="hover:bg-[var(--background)]">
                      <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateIndo(a.date)}</td>
                      {!isCrew && (
                        <td className="py-2.5 px-2 font-medium whitespace-nowrap">
                          <div>{a.employeeName}</div>
                          {a.note && (
                            <div className="text-[11px] font-normal text-[var(--muted-foreground)]">{a.note}</div>
                          )}
                        </td>
                      )}
                      {(isOwner || isCrew) && (
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          {outletMap.get(a.outletId)?.name || a.outletId}
                        </td>
                      )}
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {a.shift === 3 ? (
                          <span className="px-2 py-0.5 rounded border border-[var(--primary)] text-[var(--primary)] font-semibold">
                            Full Shift
                          </span>
                        ) : (
                          <span>Shift {a.shift}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{formatTimeWibFromIso(a.checkInAt)}</span>
                          {a.checkInPhoto && (
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxPhoto({
                                  src: a.checkInPhoto!,
                                  caption: `Masuk · ${a.employeeName} · ${formatDateIndo(a.date)} ${formatTimeWibFromIso(a.checkInAt)} WIB`,
                                })
                              }
                              className="w-8 h-8 rounded overflow-hidden border border-[var(--border)] shrink-0 cursor-pointer"
                              title="Lihat foto masuk"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.checkInPhoto} alt="Masuk" className="w-full h-full object-cover" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{formatTimeWibFromIso(a.checkOutAt)}</span>
                          {a.checkOutPhoto && (
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxPhoto({
                                  src: a.checkOutPhoto!,
                                  caption: `Pulang · ${a.employeeName} · ${formatDateIndo(a.date)} ${formatTimeWibFromIso(a.checkOutAt)} WIB`,
                                })
                              }
                              className="w-8 h-8 rounded overflow-hidden border border-[var(--border)] shrink-0 cursor-pointer"
                              title="Lihat foto pulang"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.checkOutPhoto} alt="Pulang" className="w-full h-full object-cover" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {a.status === 'hadir' ? (
                          <span className="px-2 py-0.5 rounded border border-[var(--success)] text-[var(--success)] font-medium">
                            Hadir
                          </span>
                        ) : a.status === 'telat' ? (
                          <span className="px-2 py-0.5 rounded border border-[var(--warning)] text-[var(--warning)] font-medium">
                            Telat {a.lateMinutes} mnt
                          </span>
                        ) : a.status === 'alpha' ? (
                          <span className="px-2 py-0.5 rounded border border-[var(--error)] text-[var(--error)] font-medium">
                            Alpha
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--foreground)] font-medium capitalize">
                            {a.status}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {a.overtimeMinutes > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span>{a.overtimeMinutes} mnt</span>
                            {isOwner && (
                              <button
                                type="button"
                                onClick={() => handleClearOvertime(a)}
                                className="px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--secondary)] text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                                title="Tandai bukan lembur (telat absen pulang)"
                              >
                                Bukan Lembur
                              </button>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      {isOwner && (
                        <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleDeleteAttendance(a.id)}
                            className="px-2 py-1 rounded border border-[var(--border)] hover:text-[var(--error)] cursor-pointer"
                            title="Hapus absensi"
                          >
                            &times;
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Selfie Lightbox Modal */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-4 space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">{lightboxPhoto.caption}</span>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="text-xs px-2 py-1 rounded border border-[var(--border)] cursor-pointer"
              >
                Tutup
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxPhoto.src} alt={lightboxPhoto.caption} className="w-full rounded-lg border border-[var(--border)]" />
          </div>
        </div>
      )}
    </div>
  );
}

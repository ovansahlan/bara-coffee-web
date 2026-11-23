import { after, NextResponse } from 'next/server';
import { syncToGoogleSheets } from '@/lib/gsheets-sync';
import { getSession } from '@/lib/session';
import {
  deleteAttendanceById,
  fetchAttendances,
  recordAttendanceClock,
  upsertManualAttendance,
  verifyCrewPinForOutletSession,
} from '@/lib/hr-db';
import { getLocalDateStr } from '@/lib/calc';
import type { AttendanceShift, AttendanceStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_PHOTO_DATA_URL_LENGTH = 260_000; // ~180KB base64 cap for compressed selfie JPEG

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedOutlet = searchParams.get('outletId');
    const isOutletScoped = session.role === 'crew' || session.role === 'outlet';
    const outletId = isOutletScoped
      ? session.outletId!
      : requestedOutlet && requestedOutlet !== 'all'
        ? requestedOutlet
        : null;
    const employeeId = searchParams.get('employeeId') || null;
    const fromDate = searchParams.get('from') || getLocalDateStr(-6);
    const toDate = searchParams.get('to') || getLocalDateStr(0);

    const attendances = await fetchAttendances({
      outletId,
      employeeId,
      fromDate,
      toDate,
    });

    return NextResponse.json({
      today: getLocalDateStr(0),
      attendances,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat data absensi.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    if (session.role === 'owner') {
      return NextResponse.json(
        { error: 'Akun Owner hanya melihat rekap absensi (tidak melakukan absen masuk/pulang).' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const action = body?.action === 'check_out' ? 'check_out' : 'check_in';
    const employeeId = String(body?.employeeId || '').trim();
    const rawShift = Number(body?.shift);
    const shift: AttendanceShift = rawShift === 3 ? 3 : rawShift === 2 ? 2 : 1;
    const pin = String(body?.pin || '').trim();
    const photo = typeof body?.photo === 'string' ? body.photo.trim() : '';
    const note = String(body?.note || '').trim();

    if (!employeeId) {
      return NextResponse.json({ error: 'Pilih karyawan terlebih dahulu.' }, { status: 400 });
    }
    if (!photo || !photo.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Foto selfie absensi wajib diambil terlebih dahulu.' }, { status: 400 });
    }
    if (photo.length > MAX_PHOTO_DATA_URL_LENGTH) {
      return NextResponse.json(
        { error: 'Ukuran foto terlalu besar. Pastikan foto dikompres dengan benar.' },
        { status: 400 }
      );
    }

    // Shared-device anti-fraud: always require & verify employee's personal PIN on server
    const verified = await verifyCrewPinForOutletSession(session, employeeId, pin);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const record = await recordAttendanceClock({
      action,
      employeeId: verified.employee.id,
      outletId: verified.outletId,
      shift,
      photo,
      note,
    });

    after(() => syncToGoogleSheets({ force: false }));
    return NextResponse.json({ ok: true, attendance: record });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal mencatat absensi.' },
      { status: 400 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat mengubah data absensi manual.' }, { status: 403 });
    }

    const body = await req.json();
    const allowed: AttendanceStatus[] = ['hadir', 'telat', 'izin', 'sakit', 'alpha'];
    const status: AttendanceStatus = allowed.includes(body?.status) ? body.status : 'hadir';
    const employeeId = String(body?.employeeId || '').trim();
    const outletId = String(body?.outletId || '').trim();
    const date = String(body?.date || '').trim();
    const rawShift = Number(body?.shift);
    const shift: AttendanceShift = rawShift === 3 ? 3 : rawShift === 2 ? 2 : 1;

    if (!body?.id && (!employeeId || !outletId || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return NextResponse.json({ error: 'Data absensi manual belum lengkap.' }, { status: 400 });
    }

    await upsertManualAttendance({
      id: typeof body?.id === 'string' && body.id ? body.id : undefined,
      employeeId,
      outletId,
      date,
      shift,
      status,
      lateMinutes: body?.lateMinutes,
      overtimeMinutes: body?.overtimeMinutes,
      note: typeof body?.note === 'string' ? body.note : undefined,
    });

    after(() => syncToGoogleSheets({ force: false }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memperbarui absensi.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat menghapus data absensi.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'ID absensi tidak valid.' }, { status: 400 });

    await deleteAttendanceById(id);
    after(() => syncToGoogleSheets({ force: false }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus absensi.' },
      { status: 500 }
    );
  }
}

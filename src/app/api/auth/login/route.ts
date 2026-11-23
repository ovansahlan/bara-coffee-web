import { NextResponse } from 'next/server';
import { getStorageMode, isStorageConfigured } from '@/lib/supabase';
import { getAppSettings, getOutletById } from '@/lib/db';
import { getEmployeeById } from '@/lib/hr-db';
import { safeComparePin, setSessionCookie } from '@/lib/session';

export async function POST(req: Request) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'Penyimpanan database belum dikonfigurasi.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const role = body?.role === 'owner' ? 'owner' : body?.role === 'crew' ? 'crew' : 'outlet';
    const pin = String(body?.pin || '').trim();
    const outletId = typeof body?.outletId === 'string' ? body.outletId : null;
    const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : null;

    if (!pin) {
      return NextResponse.json({ error: 'PIN wajib diisi.' }, { status: 400 });
    }

    if (role === 'owner') {
      const settings = await getAppSettings();
      if (!safeComparePin(pin, settings.ownerPin)) {
        return NextResponse.json({ error: 'PIN Owner salah.' }, { status: 401 });
      }
      await setSessionCookie({ role: 'owner', outletId: null, employeeId: null });
      return NextResponse.json({ ok: true, role: 'owner', outletId: null, storageMode: getStorageMode() });
    }

    if (role === 'crew') {
      if (!employeeId) {
        return NextResponse.json({ error: 'Nama kru belum dipilih.' }, { status: 400 });
      }
      const emp = await getEmployeeById(employeeId);
      if (!emp || !emp.active) {
        return NextResponse.json({ error: 'Akun kru tidak ditemukan atau sudah nonaktif.' }, { status: 404 });
      }
      const targetOutletId = outletId || (emp.outletId !== 'all' ? emp.outletId : null);
      if (!targetOutletId) {
        return NextResponse.json({ error: 'Pilih outlet terlebih dahulu.' }, { status: 400 });
      }
      const outlet = await getOutletById(targetOutletId);
      if (!outlet) {
        return NextResponse.json({ error: 'Outlet tidak ditemukan.' }, { status: 404 });
      }
      if (emp.outletId !== 'all' && emp.outletId !== outlet.id) {
        return NextResponse.json(
          { error: `Akun ${emp.name} tidak terdaftar di ${outlet.name}.` },
          { status: 403 }
        );
      }
      if (!safeComparePin(pin, emp.pin)) {
        return NextResponse.json({ error: `PIN pribadi ${emp.name} salah.` }, { status: 401 });
      }
      await setSessionCookie({ role: 'crew', outletId: outlet.id, employeeId: emp.id });
      return NextResponse.json({
        ok: true,
        role: 'crew',
        outletId: outlet.id,
        employeeId: emp.id,
        storageMode: getStorageMode(),
      });
    }

    if (!outletId) {
      return NextResponse.json({ error: 'Outlet belum dipilih.' }, { status: 400 });
    }

    const outlet = await getOutletById(outletId);
    if (!outlet) {
      return NextResponse.json({ error: 'Outlet tidak ditemukan.' }, { status: 404 });
    }

    if (!safeComparePin(pin, outlet.pin)) {
      return NextResponse.json({ error: `PIN ${outlet.name} salah.` }, { status: 401 });
    }

    await setSessionCookie({ role: 'outlet', outletId: outlet.id, employeeId: null });
    return NextResponse.json({ ok: true, role: 'outlet', outletId: outlet.id, storageMode: getStorageMode() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memproses login.' },
      { status: 500 }
    );
  }
}

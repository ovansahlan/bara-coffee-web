import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  deleteEmployeeById,
  getEmployeesAdmin,
  getEmployeesPublic,
  upsertEmployee,
} from '@/lib/hr-db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    if (session.role === 'owner' && searchParams.get('admin') === '1') {
      const employees = await getEmployeesAdmin();
      return NextResponse.json({ employees });
    }

    const outletId = session.role === 'outlet' || session.role === 'crew' ? session.outletId : searchParams.get('outletId');
    const employees = await getEmployeesPublic(outletId && outletId !== 'all' ? outletId : null);
    return NextResponse.json({ employees });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat daftar karyawan.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat mengelola data karyawan.' }, { status: 403 });
    }

    const body = await req.json();
    const id = String(body?.id || `emp-${Date.now()}`);
    const name = String(body?.name || '').trim();
    const roleTitle = String(body?.roleTitle || 'Barista').trim() || 'Barista';
    const outletId = String(body?.outletId || 'all').trim() || 'all';
    const payType = body?.payType === 'daily' ? 'daily' : 'monthly';
    const pin = String(body?.pin || '').replace(/[^0-9]/g, '');

    if (!name) return NextResponse.json({ error: 'Nama karyawan wajib diisi.' }, { status: 400 });
    if (pin.length < 4) return NextResponse.json({ error: 'PIN pribadi karyawan minimal 4 digit angka.' }, { status: 400 });

    const toNum = (v: unknown) => {
      const n = Number(v || 0);
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    };

    await upsertEmployee({
      id,
      name,
      roleTitle,
      outletId,
      payType,
      pin,
      baseSalary: toNum(body?.baseSalary),
      dailyRate: toNum(body?.dailyRate),
      mealAllowance: toNum(body?.mealAllowance),
      overtimeRatePerHour: toNum(body?.overtimeRatePerHour),
      latePenalty: toNum(body?.latePenalty),
      kasbonLimit: toNum(body?.kasbonLimit),
      active: body?.active !== false,
    });

    const employees = await getEmployeesAdmin();
    return NextResponse.json({ ok: true, employees });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menyimpan data karyawan.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat menghapus karyawan.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'ID karyawan tidak valid.' }, { status: 400 });

    await deleteEmployeeById(id);
    const employees = await getEmployeesAdmin();
    return NextResponse.json({ ok: true, employees });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus karyawan.' },
      { status: 500 }
    );
  }
}

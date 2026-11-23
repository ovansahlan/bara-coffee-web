import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  addCashDropToShift,
  cascadeRunningBalancesInDb,
  fetchSingleHydratedShift,
} from '@/lib/db';
import { makeShiftId } from '@/lib/calc';
import { resolveOutletAccessForSession } from '@/lib/hr-db';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    const body = await req.json();
    const access = await resolveOutletAccessForSession(session, String(body?.outletId || ''));
    if (!access.allowed) {
      return NextResponse.json({ error: access.error || 'Akses ditolak.' }, { status: 403 });
    }
    const outletId = access.outletId || '';
    const date = String(body?.date || '');
    const shiftNum = Number(body?.shift) === 2 ? 2 : 1;
    const method = String(body?.method || 'Tunai ke Owner').trim() || 'Tunai ke Owner';
    const note = String(body?.note || '').trim();
    const amount = Math.round(Number(body?.amount || 0));

    if (!outletId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Nominal setoran harus lebih dari Rp 0.' }, { status: 400 });
    }

    const shiftId = makeShiftId(outletId, date, shiftNum);
    const existingShift = await fetchSingleHydratedShift(outletId, date, shiftNum);
    if (existingShift?.balanceChecked) {
      return NextResponse.json(
        { error: 'Shift sudah terkunci. Perubahan setoran wajib disimpan melalui Mode Koreksi Shift.' },
        { status: 423 }
      );
    }

    await addCashDropToShift({
      shiftId,
      outletId,
      date,
      shift: shiftNum,
      cashier: String(body?.cashier || '').trim(),
      method,
      note,
      amount,
      existingShift,
    });

    const cascaded = await cascadeRunningBalancesInDb(outletId, { includeCorrections: true });
    const updatedShift = cascaded.find((s) => s.id === shiftId) || null;
    return NextResponse.json({ ok: true, shift: updatedShift });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menambah setoran ke Owner/Bank.' },
      { status: 500 }
    );
  }
}

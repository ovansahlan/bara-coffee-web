import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  addExpenseToShift,
  cascadeRunningBalancesInDb,
  fetchHydratedShifts,
  fetchSingleHydratedShift,
} from '@/lib/db';
import { findDuplicateExpenseInList, makeShiftId } from '@/lib/calc';
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
    const desc = String(body?.desc || '').trim();
    const category = String(body?.category || 'Lain-Lain').trim() || 'Lain-Lain';
    const amount = Math.round(Number(body?.amount || 0));
    const forceDuplicate = Boolean(body?.forceDuplicate);

    if (!outletId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !desc || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Data pengeluaran belum lengkap atau nominal tidak valid.' }, { status: 400 });
    }

    const shiftId = makeShiftId(outletId, date, shiftNum);
    const existingShift = await fetchSingleHydratedShift(outletId, date, shiftNum);
    if (existingShift?.balanceChecked) {
      return NextResponse.json(
        { error: 'Shift sudah terkunci. Perubahan pengeluaran wajib disimpan melalui Mode Koreksi Shift.' },
        { status: 423 }
      );
    }

    // Server-side cross-shift duplicate check across Shift 1 & Shift 2 on same outlet & date
    if (!forceDuplicate) {
      const todayShifts = await fetchHydratedShifts({ outletId, fromDate: date, toDate: date });
      const todayExpenses = todayShifts.flatMap((s) =>
        s.expenses.map((e) => ({ ...e, cashier: s.cashier }))
      );
      const dup = findDuplicateExpenseInList(todayExpenses, desc, category, amount);
      if (dup) {
        return NextResponse.json(
          {
            duplicateDetected: true,
            duplicate: dup,
            message: 'Pengeluaran serupa sudah tercatat hari ini.',
          },
          { status: 409 }
        );
      }
    }

    await addExpenseToShift({
      shiftId,
      outletId,
      date,
      shift: shiftNum,
      cashier: String(body?.cashier || '').trim(),
      desc,
      category,
      amount,
      existingShift,
    });

    await cascadeRunningBalancesInDb(outletId);
    const updatedShift = await fetchSingleHydratedShift(outletId, date, shiftNum);
    return NextResponse.json({ ok: true, shift: updatedShift });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menambah pengeluaran.' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchHydratedShifts, getOutletsPublic } from '@/lib/db';
import { fetchOwnerExpenses } from '@/lib/hr-db';
import { calcShiftMetrics, getLocalDateStr, makeShiftId } from '@/lib/calc';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Akses khusus Dashboard Owner.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const outletFilter = searchParams.get('outletId') || 'all';
    const range = searchParams.get('range') || '7days';

    const today = getLocalDateStr(0);
    const fromDate =
      range === 'today'
        ? today
        : range === '7days'
          ? getLocalDateStr(-6)
          : range === '30days'
            ? getLocalDateStr(-29)
            : null;

    const [outlets, allShifts, ownerExpenses] = await Promise.all([
      getOutletsPublic(),
      fetchHydratedShifts({}),
      fetchOwnerExpenses({
        fromDate: fromDate || undefined,
        outletId: outletFilter !== 'all' ? outletFilter : undefined,
      }).catch(() => []),
    ]);

    // Build today's live cards per outlet + continuous running cash balance
    const shiftById = new Map(allShifts.map((s) => [s.id, s]));
    const todayCards = outlets.map((o) => {
      const s1 = shiftById.get(makeShiftId(o.id, today, 1)) || null;
      const s2 = shiftById.get(makeShiftId(o.id, today, 2)) || null;
      const m1 = s1 ? calcShiftMetrics(s1) : null;
      const m2 = s2 ? calcShiftMetrics(s2) : null;

      // Chronologically latest shift for running cash balance
      const outletShifts = allShifts.filter((s) => s.outletId === o.id);
      const latestCash = outletShifts.length > 0 ? calcShiftMetrics(outletShifts[0]).closingCash : o.defaultOpeningCash;

      return {
        outlet: o,
        omsetToday: (m1?.totalOmset || 0) + (m2?.totalOmset || 0),
        expenseToday: (m1?.totalExpense || 0) + (m2?.totalExpense || 0),
        runningCash: latestCash,
        shift1Status: m1 ? m1.status : 'none',
        shift1Diff: m1?.diff ?? null,
        shift2Status: m2 ? m2.status : 'none',
        shift2Diff: m2?.diff ?? null,
        suggestedShift: s1 && !s2 ? 2 : 1,
      };
    });

    const filteredShifts = allShifts.filter((s) => {
      if (outletFilter !== 'all' && s.outletId !== outletFilter) return false;
      if (fromDate && s.date < fromDate) return false;
      return true;
    });

    return NextResponse.json({
      today,
      outlets,
      todayCards,
      shifts: filteredShifts,
      ownerExpenses,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat Dashboard Owner.' },
      { status: 500 }
    );
  }
}

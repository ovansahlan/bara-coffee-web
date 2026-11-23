import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchCashAdvances, verifyCrewPinForOutletSession } from '@/lib/hr-db';
import { getLocalDateStr } from '@/lib/calc';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }
    if (session.role === 'owner') {
      return NextResponse.json({ error: 'Owner melihat rekap kasbon lewat GET /api/cash-advances.' }, { status: 400 });
    }

    const body = await req.json();
    const employeeId = String(body?.employeeId || '').trim();
    const pin = String(body?.pin || '').trim();

    const verified = await verifyCrewPinForOutletSession(session, employeeId, pin);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const emp = verified.employee;
    const advances = await fetchCashAdvances({ employeeId: emp.id });
    const activeKasbons = advances.filter((a) => a.type !== 'loan' && a.remainingAmount > 0);
    const activeLoans = advances.filter((a) => a.type === 'loan' && a.remainingAmount > 0);
    const kasbonRemaining = activeKasbons.reduce((s, a) => s + a.remainingAmount, 0);
    const loanRemaining = activeLoans.reduce((s, a) => s + a.remainingAmount, 0);
    const monthlyInstallmentDue = activeLoans.reduce((s, a) => {
      const inst = a.installmentAmount && a.installmentAmount > 0 ? a.installmentAmount : a.remainingAmount;
      return s + Math.min(a.remainingAmount, inst);
    }, 0);
    const totalRemaining = kasbonRemaining + loanRemaining;
    const totalTaken = advances.reduce((s, a) => s + a.amount, 0);

    return NextResponse.json({
      ok: true,
      today: getLocalDateStr(0),
      employee: {
        id: emp.id,
        name: emp.name,
        roleTitle: emp.roleTitle,
        outletId: emp.outletId,
        payType: emp.payType,
        active: emp.active,
      },
      summary: {
        employeeId: emp.id,
        employeeName: emp.name,
        roleTitle: emp.roleTitle,
        outletId: emp.outletId,
        payType: emp.payType,
        kasbonLimit: emp.kasbonLimit,
        totalTaken,
        kasbonRemaining,
        loanRemaining,
        monthlyInstallmentDue,
        totalRemaining,
        activeCount: activeKasbons.length + activeLoans.length,
        activeLoanCount: activeLoans.length,
      },
      advances,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal membuka data kasbon.' },
      { status: 500 }
    );
  }
}

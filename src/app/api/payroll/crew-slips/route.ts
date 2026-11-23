import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchPayrolls, verifyCrewPinForOutletSession } from '@/lib/hr-db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }
    if (session.role === 'owner') {
      return NextResponse.json({ error: 'Owner melihat payroll lewat GET /api/payroll.' }, { status: 400 });
    }

    const body = await req.json();
    const employeeId = String(body?.employeeId || '').trim();
    const pin = String(body?.pin || '').trim();

    const verified = await verifyCrewPinForOutletSession(session, employeeId, pin);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const emp = verified.employee;
    const payrolls = await fetchPayrolls();
    const slips = payrolls
      .filter((p) => p.status === 'paid')
      .map((p) => {
        const mine = p.items.find((it) => it.employeeId === emp.id);
        if (!mine) return null;
        return {
          payrollId: p.id,
          periodLabel: p.periodLabel,
          fromDate: p.fromDate,
          toDate: p.toDate,
          paidAt: p.paidAt,
          item: mine,
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      employee: {
        id: emp.id,
        name: emp.name,
        roleTitle: emp.roleTitle,
        outletId: emp.outletId,
        payType: emp.payType,
        active: emp.active,
      },
      slips,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal membuka slip gaji.' },
      { status: 500 }
    );
  }
}

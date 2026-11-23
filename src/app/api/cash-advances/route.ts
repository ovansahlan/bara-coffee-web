import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  addCashAdvanceRepayment,
  createCashAdvance,
  deleteCashAdvanceById,
  fetchCashAdvances,
  getEmployeeById,
  getEmployeesAdmin,
  verifyCrewPinForOutletSession,
} from '@/lib/hr-db';
import { getOutletsAdmin } from '@/lib/db';
import { getLocalDateStr } from '@/lib/calc';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }
    if (session.role !== 'owner') {
      return NextResponse.json(
        { error: 'Data kasbon dilindungi PIN. Buka melalui verifikasi PIN pribadi.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const requestedOutlet = searchParams.get('outletId');
    const outletId = requestedOutlet && requestedOutlet !== 'all' ? requestedOutlet : null;
    const employeeId = searchParams.get('employeeId') || null;

    const [advances, allEmployees] = await Promise.all([
      fetchCashAdvances({ outletId, employeeId }),
      getEmployeesAdmin(),
    ]);

    const visibleEmployees = allEmployees.filter(
      (e) => !outletId || e.outletId === 'all' || e.outletId === outletId
    );

    const allAdvances = outletId ? await fetchCashAdvances({}) : advances;
    const summaryByEmployee = visibleEmployees.map((e) => {
      const empAdvs = allAdvances.filter((a) => a.employeeId === e.id);
      const activeKasbons = empAdvs.filter((a) => a.type !== 'loan' && a.remainingAmount > 0);
      const activeLoans = empAdvs.filter((a) => a.type === 'loan' && a.remainingAmount > 0);
      const kasbonRemaining = activeKasbons.reduce((s, a) => s + a.remainingAmount, 0);
      const loanRemaining = activeLoans.reduce((s, a) => s + a.remainingAmount, 0);
      const monthlyInstallmentDue = activeLoans.reduce((s, a) => {
        const inst = a.installmentAmount && a.installmentAmount > 0 ? a.installmentAmount : a.remainingAmount;
        return s + Math.min(a.remainingAmount, inst);
      }, 0);
      const totalRemaining = kasbonRemaining + loanRemaining;
      const totalTaken = empAdvs.reduce((s, a) => s + a.amount, 0);
      return {
        employeeId: e.id,
        employeeName: e.name,
        roleTitle: e.roleTitle,
        outletId: e.outletId,
        payType: e.payType,
        kasbonLimit: e.kasbonLimit,
        totalTaken,
        kasbonRemaining,
        loanRemaining,
        monthlyInstallmentDue,
        totalRemaining,
        activeCount: activeKasbons.length + activeLoans.length,
        activeLoanCount: activeLoans.length,
      };
    });

    return NextResponse.json({
      today: getLocalDateStr(0),
      advances,
      summaryByEmployee,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat data kasbon.' },
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

    const body = await req.json();

    // Owner creates Installment Loans ("Pinjaman Berjangka Dicicil")
    if (session.role === 'owner') {
      if (body?.type !== 'loan') {
        return NextResponse.json(
          {
            error:
              'Kasbon harian diinput dari outlet dengan verifikasi PIN kru; Owner hanya mencatat Pinjaman Berjangka dicicil.',
          },
          { status: 403 }
        );
      }

      const employeeId = String(body?.employeeId || '').trim();
      const date = String(body?.date || getLocalDateStr(0)).trim();
      const amount = Math.max(0, Math.round(Number(body?.amount || 0)));
      const tenorMonths = Math.max(2, Math.round(Number(body?.tenorMonths || 12)));
      const installmentAmount = Math.max(
        0,
        Math.round(Number(body?.installmentAmount || 0)) || Math.ceil(amount / tenorMonths)
      );
      const note = String(body?.note || '').trim() || `Pinjaman berjangka (${tenorMonths} bulan)`;

      if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: 'Karyawan dan tanggal pencairan wajib diisi.' }, { status: 400 });
      }
      if (amount <= 0) {
        return NextResponse.json({ error: 'Nominal pinjaman harus lebih dari Rp 0.' }, { status: 400 });
      }

      const employee = await getEmployeeById(employeeId);
      if (!employee || !employee.active) {
        return NextResponse.json({ error: 'Karyawan tidak ditemukan atau sudah nonaktif.' }, { status: 404 });
      }

      const outlets = await getOutletsAdmin();
      const outletId =
        employee.outletId && employee.outletId !== 'all'
          ? employee.outletId
          : String(body?.outletId || outlets[0]?.id || 'outlet-1');

      const advance = await createCashAdvance({
        employeeId: employee.id,
        outletId,
        date,
        shift: 1,
        drawerAmount: 0,
        ownerTransferAmount: amount,
        type: 'loan',
        tenorMonths,
        installmentAmount,
        note,
        createdBy: 'Owner',
      });

      return NextResponse.json({ ok: true, advance });
    }

    const employeeId = String(body?.employeeId || '').trim();
    const pin = String(body?.pin || '').trim();
    const date = String(body?.date || getLocalDateStr(0)).trim();
    const shift = Number(body?.shift) === 2 ? 2 : 1;
    const drawerAmount = Math.max(0, Math.round(Number(body?.drawerAmount || 0)));
    const ownerTransferAmount = Math.max(0, Math.round(Number(body?.ownerTransferAmount || 0)));
    const note = String(body?.note || '').trim();
    const forceOverLimit = Boolean(body?.forceOverLimit);

    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Karyawan dan tanggal wajib diisi.' }, { status: 400 });
    }
    const total = drawerAmount + ownerTransferAmount;
    if (total <= 0) {
      return NextResponse.json({ error: 'Isi nominal kasbon dari Laci Kasir dan/atau Transfer Owner.' }, { status: 400 });
    }

    // Shared-device anti-fraud: always verify employee personal PIN on server
    const verified = await verifyCrewPinForOutletSession(session, employeeId, pin);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: verified.status });
    }

    const { employee, outletId } = verified;

    // Limit warning check (applies to short-term regular kasbon; installment loans are approved separately)
    if (employee.kasbonLimit > 0 && !forceOverLimit) {
      const existingAdvs = await fetchCashAdvances({ employeeId: employee.id });
      const currentRemaining = existingAdvs
        .filter((a) => a.type !== 'loan')
        .reduce((s, a) => s + a.remainingAmount, 0);
      if (currentRemaining + total > employee.kasbonLimit) {
        return NextResponse.json(
          {
            limitExceeded: true,
            currentRemaining,
            limit: employee.kasbonLimit,
            error: `Total kasbon aktif ${employee.name} akan menjadi Rp ${(currentRemaining + total).toLocaleString('id-ID')}, melebihi batas Rp ${employee.kasbonLimit.toLocaleString('id-ID')}.`,
          },
          { status: 409 }
        );
      }
    }

    const advance = await createCashAdvance({
      employeeId: employee.id,
      outletId,
      date,
      shift,
      drawerAmount,
      ownerTransferAmount,
      type: 'kasbon',
      tenorMonths: 1,
      installmentAmount: 0,
      note,
      createdBy: employee.name,
    });

    return NextResponse.json({ ok: true, advance });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal mencatat kasbon.' },
      { status: 400 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat mencatat pelunasan kasbon manual.' }, { status: 403 });
    }

    const body = await req.json();
    const cashAdvanceId = String(body?.cashAdvanceId || '').trim();
    const amount = Math.max(0, Math.round(Number(body?.amount || 0)));
    const method = body?.method === 'transfer_return' ? 'transfer_return' : 'cash_return';
    const note = String(body?.note || '').trim() || 'Pelunasan manual';

    if (!cashAdvanceId || amount <= 0) {
      return NextResponse.json({ error: 'Data pelunasan kasbon tidak valid.' }, { status: 400 });
    }

    await addCashAdvanceRepayment({
      cashAdvanceId,
      amount,
      method,
      note,
      date: typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : getLocalDateStr(0),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal mencatat pelunasan kasbon.' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat menghapus data kasbon.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'ID kasbon tidak valid.' }, { status: 400 });

    await deleteCashAdvanceById(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus kasbon.' },
      { status: 400 }
    );
  }
}

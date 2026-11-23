import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  applyEmployeeKasbonDeductionFIFO,
  buildPayrollPreviewItems,
  deletePayrollRunById,
  fetchPayrolls,
  savePayrollRun,
} from '@/lib/hr-db';
import { getLocalDateStr } from '@/lib/calc';
import type { PayrollItemRecord, PayrollRunRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    if (session.role !== 'owner') {
      return NextResponse.json(
        { error: 'Slip gaji pribadi wajib dibuka melalui verifikasi PIN.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode');

    if (mode === 'preview') {
      const fromDate = String(searchParams.get('from') || '');
      const toDate = String(searchParams.get('to') || '');
      const outletId = searchParams.get('outletId') || 'all';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
        return NextResponse.json({ error: 'Rentang tanggal periode tidak valid.' }, { status: 400 });
      }
      const items = await buildPayrollPreviewItems({ fromDate, toDate, outletId });
      return NextResponse.json({ items });
    }

    const payrolls = await fetchPayrolls();
    return NextResponse.json({ payrolls });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat data payroll.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Akses khusus Owner untuk Payroll.' }, { status: 403 });
    }

    const body = await req.json();
    const id = String(body?.id || `pay-${Date.now()}`);
    const periodLabel = String(body?.periodLabel || '').trim();
    const fromDate = String(body?.fromDate || '').trim();
    const toDate = String(body?.toDate || '').trim();
    const outletId = String(body?.outletId || 'all').trim() || 'all';
    const finalize = Boolean(body?.finalize);

    if (!periodLabel || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return NextResponse.json({ error: 'Label periode dan rentang tanggal wajib diisi.' }, { status: 400 });
    }

    const existingList = await fetchPayrolls();
    const existing = existingList.find((p) => p.id === id);
    if (existing?.status === 'paid') {
      return NextResponse.json({ error: 'Payroll ini sudah difinalisasi & dibayar.' }, { status: 400 });
    }

    const rawItems = Array.isArray(body?.items) ? (body.items as PayrollItemRecord[]) : [];
    if (rawItems.length === 0) {
      return NextResponse.json({ error: 'Daftar karyawan payroll kosong.' }, { status: 400 });
    }

    const toNum = (v: unknown) => {
      const n = Number(v || 0);
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    };

    const items: PayrollItemRecord[] = rawItems.map((it) => {
      const basePay = toNum(it.basePay);
      const mealTotal = toNum(it.mealTotal);
      const overtimePay = toNum(it.overtimePay);
      const bonus = toNum(it.bonus);
      const lateDeduction = toNum(it.lateDeduction);
      const kasbonDeduction = toNum(it.kasbonDeduction);
      const otherDeduction = toNum(it.otherDeduction);
      const grossPay = basePay + mealTotal + overtimePay + bonus;
      const netPay = Math.max(0, grossPay - lateDeduction - kasbonDeduction - otherDeduction);

      return {
        employeeId: String(it.employeeId),
        employeeName: String(it.employeeName || ''),
        roleTitle: String(it.roleTitle || ''),
        outletId: String(it.outletId || 'all'),
        payType: it.payType === 'daily' ? 'daily' : 'monthly',
        daysPresent: toNum(it.daysPresent),
        ...(it.fullShiftCount !== undefined ? { fullShiftCount: toNum(it.fullShiftCount) } : {}),
        lateCount: toNum(it.lateCount),
        absentCount: toNum(it.absentCount),
        overtimeHours: Math.max(0, Number(it.overtimeHours || 0)),
        basePay,
        mealTotal,
        overtimePay,
        bonus,
        lateDeduction,
        kasbonDeduction,
        ...(it.suggestedKasbonDeduction !== undefined
          ? { suggestedKasbonDeduction: toNum(it.suggestedKasbonDeduction) }
          : {}),
        otherDeduction,
        grossPay,
        netPay,
        activeKasbonBefore: toNum(it.activeKasbonBefore),
        note: String(it.note || '').trim(),
      };
    });

    const totalGross = items.reduce((s, i) => s + i.grossPay, 0);
    const totalKasbonDeducted = items.reduce((s, i) => s + i.kasbonDeduction, 0);
    const totalNet = items.reduce((s, i) => s + i.netPay, 0);
    const nowIso = new Date().toISOString();

    const run: PayrollRunRecord = {
      id,
      periodLabel,
      fromDate,
      toDate,
      outletId,
      status: finalize ? 'paid' : 'draft',
      items,
      totalGross,
      totalKasbonDeducted,
      totalNet,
      createdAt: existing?.createdAt || nowIso,
      paidAt: finalize ? nowIso : null,
    };

    await savePayrollRun(run);

    // When finalized & paid, automatically deduct kasbon FIFO for each employee
    if (finalize) {
      const today = getLocalDateStr(0);
      for (const item of items) {
        if (item.kasbonDeduction > 0) {
          await applyEmployeeKasbonDeductionFIFO({
            employeeId: item.employeeId,
            totalDeduction: item.kasbonDeduction,
            payrollRunId: run.id,
            periodLabel: run.periodLabel,
            date: today,
          });
        }
      }
    }

    const payrolls = await fetchPayrolls();
    return NextResponse.json({ ok: true, payroll: run, payrolls });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menyimpan payroll.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Akses khusus Owner.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'ID payroll tidak valid.' }, { status: 400 });

    await deletePayrollRunById(id);
    const payrolls = await fetchPayrolls();
    return NextResponse.json({ ok: true, payrolls });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus draft payroll.' },
      { status: 400 }
    );
  }
}

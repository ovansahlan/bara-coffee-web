import crypto from 'crypto';
import { getSupabaseAdmin } from './supabase';
import { isLocalDbEnabled, readLocalDb, writeLocalDb } from './local-db';
import { safeComparePin } from './session';
import {
  computeAttendanceTiming,
  getCurrentTimeWib,
  getLocalDateStr,
  makeShiftId,
} from './calc';
import {
  cascadeRunningBalancesInDb,
  fetchSingleHydratedShift,
  getAppSettings,
  getPreviousBalanceForShift,
} from './db';
import type {
  AttendanceRecord,
  AttendanceShift,
  AttendanceStatus,
  CashAdvanceRecord,
  CashAdvanceRepayment,
  CashAdvanceSource,
  CashAdvanceStatus,
  CashAdvanceType,
  EmployeeAdmin,
  EmployeePublic,
  OwnerExpenseRecord,
  PayrollItemRecord,
  PayrollRunRecord,
  SessionPayload,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============================================================
// EMPLOYEES
// ============================================================

export async function getEmployeesAdmin(): Promise<EmployeeAdmin[]> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    return [...local.employees]
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      .map((e) => ({ ...e }));
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('employees')
    .select('*')
    .order('active', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);

  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    roleTitle: r.role_title || 'Barista',
    outletId: r.outlet_id || 'all',
    payType: r.pay_type === 'daily' ? 'daily' : 'monthly',
    pin: String(r.pin || '1000'),
    baseSalary: Number(r.base_salary || 0),
    dailyRate: Number(r.daily_rate || 0),
    mealAllowance: Number(r.meal_allowance || 0),
    overtimeRatePerHour: Number(r.overtime_rate_per_hour || 0),
    latePenalty: Number(r.late_penalty || 0),
    kasbonLimit: Number(r.kasbon_limit || 0),
    active: r.active !== false,
  }));
}

export async function getEmployeesPublic(outletId?: string | null): Promise<EmployeePublic[]> {
  const all = await getEmployeesAdmin();
  return all
    .filter((e) => e.active && (!outletId || e.outletId === 'all' || e.outletId === outletId))
    .map(({ id, name, roleTitle, outletId: oid, payType, active }) => ({
      id,
      name,
      roleTitle,
      outletId: oid,
      payType,
      active,
    }));
}

export async function getEmployeeById(id: string): Promise<EmployeeAdmin | null> {
  const all = await getEmployeesAdmin();
  return all.find((e) => e.id === id) || null;
}

export async function upsertEmployee(emp: EmployeeAdmin): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const idx = local.employees.findIndex((e) => e.id === emp.id);
    if (idx >= 0) local.employees[idx] = { ...emp };
    else local.employees.push({ ...emp });
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('employees').upsert(
    {
      id: emp.id,
      name: emp.name,
      role_title: emp.roleTitle,
      outlet_id: emp.outletId,
      pay_type: emp.payType,
      pin: emp.pin,
      base_salary: emp.baseSalary,
      daily_rate: emp.dailyRate,
      meal_allowance: emp.mealAllowance,
      overtime_rate_per_hour: emp.overtimeRatePerHour,
      late_penalty: emp.latePenalty,
      kasbon_limit: emp.kasbonLimit,
      active: emp.active,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(error.message);
}

export async function deleteEmployeeById(id: string): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.employees = local.employees.filter((e) => e.id !== id);
    local.attendances = local.attendances.filter((a) => a.employeeId !== id);
    local.cashAdvances = local.cashAdvances.filter((c) => c.employeeId !== id);
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('employees').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================
// ATTENDANCES
// ============================================================

export async function fetchAttendances(params: {
  outletId?: string | null;
  employeeId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<AttendanceRecord[]> {
  const employees = await getEmployeesAdmin();
  const empNameMap = new Map(employees.map((e) => [e.id, e.name]));

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    return local.attendances
      .filter((a) => {
        if (params.outletId && a.outletId !== params.outletId) return false;
        if (params.employeeId && a.employeeId !== params.employeeId) return false;
        if (params.fromDate && a.date < params.fromDate) return false;
        if (params.toDate && a.date > params.toDate) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        if (a.shift !== b.shift) return b.shift - a.shift;
        return (b.checkInAt || b.createdAt).localeCompare(a.checkInAt || a.createdAt);
      })
      .map(({ createdAt: _c, ...a }) => ({
        ...a,
        employeeName: empNameMap.get(a.employeeId) || a.employeeId,
      }));
  }

  const db = getSupabaseAdmin();
  let q = db.from('attendances').select('*').order('date', { ascending: false }).order('created_at', { ascending: false });
  if (params.outletId) q = q.eq('outlet_id', params.outletId);
  if (params.employeeId) q = q.eq('employee_id', params.employeeId);
  if (params.fromDate) q = q.gte('date', params.fromDate);
  if (params.toDate) q = q.lte('date', params.toDate);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data || []).map((r: any) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: empNameMap.get(r.employee_id) || r.employee_id,
    outletId: r.outlet_id,
    date: r.date,
    shift: (Number(r.shift) === 3 ? 3 : Number(r.shift) === 2 ? 2 : 1) as AttendanceShift,
    checkInAt: r.check_in_at || null,
    checkOutAt: r.check_out_at || null,
    checkInPhoto: r.check_in_photo || null,
    checkOutPhoto: r.check_out_photo || null,
    status: r.status as AttendanceStatus,
    lateMinutes: Number(r.late_minutes || 0),
    overtimeMinutes: Number(r.overtime_minutes || 0),
    workMinutes: Number(r.work_minutes || 0),
    note: r.note || '',
  }));
}

export async function recordAttendanceClock(params: {
  action: 'check_in' | 'check_out';
  employeeId: string;
  outletId: string;
  shift: AttendanceShift;
  photo: string;
  note?: string;
}): Promise<AttendanceRecord> {
  const settings = await getAppSettings();
  const date = getLocalDateStr(0);
  const nowIso = new Date().toISOString();

  const existingList = await fetchAttendances({
    employeeId: params.employeeId,
    fromDate: date,
    toDate: date,
  });

  if (params.action === 'check_in') {
    const existingOpen = existingList.find((a) => a.shift === params.shift && a.checkInAt && !a.checkOutAt);
    if (existingOpen) {
      throw new Error('Anda sudah melakukan Absen Masuk pada shift ini dan belum Absen Pulang.');
    }
    const existingDone = existingList.find((a) => a.shift === params.shift && a.checkInAt && a.checkOutAt);
    if (existingDone) {
      throw new Error('Absensi Shift ini hari ini sudah tercatat lengkap (masuk & pulang).');
    }

    const timing = computeAttendanceTiming({
      shift: params.shift,
      checkInAt: nowIso,
      checkOutAt: null,
      schedule: settings.shiftSchedule,
    });
    const status: AttendanceStatus = timing.lateMinutes > 0 ? 'telat' : 'hadir';
    const id = crypto.randomUUID();

    if (isLocalDbEnabled()) {
      const local = readLocalDb();
      local.attendances.push({
        id,
        employeeId: params.employeeId,
        outletId: params.outletId,
        date,
        shift: params.shift,
        checkInAt: nowIso,
        checkOutAt: null,
        checkInPhoto: params.photo,
        checkOutPhoto: null,
        status,
        lateMinutes: timing.lateMinutes,
        overtimeMinutes: 0,
        workMinutes: 0,
        note: String(params.note || '').trim(),
        createdAt: nowIso,
      });
      writeLocalDb(local);
    } else {
      const db = getSupabaseAdmin();
      const { error } = await db.from('attendances').insert({
        id,
        employee_id: params.employeeId,
        outlet_id: params.outletId,
        date,
        shift: params.shift,
        check_in_at: nowIso,
        check_in_photo: params.photo,
        status,
        late_minutes: timing.lateMinutes,
        note: String(params.note || '').trim(),
      });
      if (error) throw new Error(error.message);
    }

    const emp = await getEmployeeById(params.employeeId);
    return {
      id,
      employeeId: params.employeeId,
      employeeName: emp?.name || params.employeeId,
      outletId: params.outletId,
      date,
      shift: params.shift,
      checkInAt: nowIso,
      checkOutAt: null,
      checkInPhoto: params.photo,
      checkOutPhoto: null,
      status,
      lateMinutes: timing.lateMinutes,
      overtimeMinutes: 0,
      workMinutes: 0,
      note: String(params.note || '').trim(),
    };
  }

  // check_out: find open attendance today (prefer matching shift, else latest open today)
  const openRec =
    existingList.find((a) => a.shift === params.shift && a.checkInAt && !a.checkOutAt) ||
    existingList.find((a) => a.checkInAt && !a.checkOutAt);

  if (!openRec) {
    throw new Error('Belum ada data Absen Masuk hari ini yang aktif untuk Absen Pulang.');
  }

  const timing = computeAttendanceTiming({
    shift: openRec.shift,
    checkInAt: openRec.checkInAt,
    checkOutAt: nowIso,
    schedule: settings.shiftSchedule,
  });

  const mergedNote = params.note?.trim()
    ? openRec.note
      ? `${openRec.note} | Pulang: ${params.note.trim()}`
      : params.note.trim()
    : openRec.note;

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const target = local.attendances.find((a) => a.id === openRec.id);
    if (target) {
      target.checkOutAt = nowIso;
      target.checkOutPhoto = params.photo;
      target.overtimeMinutes = timing.overtimeMinutes;
      target.workMinutes = timing.workMinutes;
      target.note = mergedNote;
      writeLocalDb(local);
    }
  } else {
    const db = getSupabaseAdmin();
    const { error } = await db
      .from('attendances')
      .update({
        check_out_at: nowIso,
        check_out_photo: params.photo,
        overtime_minutes: timing.overtimeMinutes,
        work_minutes: timing.workMinutes,
        note: mergedNote,
      })
      .eq('id', openRec.id);
    if (error) throw new Error(error.message);
  }

  return {
    ...openRec,
    checkOutAt: nowIso,
    checkOutPhoto: params.photo,
    overtimeMinutes: timing.overtimeMinutes,
    workMinutes: timing.workMinutes,
    note: mergedNote,
  };
}

export async function upsertManualAttendance(params: {
  id?: string;
  employeeId: string;
  outletId: string;
  date: string;
  shift: AttendanceShift;
  status: AttendanceStatus;
  lateMinutes?: number;
  overtimeMinutes?: number;
  note?: string;
}): Promise<void> {
  const id = params.id || crypto.randomUUID();
  const nowIso = new Date().toISOString();

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const idx = local.attendances.findIndex((a) => a.id === id);
    if (idx >= 0) {
      local.attendances[idx] = {
        ...local.attendances[idx],
        status: params.status,
        lateMinutes: Math.max(0, Math.round(Number(params.lateMinutes ?? local.attendances[idx].lateMinutes))),
        overtimeMinutes: Math.max(
          0,
          Math.round(Number(params.overtimeMinutes ?? local.attendances[idx].overtimeMinutes))
        ),
        note: params.note !== undefined ? params.note : local.attendances[idx].note,
      };
    } else {
      local.attendances.push({
        id,
        employeeId: params.employeeId,
        outletId: params.outletId,
        date: params.date,
        shift: params.shift,
        checkInAt: null,
        checkOutAt: null,
        checkInPhoto: null,
        checkOutPhoto: null,
        status: params.status,
        lateMinutes: Math.max(0, Math.round(Number(params.lateMinutes || 0))),
        overtimeMinutes: Math.max(0, Math.round(Number(params.overtimeMinutes || 0))),
        workMinutes: 0,
        note: String(params.note || '').trim(),
        createdAt: nowIso,
      });
    }
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  if (params.id) {
    const { error } = await db
      .from('attendances')
      .update({
        status: params.status,
        late_minutes: Math.max(0, Math.round(Number(params.lateMinutes || 0))),
        overtime_minutes: Math.max(0, Math.round(Number(params.overtimeMinutes || 0))),
        note: String(params.note || '').trim(),
      })
      .eq('id', params.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from('attendances').insert({
      id,
      employee_id: params.employeeId,
      outlet_id: params.outletId,
      date: params.date,
      shift: params.shift,
      status: params.status,
      late_minutes: Math.max(0, Math.round(Number(params.lateMinutes || 0))),
      overtime_minutes: Math.max(0, Math.round(Number(params.overtimeMinutes || 0))),
      note: String(params.note || '').trim(),
    });
    if (error) throw new Error(error.message);
  }
}

export async function deleteAttendanceById(id: string): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.attendances = local.attendances.filter((a) => a.id !== id);
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('attendances').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================
// CASH ADVANCES (KASBON)
// ============================================================

function hydrateCashAdvance(
  base: Omit<CashAdvanceRecord, 'paidAmount' | 'remainingAmount' | 'status'>
): CashAdvanceRecord {
  const type: CashAdvanceType = base.type === 'loan' ? 'loan' : 'kasbon';
  const tenorMonths = type === 'loan' ? Math.max(2, Math.round(base.tenorMonths || 12)) : 1;
  const installmentAmount =
    type === 'loan'
      ? base.installmentAmount && base.installmentAmount > 0
        ? Math.round(base.installmentAmount)
        : Math.ceil(base.amount / tenorMonths)
      : 0;
  const paidAmount = (base.repayments || []).reduce((s, r) => s + (r.amount || 0), 0);
  const remainingAmount = Math.max(0, base.amount - paidAmount);
  const status: CashAdvanceStatus =
    remainingAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
  return {
    ...base,
    type,
    tenorMonths,
    installmentAmount,
    paidAmount,
    remainingAmount,
    status,
  };
}

export async function fetchCashAdvances(params: {
  outletId?: string | null;
  employeeId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<CashAdvanceRecord[]> {
  const employees = await getEmployeesAdmin();
  const empNameMap = new Map(employees.map((e) => [e.id, e.name]));

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    return local.cashAdvances
      .filter((c) => {
        if (params.outletId && c.outletId !== params.outletId) return false;
        if (params.employeeId && c.employeeId !== params.employeeId) return false;
        if (params.fromDate && c.date < params.fromDate) return false;
        if (params.toDate && c.date > params.toDate) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.createdAt.localeCompare(a.createdAt);
      })
      .map(({ createdAt: _c, ...c }) =>
        hydrateCashAdvance({
          ...c,
          employeeName: empNameMap.get(c.employeeId) || c.employeeId,
          repayments: (c.repayments || []).map((r) => ({ ...r })),
        })
      );
  }

  const db = getSupabaseAdmin();
  let q = db.from('cash_advances').select('*').order('date', { ascending: false }).order('created_at', { ascending: false });
  if (params.outletId) q = q.eq('outlet_id', params.outletId);
  if (params.employeeId) q = q.eq('employee_id', params.employeeId);
  if (params.fromDate) q = q.gte('date', params.fromDate);
  if (params.toDate) q = q.lte('date', params.toDate);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return [];

  const { data: repRows, error: repErr } = await db
    .from('cash_advance_repayments')
    .select('*')
    .order('created_at', { ascending: true });
  if (repErr) throw new Error(repErr.message);

  const repByAdvance = new Map<string, CashAdvanceRepayment[]>();
  (repRows || []).forEach((r: any) => {
    const mapped: CashAdvanceRepayment = {
      id: r.id,
      cashAdvanceId: r.cash_advance_id,
      amount: Number(r.amount || 0),
      method: r.method,
      payrollRunId: r.payroll_run_id || null,
      note: r.note || '',
      date: r.date,
      at: r.created_at,
    };
    const list = repByAdvance.get(mapped.cashAdvanceId) || [];
    list.push(mapped);
    repByAdvance.set(mapped.cashAdvanceId, list);
  });

  return rows.map((r: any) =>
    hydrateCashAdvance({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: empNameMap.get(r.employee_id) || r.employee_id,
      outletId: r.outlet_id,
      shiftId: r.shift_id || null,
      date: r.date,
      shift: Number(r.shift) as 1 | 2,
      amount: Number(r.amount || 0),
      drawerAmount: Number(r.drawer_amount || 0),
      ownerTransferAmount: Number(r.owner_transfer_amount || 0),
      source: r.source as CashAdvanceSource,
      type: r.advance_type === 'loan' ? ('loan' as CashAdvanceType) : ('kasbon' as CashAdvanceType),
      tenorMonths: Number(r.tenor_months || 1),
      installmentAmount: Number(r.installment_amount || 0),
      note: r.note || '',
      time: r.advance_time || '',
      createdBy: r.created_by || '',
      repayments: repByAdvance.get(r.id) || [],
    })
  );
}

export async function createCashAdvance(params: {
  employeeId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  drawerAmount: number;
  ownerTransferAmount: number;
  type?: CashAdvanceType;
  tenorMonths?: number;
  installmentAmount?: number;
  note: string;
  createdBy: string;
}): Promise<CashAdvanceRecord> {
  const type: CashAdvanceType = params.type === 'loan' ? 'loan' : 'kasbon';
  const rawDrawer = Math.max(0, Math.round(params.drawerAmount));
  const rawOwner = Math.max(0, Math.round(params.ownerTransferAmount));
  const drawerAmount = type === 'loan' ? 0 : rawDrawer;
  const ownerTransferAmount = type === 'loan' ? rawDrawer + rawOwner : rawOwner;
  const amount = drawerAmount + ownerTransferAmount;
  if (amount <= 0) throw new Error('Nominal harus lebih dari Rp 0.');

  const tenorMonths = type === 'loan' ? Math.max(2, Math.round(params.tenorMonths || 12)) : 1;
  const installmentAmount =
    type === 'loan'
      ? params.installmentAmount && params.installmentAmount > 0
        ? Math.round(params.installmentAmount)
        : Math.ceil(amount / tenorMonths)
      : 0;

  const source: CashAdvanceSource =
    type === 'loan'
      ? 'owner_transfer'
      : drawerAmount > 0 && ownerTransferAmount > 0
        ? 'mixed'
        : drawerAmount > 0
          ? 'drawer'
          : 'owner_transfer';

  const shiftId = drawerAmount > 0 ? makeShiftId(params.outletId, params.date, params.shift) : null;
  const nowIso = new Date().toISOString();
  const timeWib = getCurrentTimeWib();
  const id = crypto.randomUUID();

  // If drawing from cash drawer, verify the shift isn't already locked
  if (shiftId) {
    const existingShift = await fetchSingleHydratedShift(params.outletId, params.date, params.shift);
    if (existingShift?.balanceChecked) {
      throw new Error(
        `Shift ${params.shift} tanggal ${params.date} sudah terkunci (Check Balance). Gunakan sumber Transfer Owner atau pilih shift yang belum terkunci.`
      );
    }

    if (!existingShift) {
      const prev = await getPreviousBalanceForShift(params.outletId, params.date, params.shift);
      if (isLocalDbEnabled()) {
        const local = readLocalDb();
        if (!local.shifts.some((s) => s.id === shiftId)) {
          local.shifts.push({
            id: shiftId,
            outletId: params.outletId,
            date: params.date,
            shift: params.shift,
            cashier: '',
            inputMode: params.shift === 2 ? 'cumulative' : 'standalone',
            posCumulative: { tunai: null, qris: null, online: null, edc: null, total: null },
            autoTotal: true,
            manualTotalOmset: 0,
            breakdown: { tunai: 0, qris: 0, online: 0, edc: 0 },
            openingCash: prev.amount,
            openingCashSource: prev.found ? 'carryover' : 'manual',
            cashDrop: 0,
            actualCash: null,
            denomCounts: {},
            balanceChecked: false,
            balanceNote: '',
            checkedAt: null,
            updatedAt: nowIso,
          });
          writeLocalDb(local);
        }
      } else {
        const db = getSupabaseAdmin();
        const { error: sErr } = await db.from('shifts').insert({
          id: shiftId,
          outlet_id: params.outletId,
          date: params.date,
          shift: params.shift,
          input_mode: params.shift === 2 ? 'cumulative' : 'standalone',
          opening_cash: prev.amount,
          opening_cash_source: prev.found ? 'carryover' : 'manual',
        });
        if (sErr && !sErr.message.includes('duplicate')) throw new Error(sErr.message);
      }
    }
  }

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.cashAdvances.push({
      id,
      employeeId: params.employeeId,
      outletId: params.outletId,
      shiftId,
      date: params.date,
      shift: params.shift,
      type,
      tenorMonths,
      installmentAmount,
      amount,
      drawerAmount,
      ownerTransferAmount,
      source,
      note: params.note,
      time: timeWib,
      createdBy: params.createdBy,
      repayments: [],
      createdAt: nowIso,
    });
    writeLocalDb(local);
  } else {
    const db = getSupabaseAdmin();
    const { error } = await db.from('cash_advances').insert({
      id,
      employee_id: params.employeeId,
      outlet_id: params.outletId,
      shift_id: shiftId,
      date: params.date,
      shift: params.shift,
      advance_type: type,
      tenor_months: tenorMonths,
      installment_amount: installmentAmount,
      amount,
      drawer_amount: drawerAmount,
      owner_transfer_amount: ownerTransferAmount,
      source,
      note: params.note,
      advance_time: timeWib,
      created_by: params.createdBy,
    });
    if (error) throw new Error(error.message);
  }

  if (drawerAmount > 0) {
    await cascadeRunningBalancesInDb(params.outletId);
  }

  const all = await fetchCashAdvances({ employeeId: params.employeeId });
  return all.find((c) => c.id === id)!;
}

export async function addCashAdvanceRepayment(params: {
  cashAdvanceId: string;
  amount: number;
  method: 'payroll' | 'cash_return' | 'transfer_return';
  payrollRunId?: string | null;
  note: string;
  date?: string;
}): Promise<void> {
  const amount = Math.max(0, Math.round(params.amount));
  if (amount <= 0) throw new Error('Nominal pelunasan harus lebih dari Rp 0.');

  const repId = crypto.randomUUID();
  const date = params.date || getLocalDateStr(0);
  const nowIso = new Date().toISOString();

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const adv = local.cashAdvances.find((c) => c.id === params.cashAdvanceId);
    if (!adv) throw new Error('Data kasbon tidak ditemukan.');
    const alreadyPaid = (adv.repayments || []).reduce((s, r) => s + r.amount, 0);
    const remaining = Math.max(0, adv.amount - alreadyPaid);
    const applyAmt = Math.min(amount, remaining);
    if (applyAmt <= 0) throw new Error('Kasbon ini sudah lunas.');
    adv.repayments.push({
      id: repId,
      cashAdvanceId: params.cashAdvanceId,
      amount: applyAmt,
      method: params.method,
      payrollRunId: params.payrollRunId || null,
      note: params.note,
      date,
      at: nowIso,
    });
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('cash_advance_repayments').insert({
    id: repId,
    cash_advance_id: params.cashAdvanceId,
    amount,
    method: params.method,
    payroll_run_id: params.payrollRunId || null,
    note: params.note,
    date,
  });
  if (error) throw new Error(error.message);
}

export async function applyEmployeeKasbonDeductionFIFO(params: {
  employeeId: string;
  totalDeduction: number;
  payrollRunId: string;
  periodLabel: string;
  date: string;
}): Promise<void> {
  let left = Math.max(0, Math.round(params.totalDeduction));
  if (left <= 0) return;

  const advances = (await fetchCashAdvances({ employeeId: params.employeeId }))
    .filter((c) => c.remainingAmount > 0)
    .sort((a, b) => {
      // Settle regular short-term kasbon first, then installment loans (oldest first)
      const rankA = a.type === 'loan' ? 1 : 0;
      const rankB = b.type === 'loan' ? 1 : 0;
      if (rankA !== rankB) return rankA - rankB;
      return a.date.localeCompare(b.date);
    });

  for (const adv of advances) {
    if (left <= 0) break;
    const payAmt = Math.min(left, adv.remainingAmount);
    await addCashAdvanceRepayment({
      cashAdvanceId: adv.id,
      amount: payAmt,
      method: 'payroll',
      payrollRunId: params.payrollRunId,
      note: `Potong Payroll (${params.periodLabel})`,
      date: params.date,
    });
    left -= payAmt;
  }
}

export async function deleteCashAdvanceById(id: string): Promise<void> {
  let outletIdToCascade: string | null = null;

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const target = local.cashAdvances.find((c) => c.id === id);
    if (!target) throw new Error('Data kasbon tidak ditemukan.');
    if (target.shiftId && target.drawerAmount > 0) {
      const parentShift = await fetchSingleHydratedShift(target.outletId, target.date, target.shift);
      if (parentShift?.balanceChecked) {
        throw new Error('Tidak dapat menghapus kasbon dari laci kasir karena shift terkait sudah terkunci.');
      }
      outletIdToCascade = target.outletId;
    }
    local.cashAdvances = local.cashAdvances.filter((c) => c.id !== id);
    writeLocalDb(local);
  } else {
    const db = getSupabaseAdmin();
    const { data: target, error: selErr } = await db
      .from('cash_advances')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!target) throw new Error('Data kasbon tidak ditemukan.');
    if (target.shift_id && Number(target.drawer_amount || 0) > 0) {
      const parentShift = await fetchSingleHydratedShift(
        target.outlet_id,
        target.date,
        Number(target.shift) as 1 | 2
      );
      if (parentShift?.balanceChecked) {
        throw new Error('Tidak dapat menghapus kasbon dari laci kasir karena shift terkait sudah terkunci.');
      }
      outletIdToCascade = target.outlet_id;
    }
    const { error } = await db.from('cash_advances').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  if (outletIdToCascade) {
    await cascadeRunningBalancesInDb(outletIdToCascade);
  }
}

// ============================================================
// PAYROLLS
// ============================================================

export async function fetchPayrolls(): Promise<PayrollRunRecord[]> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    return [...local.payrolls]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ ...p, items: p.items.map((it) => ({ ...it })) }));
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db.from('payrolls').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data || []).map((r: any) => ({
    id: r.id,
    periodLabel: r.period_label,
    fromDate: r.from_date,
    toDate: r.to_date,
    outletId: r.outlet_id || 'all',
    status: r.status === 'paid' ? 'paid' : 'draft',
    items: Array.isArray(r.items) ? r.items : [],
    totalGross: Number(r.total_gross || 0),
    totalKasbonDeducted: Number(r.total_kasbon_deducted || 0),
    totalNet: Number(r.total_net || 0),
    createdAt: r.created_at,
    paidAt: r.paid_at || null,
  }));
}

export async function buildPayrollPreviewItems(params: {
  fromDate: string;
  toDate: string;
  outletId?: string;
}): Promise<PayrollItemRecord[]> {
  const outletFilter = params.outletId && params.outletId !== 'all' ? params.outletId : null;
  const [employees, attendances, advances] = await Promise.all([
    getEmployeesAdmin(),
    fetchAttendances({ fromDate: params.fromDate, toDate: params.toDate }),
    fetchCashAdvances({}),
  ]);

  const activeEmps = employees.filter(
    (e) => e.active && (!outletFilter || e.outletId === 'all' || e.outletId === outletFilter)
  );

  return activeEmps.map((emp) => {
    const empAtt = attendances.filter((a) => a.employeeId === emp.id);
    const presentRows = empAtt.filter((a) => a.status === 'hadir' || a.status === 'telat');
    const daysPresent = presentRows.length;
    const fullShiftCount = presentRows.filter((a) => a.shift === 3).length;
    const lateCount = empAtt.filter((a) => a.status === 'telat' || a.lateMinutes > 0).length;
    const absentCount = empAtt.filter((a) => a.status === 'alpha').length;
    const totalOvertimeMin = presentRows.reduce((s, a) => s + (a.overtimeMinutes || 0), 0);
    const overtimeHours = Math.round((totalOvertimeMin / 60) * 10) / 10;

    // Pure manual salary entry by Owner; attendance stats stay reference-only.
    // Only active kasbon + 1-month installment of active loans are pulled automatically.
    const basePay = 0;
    const mealTotal = 0;
    const overtimePay = 0;
    const bonus = 0;
    const lateDeduction = 0;
    const otherDeduction = 0;
    const grossPay = 0;

    const empAdvances = advances.filter((c) => c.employeeId === emp.id && c.remainingAmount > 0);
    const activeKasbonBefore = empAdvances.reduce((s, c) => s + c.remainingAmount, 0);
    const suggestedKasbonDeduction = empAdvances.reduce((s, c) => {
      if (c.type === 'loan') {
        const due = c.installmentAmount && c.installmentAmount > 0 ? c.installmentAmount : c.remainingAmount;
        return s + Math.min(c.remainingAmount, due);
      }
      return s + c.remainingAmount;
    }, 0);

    const kasbonDeduction = suggestedKasbonDeduction;
    const netPay = Math.max(0, grossPay - lateDeduction - kasbonDeduction - otherDeduction);

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      roleTitle: emp.roleTitle,
      outletId: emp.outletId,
      payType: emp.payType,
      daysPresent,
      fullShiftCount,
      lateCount,
      absentCount,
      overtimeHours,
      basePay,
      mealTotal,
      overtimePay,
      bonus,
      lateDeduction,
      kasbonDeduction,
      suggestedKasbonDeduction,
      otherDeduction,
      grossPay,
      netPay,
      activeKasbonBefore,
      note: '',
    };
  });
}

export async function savePayrollRun(run: PayrollRunRecord): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const idx = local.payrolls.findIndex((p) => p.id === run.id);
    if (idx >= 0) local.payrolls[idx] = { ...run };
    else local.payrolls.push({ ...run });
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('payrolls').upsert(
    {
      id: run.id,
      period_label: run.periodLabel,
      from_date: run.fromDate,
      to_date: run.toDate,
      outlet_id: run.outletId,
      status: run.status,
      items: run.items,
      total_gross: run.totalGross,
      total_kasbon_deducted: run.totalKasbonDeducted,
      total_net: run.totalNet,
      created_at: run.createdAt,
      paid_at: run.paidAt,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(error.message);
}

export async function deletePayrollRunById(id: string): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const target = local.payrolls.find((p) => p.id === id);
    if (!target) throw new Error('Data payroll tidak ditemukan.');
    if (target.status === 'paid') {
      throw new Error('Payroll yang sudah dibayar tidak dapat dihapus.');
    }
    local.payrolls = local.payrolls.filter((p) => p.id !== id);
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { data: target } = await db.from('payrolls').select('id, status').eq('id', id).maybeSingle();
  if (!target) throw new Error('Data payroll tidak ditemukan.');
  if (target.status === 'paid') {
    throw new Error('Payroll yang sudah dibayar tidak dapat dihapus.');
  }
  const { error } = await db.from('payrolls').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function resolveOutletAccessForSession(
  session: SessionPayload,
  requestedOutletId?: string | null
): Promise<{
  allowed: boolean;
  outletId: string | null;
  canSwitchOutlet: boolean;
  actorLabel: string;
  error?: string;
}> {
  if (session.role === 'owner') {
    return {
      allowed: true,
      outletId: requestedOutletId || null,
      canSwitchOutlet: true,
      actorLabel: 'Owner',
    };
  }

  if (session.role === 'outlet') {
    if (!session.outletId) {
      return {
        allowed: false,
        outletId: null,
        canSwitchOutlet: false,
        actorLabel: 'Kasir',
        error: 'Sesi outlet tidak valid.',
      };
    }
    if (requestedOutletId && requestedOutletId !== session.outletId) {
      return {
        allowed: false,
        outletId: null,
        canSwitchOutlet: false,
        actorLabel: 'Kasir',
        error: 'Akses ditolak untuk outlet lain.',
      };
    }
    return {
      allowed: true,
      outletId: session.outletId,
      canSwitchOutlet: false,
      actorLabel: 'Kasir',
    };
  }

  // Unified Kru / Kasir session
  const emp = session.employeeId ? await getEmployeeById(session.employeeId) : null;
  if (!emp || !emp.active) {
    return {
      allowed: false,
      outletId: null,
      canSwitchOutlet: false,
      actorLabel: 'Kru',
      error: 'Akun kru tidak ditemukan atau sudah nonaktif.',
    };
  }

  const lockedOutletId = session.outletId || (emp.outletId !== 'all' ? emp.outletId : null);
  if (lockedOutletId) {
    if (requestedOutletId && requestedOutletId !== lockedOutletId) {
      return {
        allowed: false,
        outletId: null,
        canSwitchOutlet: false,
        actorLabel: emp.name,
        error: 'Akses ditolak. Perangkat ini terkunci pada outlet yang dipilih saat masuk.',
      };
    }
    return {
      allowed: true,
      outletId: lockedOutletId,
      canSwitchOutlet: false,
      actorLabel: emp.name,
    };
  }

  // Fallback for legacy un-anchored rolling crew token
  return {
    allowed: true,
    outletId: requestedOutletId || null,
    canSwitchOutlet: true,
    actorLabel: emp.name,
  };
}

export async function verifyCrewPinForOutletSession(
  session: SessionPayload,
  employeeId: string,
  pin: string
): Promise<
  | { ok: true; employee: EmployeeAdmin; outletId: string }
  | { ok: false; status: number; error: string }
> {
  if (session.role !== 'crew' && session.role !== 'outlet') {
    return { ok: false, status: 403, error: 'Verifikasi PIN kru hanya berlaku untuk sesi outlet/kru.' };
  }
  const activeOutletId = session.outletId || null;
  if (!activeOutletId) {
    return { ok: false, status: 400, error: 'Outlet aktif sesi belum ditentukan.' };
  }
  const targetEmpId = String(employeeId || '').trim();
  if (!targetEmpId) {
    return { ok: false, status: 400, error: 'Pilih nama kru terlebih dahulu.' };
  }
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) {
    return { ok: false, status: 400, error: 'PIN pribadi wajib diisi.' };
  }

  const emp = await getEmployeeById(targetEmpId);
  if (!emp || !emp.active) {
    return { ok: false, status: 404, error: 'Akun kru tidak ditemukan atau sudah nonaktif.' };
  }
  if (emp.outletId !== 'all' && emp.outletId !== activeOutletId) {
    return { ok: false, status: 403, error: `${emp.name} tidak terdaftar di outlet aktif ini.` };
  }
  if (!safeComparePin(cleanPin, emp.pin)) {
    return { ok: false, status: 401, error: `PIN pribadi ${emp.name} salah.` };
  }

  return { ok: true, employee: emp, outletId: activeOutletId };
}

// ============================================================
// PENGELUARAN LANGSUNG OWNER (BELANJA BAHAN & OPERASIONAL)
// ============================================================

export async function fetchOwnerExpenses(filters?: {
  fromDate?: string;
  toDate?: string;
  category?: string;
  outletId?: string;
}): Promise<OwnerExpenseRecord[]> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    let list = [...(local.ownerExpenses || [])];
    if (filters?.fromDate) list = list.filter((e) => e.date >= filters.fromDate!);
    if (filters?.toDate) list = list.filter((e) => e.date <= filters.toDate!);
    if (filters?.category && filters.category !== 'all') {
      list = list.filter((e) => e.category === filters.category);
    }
    if (filters?.outletId && filters.outletId !== 'all') {
      list = list.filter((e) => e.outletIds.includes(filters.outletId!));
    }
    return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  const db = getSupabaseAdmin();
  let query = db
    .from('owner_expenses')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters?.fromDate) query = query.gte('date', filters.fromDate);
  if (filters?.toDate) query = query.lte('date', filters.toDate);
  if (filters?.category && filters.category !== 'all') query = query.eq('category', filters.category);

  const { data, error } = await query;
  if (error) {
    if (error.message.includes('owner_expenses')) {
      return [];
    }
    throw new Error(error.message);
  }

  let rows: OwnerExpenseRecord[] = (data || []).map((r: any) => ({
    id: String(r.id),
    date: String(r.date),
    category: String(r.category || 'Belanja Bahan'),
    outletIds: Array.isArray(r.outlet_ids) ? r.outlet_ids.map(String) : [],
    description: String(r.description || ''),
    amount: Number(r.amount || 0),
    paymentMethod: String(r.payment_method || 'Transfer'),
    notes: String(r.notes || ''),
    createdAt: String(r.created_at || ''),
  }));

  if (filters?.outletId && filters.outletId !== 'all') {
    rows = rows.filter((r) => r.outletIds.includes(filters.outletId!));
  }
  return rows;
}

export async function createOwnerExpense(input: {
  date: string;
  category: string;
  outletIds: string[];
  description: string;
  amount: number;
  paymentMethod: string;
  notes?: string;
}): Promise<OwnerExpenseRecord> {
  const cleanOutlets = [...new Set(input.outletIds.map((x) => String(x).trim()).filter(Boolean))];
  if (cleanOutlets.length === 0) {
    throw new Error('Pilih minimal satu outlet untuk pengeluaran ini.');
  }
  const cleanAmount = Math.round(Number(input.amount || 0));
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    throw new Error('Nominal pengeluaran harus lebih dari 0.');
  }

  const nowIso = new Date().toISOString();
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const record: OwnerExpenseRecord = {
      id: crypto.randomUUID(),
      date: input.date,
      category: input.category,
      outletIds: cleanOutlets,
      description: input.description,
      amount: cleanAmount,
      paymentMethod: input.paymentMethod || 'Transfer',
      notes: input.notes || '',
      createdAt: nowIso,
    };
    local.ownerExpenses = [record, ...(local.ownerExpenses || [])];
    writeLocalDb(local);
    return record;
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('owner_expenses')
    .insert({
      date: input.date,
      category: input.category,
      outlet_ids: cleanOutlets,
      description: input.description,
      amount: cleanAmount,
      payment_method: input.paymentMethod || 'Transfer',
      notes: input.notes || '',
    })
    .select('*')
    .single();

  if (error) {
    if (error.message.includes('owner_expenses')) {
      throw new Error(
        'Tabel owner_expenses belum ada di Supabase. Jalankan SQL pembuatan tabel owner_expenses dari supabase/schema.sql di Supabase SQL Editor.'
      );
    }
    throw new Error(error.message);
  }

  return {
    id: String(data.id),
    date: String(data.date),
    category: String(data.category || 'Belanja Bahan'),
    outletIds: Array.isArray(data.outlet_ids) ? data.outlet_ids.map(String) : cleanOutlets,
    description: String(data.description || ''),
    amount: Number(data.amount || 0),
    paymentMethod: String(data.payment_method || 'Transfer'),
    notes: String(data.notes || ''),
    createdAt: String(data.created_at || nowIso),
  };
}

export async function deleteOwnerExpense(id: string): Promise<void> {
  if (!id) throw new Error('ID pengeluaran tidak valid.');
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.ownerExpenses = (local.ownerExpenses || []).filter((e) => e.id !== id);
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('owner_expenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

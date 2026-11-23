import crypto from 'crypto';
import { getSupabaseAdmin } from './supabase';
import { isLocalDbEnabled, readLocalDb, writeLocalDb } from './local-db';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_SHIFT_SCHEDULE,
  calcShiftMetrics,
  computeCumulativeShift2Breakdown,
  formatDateIndo,
  getCurrentTimeWib,
  makeShiftId,
} from './calc';
import type {
  AppSettingsAdmin,
  CashDropRecord,
  CorrectionLogRecord,
  ExpenseRecord,
  OutletAdmin,
  OutletPublic,
  PosCumulative,
  PreviousBalanceInfo,
  Shift1RefInfo,
  ShiftRecord,
  ShiftScheduleConfig,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllSupabaseRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery(offset, offset + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }
  return all;
}

export async function getAppSettings(): Promise<AppSettingsAdmin> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    return {
      ownerPin: String(local.settings.ownerPin || '9999'),
      requireOwnerPinForCorrection: Boolean(local.settings.requireOwnerPinForCorrection),
      expenseCategories:
        Array.isArray(local.settings.expenseCategories) && local.settings.expenseCategories.length > 0
          ? [...local.settings.expenseCategories]
          : [...DEFAULT_EXPENSE_CATEGORIES],
      shiftSchedule: local.settings.shiftSchedule || { ...DEFAULT_SHIFT_SCHEDULE },
      googleSheetsWebhookUrl: String(local.settings.googleSheetsWebhookUrl || ''),
      googleSheetsAutoSync: Boolean(local.settings.googleSheetsAutoSync),
      googleSheetsLastSync: local.settings.googleSheetsLastSync || null,
    };
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db.from('app_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);

  if (!data) {
    const defaults = {
      id: 1,
      owner_pin: '9999',
      require_owner_pin_for_correction: false,
      expense_categories: DEFAULT_EXPENSE_CATEGORIES,
      shift_schedule: DEFAULT_SHIFT_SCHEDULE,
    };
    await db.from('app_settings').upsert(defaults);
    return {
      ownerPin: defaults.owner_pin,
      requireOwnerPinForCorrection: defaults.require_owner_pin_for_correction,
      expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
      shiftSchedule: { ...DEFAULT_SHIFT_SCHEDULE },
    };
  }

  return {
    ownerPin: String(data.owner_pin || '9999'),
    requireOwnerPinForCorrection: Boolean(data.require_owner_pin_for_correction),
    expenseCategories:
      Array.isArray(data.expense_categories) && data.expense_categories.length > 0
        ? data.expense_categories
        : [...DEFAULT_EXPENSE_CATEGORIES],
    shiftSchedule: data.shift_schedule
      ? {
          shift1Start: String(data.shift_schedule.shift1Start || DEFAULT_SHIFT_SCHEDULE.shift1Start),
          shift1End: String(data.shift_schedule.shift1End || DEFAULT_SHIFT_SCHEDULE.shift1End),
          shift2Start: String(data.shift_schedule.shift2Start || DEFAULT_SHIFT_SCHEDULE.shift2Start),
          shift2End: String(data.shift_schedule.shift2End || DEFAULT_SHIFT_SCHEDULE.shift2End),
          lateGraceMinutes: Number(data.shift_schedule.lateGraceMinutes ?? DEFAULT_SHIFT_SCHEDULE.lateGraceMinutes),
        }
      : { ...DEFAULT_SHIFT_SCHEDULE },
    googleSheetsWebhookUrl: String(data.google_sheets_webhook_url || ''),
    googleSheetsAutoSync: Boolean(data.google_sheets_auto_sync),
    googleSheetsLastSync: data.google_sheets_last_sync || null,
  };
}

export async function updateAppSettings(updates: {
  ownerPin?: string;
  requireOwnerPinForCorrection?: boolean;
  expenseCategories?: string[];
  shiftSchedule?: ShiftScheduleConfig;
  googleSheetsWebhookUrl?: string;
  googleSheetsAutoSync?: boolean;
  googleSheetsLastSync?: string | null;
}): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    if (typeof updates.ownerPin === 'string') local.settings.ownerPin = updates.ownerPin;
    if (typeof updates.requireOwnerPinForCorrection === 'boolean') {
      local.settings.requireOwnerPinForCorrection = updates.requireOwnerPinForCorrection;
    }
    if (Array.isArray(updates.expenseCategories)) {
      local.settings.expenseCategories = updates.expenseCategories;
    }
    if (updates.shiftSchedule) {
      local.settings.shiftSchedule = { ...updates.shiftSchedule };
    }
    if (typeof updates.googleSheetsWebhookUrl === 'string') {
      local.settings.googleSheetsWebhookUrl = updates.googleSheetsWebhookUrl;
    }
    if (typeof updates.googleSheetsAutoSync === 'boolean') {
      local.settings.googleSheetsAutoSync = updates.googleSheetsAutoSync;
    }
    if (updates.googleSheetsLastSync !== undefined) {
      local.settings.googleSheetsLastSync = updates.googleSheetsLastSync;
    }
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof updates.ownerPin === 'string') dbUpdates.owner_pin = updates.ownerPin;
  if (typeof updates.requireOwnerPinForCorrection === 'boolean') {
    dbUpdates.require_owner_pin_for_correction = updates.requireOwnerPinForCorrection;
  }
  if (Array.isArray(updates.expenseCategories)) {
    dbUpdates.expense_categories = updates.expenseCategories;
  }
  if (updates.shiftSchedule) {
    dbUpdates.shift_schedule = updates.shiftSchedule;
  }
  if (typeof updates.googleSheetsWebhookUrl === 'string') {
    dbUpdates.google_sheets_webhook_url = updates.googleSheetsWebhookUrl;
  }
  if (typeof updates.googleSheetsAutoSync === 'boolean') {
    dbUpdates.google_sheets_auto_sync = updates.googleSheetsAutoSync;
  }
  if (updates.googleSheetsLastSync !== undefined) {
    dbUpdates.google_sheets_last_sync = updates.googleSheetsLastSync;
  }
  const { error } = await db.from('app_settings').update(dbUpdates).eq('id', 1);
  if (error) throw new Error(error.message);
}

export async function getOutletsAdmin(): Promise<OutletAdmin[]> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    return [...local.outlets]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((o) => ({ ...o }));
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('outlets')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    location: row.location || '',
    defaultOpeningCash: Number(row.default_opening_cash || 0),
    sortOrder: Number(row.sort_order || 0),
    pin: String(row.pin || '1111'),
  }));
}

export async function getOutletsPublic(): Promise<OutletPublic[]> {
  const list = await getOutletsAdmin();
  return list.map(({ pin: _pin, ...rest }) => rest);
}

export async function getOutletById(id: string): Promise<OutletAdmin | null> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const found = local.outlets.find((o) => o.id === id);
    return found ? { ...found } : null;
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db.from('outlets').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    location: data.location || '',
    defaultOpeningCash: Number(data.default_opening_cash || 0),
    sortOrder: Number(data.sort_order || 0),
    pin: String(data.pin || '1111'),
  };
}

export async function upsertOutlet(outlet: OutletAdmin): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const idx = local.outlets.findIndex((o) => o.id === outlet.id);
    if (idx >= 0) {
      local.outlets[idx] = { ...outlet };
    } else {
      local.outlets.push({ ...outlet });
    }
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('outlets').upsert(
    {
      id: outlet.id,
      name: outlet.name,
      location: outlet.location,
      pin: outlet.pin,
      default_opening_cash: outlet.defaultOpeningCash,
      sort_order: outlet.sortOrder,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(error.message);
}

export async function deleteOutletById(id: string): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.outlets = local.outlets.filter((o) => o.id !== id);
    local.shifts = local.shifts.filter((s) => s.outletId !== id);
    local.expenses = local.expenses.filter((e) => e.outletId !== id);
    local.cashDrops = local.cashDrops.filter((d) => d.outletId !== id);
    local.correctionLogs = local.correctionLogs.filter((c) => c.outletId !== id);
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('outlets').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export function mapExpenseRow(row: any): ExpenseRecord {
  return {
    id: row.id,
    shiftId: row.shift_id,
    outletId: row.outlet_id,
    date: row.date,
    shift: Number(row.shift) as 1 | 2,
    desc: row.description,
    category: row.category || 'Lain-Lain',
    amount: Number(row.amount || 0),
    time: row.expense_time || '',
  };
}

export function mapCashDropRow(row: any): CashDropRecord {
  return {
    id: row.id,
    shiftId: row.shift_id,
    outletId: row.outlet_id,
    date: row.date,
    shift: Number(row.shift) as 1 | 2,
    method: row.method || 'Tunai ke Owner',
    note: row.note || '',
    amount: Number(row.amount || 0),
    time: row.drop_time || '',
  };
}

export function mapCorrectionRow(row: any): CorrectionLogRecord {
  return {
    id: row.id,
    shiftId: row.shift_id,
    outletId: row.outlet_id,
    date: row.date,
    shift: Number(row.shift) as 1 | 2,
    actor: row.actor,
    reason: row.reason,
    changes: Array.isArray(row.changes) ? row.changes : [],
    at: row.created_at,
  };
}

export function mapShiftRow(
  row: any,
  expenses: ExpenseRecord[],
  cashDrops: CashDropRecord[],
  correctionLogs: CorrectionLogRecord[],
  drawerKasbon = 0
): ShiftRecord {
  const posCum: PosCumulative = {
    tunai: row.pos_cumulative?.tunai ?? null,
    qris: row.pos_cumulative?.qris ?? null,
    online: row.pos_cumulative?.online ?? null,
    edc: row.pos_cumulative?.edc ?? null,
    total: row.pos_cumulative?.total ?? null,
  };
  const dropSum = cashDrops.reduce((s, d) => s + d.amount, 0);

  return {
    id: row.id,
    outletId: row.outlet_id,
    date: row.date,
    shift: Number(row.shift) as 1 | 2,
    cashier: row.cashier || '',
    inputMode: row.input_mode === 'cumulative' ? 'cumulative' : 'standalone',
    posCumulative: posCum,
    autoTotal: row.auto_total !== false,
    manualTotalOmset: Number(row.manual_total_omset || 0),
    breakdown: {
      tunai: Number(row.tunai || 0),
      qris: Number(row.qris || 0),
      online: Number(row.online_delivery || 0),
      edc: Number(row.edc_transfer || 0),
    },
    openingCash: Number(row.opening_cash || 0),
    openingCashSource: row.opening_cash_source === 'manual' ? 'manual' : 'carryover',
    cashDrop: cashDrops.length > 0 ? dropSum : Number(row.cash_drop || 0),
    drawerKasbon,
    actualCash: row.actual_cash === null || row.actual_cash === undefined ? null : Number(row.actual_cash),
    denomCounts: row.denom_counts || {},
    balanceChecked: Boolean(row.balance_checked),
    balanceNote: row.balance_note || '',
    checkedAt: row.checked_at || null,
    expenses,
    cashDrops,
    correctionLogs,
  };
}

export async function fetchHydratedShifts(params: {
  outletId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  includeCorrections?: boolean;
}): Promise<ShiftRecord[]> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const filteredShifts = local.shifts
      .filter((s) => {
        if (params.outletId && s.outletId !== params.outletId) return false;
        if (params.fromDate && s.date < params.fromDate) return false;
        if (params.toDate && s.date > params.toDate) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.shift - a.shift;
      });

    const expByShift = new Map<string, ExpenseRecord[]>();
    [...local.expenses]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((e) => {
        const list = expByShift.get(e.shiftId) || [];
        list.push({
          id: e.id,
          shiftId: e.shiftId,
          outletId: e.outletId,
          date: e.date,
          shift: e.shift,
          desc: e.desc,
          category: e.category,
          amount: e.amount,
          time: e.time,
        });
        expByShift.set(e.shiftId, list);
      });

    const dropByShift = new Map<string, CashDropRecord[]>();
    [...local.cashDrops]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((d) => {
        const list = dropByShift.get(d.shiftId) || [];
        list.push({
          id: d.id,
          shiftId: d.shiftId,
          outletId: d.outletId,
          date: d.date,
          shift: d.shift,
          method: d.method,
          note: d.note,
          amount: d.amount,
          time: d.time,
        });
        dropByShift.set(d.shiftId, list);
      });

    const corrByShift = new Map<string, CorrectionLogRecord[]>();
    [...local.correctionLogs]
      .sort((a, b) => b.at.localeCompare(a.at))
      .forEach((c) => {
        const list = corrByShift.get(c.shiftId) || [];
        list.push({ ...c, changes: [...c.changes] });
        corrByShift.set(c.shiftId, list);
      });

    const kasbonDrawerByShift = new Map<string, number>();
    (local.cashAdvances || []).forEach((c) => {
      if (c.shiftId && c.drawerAmount > 0) {
        kasbonDrawerByShift.set(c.shiftId, (kasbonDrawerByShift.get(c.shiftId) || 0) + c.drawerAmount);
      }
    });

    return filteredShifts.map(({ updatedAt: _u, ...s }) => {
      const drops = dropByShift.get(s.id) || [];
      return {
        ...s,
        cashDrop: drops.length > 0 ? drops.reduce((sum, d) => sum + d.amount, 0) : s.cashDrop,
        drawerKasbon: kasbonDrawerByShift.get(s.id) || 0,
        posCumulative: { ...s.posCumulative },
        breakdown: { ...s.breakdown },
        denomCounts: { ...s.denomCounts },
        expenses: expByShift.get(s.id) || [],
        cashDrops: drops,
        correctionLogs: corrByShift.get(s.id) || [],
      };
    });
  }

  const db = getSupabaseAdmin();
  const includeCorrections = params.includeCorrections !== false;

  // Run parent shifts + child tables in ONE parallel wave (1 round-trip)
  const [shiftRows, expRows, dropRows, corrRows, advRows] = await Promise.all([
    fetchAllSupabaseRows((from, to) => {
      let q = db
        .from('shifts')
        .select('*')
        .order('date', { ascending: false })
        .order('shift', { ascending: false })
        .range(from, to);
      if (params.outletId) q = q.eq('outlet_id', params.outletId);
      if (params.fromDate) q = q.gte('date', params.fromDate);
      if (params.toDate) q = q.lte('date', params.toDate);
      return q;
    }),
    fetchAllSupabaseRows((from, to) => {
      let q = db.from('expenses').select('*').order('created_at', { ascending: true }).range(from, to);
      if (params.outletId) q = q.eq('outlet_id', params.outletId);
      if (params.fromDate) q = q.gte('date', params.fromDate);
      if (params.toDate) q = q.lte('date', params.toDate);
      return q;
    }),
    fetchAllSupabaseRows((from, to) => {
      let q = db.from('cash_drops').select('*').order('created_at', { ascending: true }).range(from, to);
      if (params.outletId) q = q.eq('outlet_id', params.outletId);
      if (params.fromDate) q = q.gte('date', params.fromDate);
      if (params.toDate) q = q.lte('date', params.toDate);
      return q;
    }),
    includeCorrections
      ? fetchAllSupabaseRows((from, to) => {
          let q = db.from('correction_logs').select('*').order('created_at', { ascending: false }).range(from, to);
          if (params.outletId) q = q.eq('outlet_id', params.outletId);
          if (params.fromDate) q = q.gte('date', params.fromDate);
          if (params.toDate) q = q.lte('date', params.toDate);
          return q;
        })
      : Promise.resolve([]),
    fetchAllSupabaseRows((from, to) => {
      let q = db.from('cash_advances').select('shift_id, drawer_amount').gt('drawer_amount', 0).range(from, to);
      if (params.outletId) q = q.eq('outlet_id', params.outletId);
      if (params.fromDate) q = q.gte('date', params.fromDate);
      if (params.toDate) q = q.lte('date', params.toDate);
      return q;
    }),
  ]);

  if (shiftRows.length === 0) return [];

  const expByShift = new Map<string, ExpenseRecord[]>();
  expRows.forEach((r: any) => {
    const mapped = mapExpenseRow(r);
    const list = expByShift.get(mapped.shiftId) || [];
    list.push(mapped);
    expByShift.set(mapped.shiftId, list);
  });

  const dropByShift = new Map<string, CashDropRecord[]>();
  dropRows.forEach((r: any) => {
    const mapped = mapCashDropRow(r);
    const list = dropByShift.get(mapped.shiftId) || [];
    list.push(mapped);
    dropByShift.set(mapped.shiftId, list);
  });

  const corrByShift = new Map<string, CorrectionLogRecord[]>();
  corrRows.forEach((r: any) => {
    const mapped = mapCorrectionRow(r);
    const list = corrByShift.get(mapped.shiftId) || [];
    list.push(mapped);
    corrByShift.set(mapped.shiftId, list);
  });

  const kasbonDrawerByShift = new Map<string, number>();
  advRows.forEach((r: any) => {
    if (r.shift_id) {
      kasbonDrawerByShift.set(r.shift_id, (kasbonDrawerByShift.get(r.shift_id) || 0) + Number(r.drawer_amount || 0));
    }
  });

  return shiftRows.map((row: any) =>
    mapShiftRow(
      row,
      expByShift.get(row.id) || [],
      dropByShift.get(row.id) || [],
      corrByShift.get(row.id) || [],
      kasbonDrawerByShift.get(row.id) || 0
    )
  );
}

export async function fetchSingleHydratedShift(
  outletId: string,
  date: string,
  shift: 1 | 2
): Promise<ShiftRecord | null> {
  const id = makeShiftId(outletId, date, shift);

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const row = local.shifts.find((s) => s.id === id);
    if (!row) return null;
    const { updatedAt: _u, ...rest } = row;
    const expenses = local.expenses
      .filter((e) => e.shiftId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ createdAt: _c, ...e }) => ({ ...e }));
    const cashDrops = local.cashDrops
      .filter((d) => d.shiftId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ createdAt: _c, ...d }) => ({ ...d }));
    const correctionLogs = local.correctionLogs
      .filter((c) => c.shiftId === id)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((c) => ({ ...c, changes: [...c.changes] }));
    const drawerKasbon = (local.cashAdvances || [])
      .filter((c) => c.shiftId === id && c.drawerAmount > 0)
      .reduce((s, c) => s + c.drawerAmount, 0);
    return {
      ...rest,
      cashDrop: cashDrops.length > 0 ? cashDrops.reduce((s, d) => s + d.amount, 0) : rest.cashDrop,
      drawerKasbon,
      posCumulative: { ...rest.posCumulative },
      breakdown: { ...rest.breakdown },
      denomCounts: { ...rest.denomCounts },
      expenses,
      cashDrops,
      correctionLogs,
    };
  }

  const db = getSupabaseAdmin();
  const [shiftRes, expRows, dropRows, corrRows, advRows] = await Promise.all([
    db.from('shifts').select('*').eq('id', id).maybeSingle(),
    fetchAllSupabaseRows((from, to) =>
      db.from('expenses').select('*').eq('shift_id', id).order('created_at', { ascending: true }).range(from, to)
    ),
    fetchAllSupabaseRows((from, to) =>
      db.from('cash_drops').select('*').eq('shift_id', id).order('created_at', { ascending: true }).range(from, to)
    ),
    fetchAllSupabaseRows((from, to) =>
      db
        .from('correction_logs')
        .select('*')
        .eq('shift_id', id)
        .order('created_at', { ascending: false })
        .range(from, to)
    ),
    fetchAllSupabaseRows((from, to) =>
      db.from('cash_advances').select('drawer_amount').eq('shift_id', id).gt('drawer_amount', 0).range(from, to)
    ),
  ]);
  if (shiftRes.error) throw new Error(shiftRes.error.message);
  if (!shiftRes.data) return null;
  const row = shiftRes.data;

  const drawerKasbon = advRows.reduce((s, r: any) => s + Number(r.drawer_amount || 0), 0);

  return mapShiftRow(
    row,
    expRows.map(mapExpenseRow),
    dropRows.map(mapCashDropRow),
    corrRows.map(mapCorrectionRow),
    drawerKasbon
  );
}

export async function upsertShiftData(
  shiftData: Omit<ShiftRecord, 'expenses' | 'cashDrops' | 'correctionLogs' | 'drawerKasbon'> & { updatedAt: string }
): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const idx = local.shifts.findIndex((s) => s.id === shiftData.id);
    if (idx >= 0) {
      local.shifts[idx] = { ...shiftData };
    } else {
      local.shifts.push({ ...shiftData });
    }
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('shifts').upsert(
    {
      id: shiftData.id,
      outlet_id: shiftData.outletId,
      date: shiftData.date,
      shift: shiftData.shift,
      cashier: shiftData.cashier,
      input_mode: shiftData.inputMode,
      pos_cumulative: shiftData.posCumulative,
      auto_total: shiftData.autoTotal,
      manual_total_omset: shiftData.manualTotalOmset,
      tunai: shiftData.breakdown.tunai,
      qris: shiftData.breakdown.qris,
      online_delivery: shiftData.breakdown.online,
      edc_transfer: shiftData.breakdown.edc,
      opening_cash: shiftData.openingCash,
      opening_cash_source: shiftData.openingCashSource,
      cash_drop: shiftData.cashDrop,
      actual_cash: shiftData.actualCash,
      denom_counts: shiftData.denomCounts,
      balance_checked: shiftData.balanceChecked,
      balance_note: shiftData.balanceNote,
      checked_at: shiftData.checkedAt,
      updated_at: shiftData.updatedAt,
    },
    { onConflict: 'id' }
  );
  if (error) throw new Error(error.message);
}

export async function deleteShiftById(id: string): Promise<{ outletId: string } | null> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const existing = local.shifts.find((s) => s.id === id);
    if (!existing) return null;
    local.shifts = local.shifts.filter((s) => s.id !== id);
    local.expenses = local.expenses.filter((e) => e.shiftId !== id);
    local.cashDrops = local.cashDrops.filter((d) => d.shiftId !== id);
    local.correctionLogs = local.correctionLogs.filter((c) => c.shiftId !== id);
    writeLocalDb(local);
    return { outletId: existing.outletId };
  }

  const db = getSupabaseAdmin();
  const { data: existing, error: selErr } = await db
    .from('shifts')
    .select('id, outlet_id')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (!existing) return null;

  const { error } = await db.from('shifts').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { outletId: existing.outlet_id };
}

export async function insertCorrectionLog(entry: {
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  actor: string;
  reason: string;
  changes: string[];
}): Promise<void> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.correctionLogs.push({
      id: crypto.randomUUID(),
      shiftId: entry.shiftId,
      outletId: entry.outletId,
      date: entry.date,
      shift: entry.shift,
      actor: entry.actor,
      reason: entry.reason,
      changes: entry.changes,
      at: new Date().toISOString(),
    });
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('correction_logs').insert({
    shift_id: entry.shiftId,
    outlet_id: entry.outletId,
    date: entry.date,
    shift: entry.shift,
    actor: entry.actor,
    reason: entry.reason,
    changes: entry.changes,
  });
  if (error) throw new Error(error.message);
}

export async function addExpenseToShift(params: {
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  cashier: string;
  desc: string;
  category: string;
  amount: number;
  existingShift: ShiftRecord | null;
}): Promise<void> {
  const timeWib = getCurrentTimeWib();
  const nowIso = new Date().toISOString();

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    if (!params.existingShift && !local.shifts.some((s) => s.id === params.shiftId)) {
      const prev = await getPreviousBalanceForShift(params.outletId, params.date, params.shift);
      local.shifts.push({
        id: params.shiftId,
        outletId: params.outletId,
        date: params.date,
        shift: params.shift,
        cashier: params.cashier,
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
    } else if (params.existingShift) {
      const s = local.shifts.find((item) => item.id === params.shiftId);
      if (s) {
        s.balanceChecked = false;
        s.updatedAt = nowIso;
      }
    }

    local.expenses.push({
      id: crypto.randomUUID(),
      shiftId: params.shiftId,
      outletId: params.outletId,
      date: params.date,
      shift: params.shift,
      desc: params.desc,
      category: params.category,
      amount: params.amount,
      time: timeWib,
      createdAt: nowIso,
    });
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  if (!params.existingShift) {
    const prev = await getPreviousBalanceForShift(params.outletId, params.date, params.shift);
    const { error: shiftErr } = await db.from('shifts').insert({
      id: params.shiftId,
      outlet_id: params.outletId,
      date: params.date,
      shift: params.shift,
      cashier: params.cashier,
      input_mode: params.shift === 2 ? 'cumulative' : 'standalone',
      opening_cash: prev.amount,
      opening_cash_source: prev.found ? 'carryover' : 'manual',
    });
    if (shiftErr && !shiftErr.message.includes('duplicate')) {
      throw new Error(shiftErr.message);
    }
  }

  const { error: expErr } = await db.from('expenses').insert({
    shift_id: params.shiftId,
    outlet_id: params.outletId,
    date: params.date,
    shift: params.shift,
    description: params.desc,
    category: params.category,
    amount: params.amount,
    expense_time: timeWib,
  });
  if (expErr) throw new Error(expErr.message);

  if (params.existingShift) {
    await db
      .from('shifts')
      .update({ balance_checked: false, updated_at: nowIso })
      .eq('id', params.shiftId);
  }
}

export async function getExpenseById(id: string): Promise<ExpenseRecord | null> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const found = local.expenses.find((e) => e.id === id);
    if (!found) return null;
    const { createdAt: _c, ...rest } = found;
    return { ...rest };
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db.from('expenses').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapExpenseRow(data);
}

export async function deleteExpenseById(exp: ExpenseRecord): Promise<void> {
  const nowIso = new Date().toISOString();

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.expenses = local.expenses.filter((e) => e.id !== exp.id);
    const parent = local.shifts.find((s) => s.id === exp.shiftId);
    if (parent) {
      parent.balanceChecked = false;
      parent.updatedAt = nowIso;
    }
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('expenses').delete().eq('id', exp.id);
  if (error) throw new Error(error.message);

  await db
    .from('shifts')
    .update({ balance_checked: false, updated_at: nowIso })
    .eq('id', exp.shiftId);
}

/**
 * Atomically syncs staged expense edits (additions/deletions) during a locked shift correction
 * so that canceling a correction never mutates the DB and saving captures exact expense diffs in audit logs.
 */
export async function syncShiftExpensesForCorrection(params: {
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  desiredExpenses: Array<{ id?: string; desc: string; category: string; amount: number; time?: string }>;
}): Promise<void> {
  const cleaned = params.desiredExpenses
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id : '',
      desc: String(e.desc || '').trim(),
      category: String(e.category || 'Lain-Lain').trim() || 'Lain-Lain',
      amount: Math.round(Number(e.amount || 0)),
      time: String(e.time || '').trim() || getCurrentTimeWib(),
    }))
    .filter((e) => e.desc && e.amount > 0);

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const existingForShift = local.expenses.filter((e) => e.shiftId === params.shiftId);
    const existingById = new Map(existingForShift.map((e) => [e.id, e]));
    const keepIds = new Set(cleaned.filter((e) => e.id && existingById.has(e.id)).map((e) => e.id));

    // Remove deleted expenses for this shift
    local.expenses = local.expenses.filter((e) => e.shiftId !== params.shiftId || keepIds.has(e.id));

    // Append newly staged expenses
    const nowIso = new Date().toISOString();
    cleaned.forEach((e) => {
      if (!e.id || !existingById.has(e.id)) {
        local.expenses.push({
          id: crypto.randomUUID(),
          shiftId: params.shiftId,
          outletId: params.outletId,
          date: params.date,
          shift: params.shift,
          desc: e.desc,
          category: e.category,
          amount: e.amount,
          time: e.time,
          createdAt: nowIso,
        });
      }
    });

    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const existingRows = await fetchAllSupabaseRows((from, to) =>
    db.from('expenses').select('id').eq('shift_id', params.shiftId).range(from, to)
  );
  const existingIds = new Set(existingRows.map((r: any) => String(r.id)));
  const keepIds = new Set(cleaned.filter((e) => e.id && existingIds.has(e.id)).map((e) => e.id));

  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error: delErr } = await db.from('expenses').delete().in('id', toDelete);
    if (delErr) throw new Error(delErr.message);
  }

  const toInsert = cleaned
    .filter((e) => !e.id || !existingIds.has(e.id))
    .map((e) => ({
      shift_id: params.shiftId,
      outlet_id: params.outletId,
      date: params.date,
      shift: params.shift,
      description: e.desc,
      category: e.category,
      amount: e.amount,
      expense_time: e.time,
    }));

  if (toInsert.length > 0) {
    const { error: insErr } = await db.from('expenses').insert(toInsert);
    if (insErr) throw new Error(insErr.message);
  }
}

export async function addCashDropToShift(params: {
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  cashier: string;
  method: string;
  note: string;
  amount: number;
  existingShift: ShiftRecord | null;
}): Promise<void> {
  const timeWib = getCurrentTimeWib();
  const nowIso = new Date().toISOString();

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    let targetShift = local.shifts.find((s) => s.id === params.shiftId);
    if (!targetShift) {
      const prev = await getPreviousBalanceForShift(params.outletId, params.date, params.shift);
      targetShift = {
        id: params.shiftId,
        outletId: params.outletId,
        date: params.date,
        shift: params.shift,
        cashier: params.cashier,
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
      };
      local.shifts.push(targetShift);
    }

    local.cashDrops.push({
      id: crypto.randomUUID(),
      shiftId: params.shiftId,
      outletId: params.outletId,
      date: params.date,
      shift: params.shift,
      method: params.method,
      note: params.note,
      amount: params.amount,
      time: timeWib,
      createdAt: nowIso,
    });

    const totalDrops = local.cashDrops
      .filter((d) => d.shiftId === params.shiftId)
      .reduce((s, d) => s + d.amount, 0);
    targetShift.cashDrop = totalDrops;
    targetShift.balanceChecked = false;
    targetShift.updatedAt = nowIso;
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  if (!params.existingShift) {
    const prev = await getPreviousBalanceForShift(params.outletId, params.date, params.shift);
    const { error: shiftErr } = await db.from('shifts').insert({
      id: params.shiftId,
      outlet_id: params.outletId,
      date: params.date,
      shift: params.shift,
      cashier: params.cashier,
      input_mode: params.shift === 2 ? 'cumulative' : 'standalone',
      opening_cash: prev.amount,
      opening_cash_source: prev.found ? 'carryover' : 'manual',
    });
    if (shiftErr && !shiftErr.message.includes('duplicate')) {
      throw new Error(shiftErr.message);
    }
  }

  const { error: dropErr } = await db.from('cash_drops').insert({
    shift_id: params.shiftId,
    outlet_id: params.outletId,
    date: params.date,
    shift: params.shift,
    method: params.method,
    note: params.note,
    amount: params.amount,
    drop_time: timeWib,
  });
  if (dropErr) throw new Error(dropErr.message);

  const dropRows = await fetchAllSupabaseRows((from, to) =>
    db.from('cash_drops').select('amount').eq('shift_id', params.shiftId).range(from, to)
  );
  const totalDrops = dropRows.reduce((s, r: any) => s + Number(r.amount || 0), 0);
  await db
    .from('shifts')
    .update({ cash_drop: totalDrops, balance_checked: false, updated_at: nowIso })
    .eq('id', params.shiftId);
}

export async function getCashDropById(id: string): Promise<CashDropRecord | null> {
  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const found = local.cashDrops.find((d) => d.id === id);
    if (!found) return null;
    const { createdAt: _c, ...rest } = found;
    return { ...rest };
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db.from('cash_drops').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapCashDropRow(data);
}

export async function deleteCashDropById(drop: CashDropRecord): Promise<void> {
  const nowIso = new Date().toISOString();

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    local.cashDrops = local.cashDrops.filter((d) => d.id !== drop.id);
    const parent = local.shifts.find((s) => s.id === drop.shiftId);
    if (parent) {
      const totalDrops = local.cashDrops
        .filter((d) => d.shiftId === drop.shiftId)
        .reduce((s, d) => s + d.amount, 0);
      parent.cashDrop = totalDrops;
      parent.balanceChecked = false;
      parent.updatedAt = nowIso;
    }
    writeLocalDb(local);
    return;
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from('cash_drops').delete().eq('id', drop.id);
  if (error) throw new Error(error.message);

  const dropRows = await fetchAllSupabaseRows((from, to) =>
    db.from('cash_drops').select('amount').eq('shift_id', drop.shiftId).range(from, to)
  );
  const totalDrops = dropRows.reduce((s, r: any) => s + Number(r.amount || 0), 0);
  await db
    .from('shifts')
    .update({ cash_drop: totalDrops, balance_checked: false, updated_at: nowIso })
    .eq('id', drop.shiftId);
}

export async function syncShiftCashDropsForCorrection(params: {
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  desiredCashDrops: Array<{ id?: string; method: string; note?: string; amount: number; time?: string }>;
}): Promise<number> {
  const cleaned = params.desiredCashDrops
    .map((d) => ({
      id: typeof d.id === 'string' ? d.id : '',
      method: String(d.method || 'Tunai ke Owner').trim() || 'Tunai ke Owner',
      note: String(d.note || '').trim(),
      amount: Math.round(Number(d.amount || 0)),
      time: String(d.time || '').trim() || getCurrentTimeWib(),
    }))
    .filter((d) => d.amount > 0);

  const totalDrops = cleaned.reduce((s, d) => s + d.amount, 0);

  if (isLocalDbEnabled()) {
    const local = readLocalDb();
    const existingForShift = local.cashDrops.filter((d) => d.shiftId === params.shiftId);
    const existingById = new Map(existingForShift.map((d) => [d.id, d]));
    const keepIds = new Set(cleaned.filter((d) => d.id && existingById.has(d.id)).map((d) => d.id));

    local.cashDrops = local.cashDrops.filter((d) => d.shiftId !== params.shiftId || keepIds.has(d.id));

    const nowIso = new Date().toISOString();
    cleaned.forEach((d) => {
      if (!d.id || !existingById.has(d.id)) {
        local.cashDrops.push({
          id: crypto.randomUUID(),
          shiftId: params.shiftId,
          outletId: params.outletId,
          date: params.date,
          shift: params.shift,
          method: d.method,
          note: d.note,
          amount: d.amount,
          time: d.time,
          createdAt: nowIso,
        });
      }
    });

    const parent = local.shifts.find((s) => s.id === params.shiftId);
    if (parent) {
      parent.cashDrop = totalDrops;
      parent.updatedAt = nowIso;
    }
    writeLocalDb(local);
    return totalDrops;
  }

  const db = getSupabaseAdmin();
  const existingRows = await fetchAllSupabaseRows((from, to) =>
    db.from('cash_drops').select('id').eq('shift_id', params.shiftId).range(from, to)
  );
  const existingIds = new Set(existingRows.map((r: any) => String(r.id)));
  const keepIds = new Set(cleaned.filter((d) => d.id && existingIds.has(d.id)).map((d) => d.id));

  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error: delErr } = await db.from('cash_drops').delete().in('id', toDelete);
    if (delErr) throw new Error(delErr.message);
  }

  const toInsert = cleaned
    .filter((d) => !d.id || !existingIds.has(d.id))
    .map((d) => ({
      shift_id: params.shiftId,
      outlet_id: params.outletId,
      date: params.date,
      shift: params.shift,
      method: d.method,
      note: d.note,
      amount: d.amount,
      drop_time: d.time,
    }));

  if (toInsert.length > 0) {
    const { error: insErr } = await db.from('cash_drops').insert(toInsert);
    if (insErr) throw new Error(insErr.message);
  }

  await db
    .from('shifts')
    .update({ cash_drop: totalDrops, updated_at: new Date().toISOString() })
    .eq('id', params.shiftId);

  return totalDrops;
}

export function computePreviousBalanceFromShifts(
  shifts: ShiftRecord[],
  date: string,
  shift: 1 | 2,
  defaultOpeningCash = 0
): PreviousBalanceInfo {
  const preceding = shifts
    .filter((r) => r.date < date || (r.date === date && r.shift < shift))
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.shift - a.shift;
    });

  if (preceding.length > 0) {
    const prev = preceding[0];
    const m = calcShiftMetrics(prev);
    const sameDay = prev.date === date;
    return {
      found: true,
      date: prev.date,
      shift: prev.shift,
      label: sameDay ? `Shift ${prev.shift} hari ini` : `${formatDateIndo(prev.date)} · Shift ${prev.shift}`,
      amount: m.closingCash,
    };
  }

  return {
    found: false,
    label: 'Saldo Awal Pertama Outlet',
    amount: defaultOpeningCash,
  };
}

export async function getPreviousBalanceForShift(
  outletId: string,
  date: string,
  shift: 1 | 2
): Promise<PreviousBalanceInfo> {
  const [allOutletShifts, outlet] = await Promise.all([
    fetchHydratedShifts({ outletId, toDate: date, includeCorrections: false }),
    getOutletById(outletId),
  ]);
  return computePreviousBalanceFromShifts(allOutletShifts, date, shift, outlet?.defaultOpeningCash || 0);
}

export async function getShift1RefInfo(outletId: string, date: string): Promise<Shift1RefInfo> {
  const s1 = await fetchSingleHydratedShift(outletId, date, 1);
  if (!s1) {
    return {
      found: false,
      breakdown: { tunai: 0, qris: 0, online: 0, edc: 0 },
      totalOmset: 0,
      expenses: [],
    };
  }
  const m1 = calcShiftMetrics(s1);
  return {
    found: true,
    breakdown: s1.breakdown,
    totalOmset: m1.totalOmset,
    expenses: s1.expenses,
  };
}

export async function cascadeRunningBalancesInDb(
  outletId: string,
  options?: { includeCorrections?: boolean }
): Promise<ShiftRecord[]> {
  const [shifts, outlet] = await Promise.all([
    fetchHydratedShifts({ outletId, includeCorrections: options?.includeCorrections ?? false }),
    getOutletById(outletId),
  ]);
  const defaultOpeningCash = outlet?.defaultOpeningCash || 0;

  const asc = shifts.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.shift - b.shift;
  });

  const byId = new Map<string, ShiftRecord>();
  asc.forEach((s) => byId.set(s.id, s));

  const local = isLocalDbEnabled() ? readLocalDb() : null;
  const db = isLocalDbEnabled() ? null : getSupabaseAdmin();
  let localMutated = false;
  const pendingDbUpdates: Array<PromiseLike<unknown>> = [];

  let prevClosing: number | null = null;
  for (let i = 0; i < asc.length; i++) {
    const r = asc[i];
    const updates: Record<string, any> = {};

    // Recompute cumulative Shift 2 if Shift 1 exists
    if (r.shift === 2 && r.inputMode === 'cumulative') {
      const s1 = byId.get(makeShiftId(r.outletId, r.date, 1));
      const s1Breakdown = s1 ? s1.breakdown : { tunai: 0, qris: 0, online: 0, edc: 0 };
      const s1Total = s1 ? calcShiftMetrics(s1).totalOmset : 0;
      const recomputed = computeCumulativeShift2Breakdown(
        r.posCumulative,
        s1Breakdown,
        s1Total,
        r.autoTotal
      );
      if (
        recomputed.breakdown.tunai !== r.breakdown.tunai ||
        recomputed.breakdown.qris !== r.breakdown.qris ||
        recomputed.breakdown.online !== r.breakdown.online ||
        recomputed.breakdown.edc !== r.breakdown.edc ||
        recomputed.manualTotalOmset !== r.manualTotalOmset
      ) {
        r.breakdown = recomputed.breakdown;
        r.manualTotalOmset = recomputed.manualTotalOmset;
        updates.tunai = r.breakdown.tunai;
        updates.qris = r.breakdown.qris;
        updates.online_delivery = r.breakdown.online;
        updates.edc_transfer = r.breakdown.edc;
        updates.manual_total_omset = r.manualTotalOmset;
      }
    }

    // Reset earliest shift openingCash to outlet default if it's carryover (e.g. after deleting previous earliest shift)
    if (i === 0 && r.openingCashSource !== 'manual' && r.openingCash !== defaultOpeningCash) {
      r.openingCash = defaultOpeningCash;
      updates.opening_cash = defaultOpeningCash;
    } else if (i > 0 && r.openingCashSource !== 'manual' && prevClosing !== null && r.openingCash !== prevClosing) {
      r.openingCash = prevClosing;
      updates.opening_cash = prevClosing;
    }

    if (Object.keys(updates).length > 0) {
      const nowIso = new Date().toISOString();
      if (local) {
        const target = local.shifts.find((s) => s.id === r.id);
        if (target) {
          target.breakdown = { ...r.breakdown };
          target.manualTotalOmset = r.manualTotalOmset;
          target.openingCash = r.openingCash;
          target.updatedAt = nowIso;
          localMutated = true;
        }
      } else if (db) {
        updates.updated_at = nowIso;
        pendingDbUpdates.push(db.from('shifts').update(updates).eq('id', r.id));
      }
    }

    prevClosing = calcShiftMetrics(r).closingCash;
  }

  if (pendingDbUpdates.length > 0) {
    await Promise.all(pendingDbUpdates);
  }
  if (local && localMutated) {
    writeLocalDb(local);
  }
  return asc;
}

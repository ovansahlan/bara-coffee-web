import type {
  AttendanceShift,
  Breakdown,
  ExpenseRecord,
  PosCumulative,
  ShiftMetrics,
  ShiftRecord,
  ShiftScheduleConfig,
} from './types';

export const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];
export const DEFAULT_EXPENSE_CATEGORIES = ['Minuman', 'Makanan', 'Lain-Lain'];
export const DEFAULT_CASH_DROP_METHODS = ['Tunai ke Owner', 'Transfer Bank', 'Lainnya'];
export const DEFAULT_SHIFT_SCHEDULE: ShiftScheduleConfig = {
  shift1Start: '08:00',
  shift1End: '15:00',
  shift2Start: '15:00',
  shift2End: '22:00',
  lateGraceMinutes: 10,
};

export function getLocalDateStr(offsetDays = 0): string {
  // Default to Asia/Jakarta (WIB) when running on server/UTC so Indonesian coffee shops align with local day
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + wibOffsetMs + offsetDays * 86400000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentTimeWib(): string {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatRp(num: number | null | undefined): string {
  const n = Math.round(Number(num) || 0);
  const abs = Math.abs(n).toLocaleString('id-ID');
  return n < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

export function formatPlain(num: number | null | undefined): string {
  const n = Math.round(Number(num) || 0);
  return n === 0 ? '' : n.toLocaleString('id-ID');
}

export function parseNum(str: string | number | null | undefined): number {
  if (typeof str === 'number') return Math.round(str);
  const cleaned = String(str || '').replace(/[^0-9]/g, '');
  return cleaned ? parseInt(cleaned, 10) : 0;
}

export function parseNullableNum(str: string | number | null | undefined): number | null {
  if (str === null || str === undefined) return null;
  if (typeof str === 'number') return Math.round(str);
  const cleaned = String(str).replace(/[^0-9]/g, '');
  return cleaned === '' ? null : parseInt(cleaned, 10);
}

export function formatDateIndo(dateStr: string): string {
  if (!dateStr) return '-';
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d} ${months[(m || 1) - 1]} ${y}`;
}

export function formatDateTimeShort(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const ds = `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}-${String(wib.getUTCDate()).padStart(2, '0')}`;
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${formatDateIndo(ds)} ${hh}:${mm}`;
}

export function makeShiftId(outletId: string, date: string, shift: 1 | 2): string {
  return `${outletId}__${date}__${shift}`;
}

export function calcShiftMetrics(
  rec: Pick<
    ShiftRecord,
    'breakdown' | 'autoTotal' | 'manualTotalOmset' | 'expenses' | 'openingCash' | 'cashDrop' | 'actualCash' | 'balanceChecked'
  > & { cashDrops?: ShiftRecord['cashDrops']; drawerKasbon?: number }
): ShiftMetrics {
  const b = rec.breakdown || { tunai: 0, qris: 0, online: 0, edc: 0 };
  const sumBreakdown = (b.tunai || 0) + (b.qris || 0) + (b.online || 0) + (b.edc || 0);
  const totalOmset = rec.autoTotal !== false ? sumBreakdown : (rec.manualTotalOmset || 0);
  const breakdownDiff = totalOmset - sumBreakdown;
  const totalExpense = (rec.expenses || []).reduce((acc, item) => acc + (item.amount || 0), 0);
  const openingCash = rec.openingCash || 0;
  const cashDrop =
    Array.isArray(rec.cashDrops) && rec.cashDrops.length > 0
      ? rec.cashDrops.reduce((acc, item) => acc + (item.amount || 0), 0)
      : rec.cashDrop || 0;
  const drawerKasbon = Math.max(0, Math.round(Number(rec.drawerKasbon || 0)));
  const accumulatedCash = openingCash + (b.tunai || 0);
  const expectedCash = accumulatedCash - totalExpense - cashDrop - drawerKasbon;
  const hasActual = rec.actualCash !== null && rec.actualCash !== undefined;
  const diff = hasActual ? (Number(rec.actualCash) - expectedCash) : null;
  const closingCash = (rec.balanceChecked && hasActual) ? Number(rec.actualCash) : expectedCash;

  let status: ShiftMetrics['status'] = 'draft';
  if (rec.balanceChecked && hasActual) {
    if (diff === 0) status = 'balanced';
    else if ((diff ?? 0) > 0) status = 'surplus';
    else status = 'deficit';
  }

  return {
    sumBreakdown,
    totalOmset,
    breakdownDiff,
    totalExpense,
    openingCash,
    cashDrop,
    drawerKasbon,
    accumulatedCash,
    expectedCash,
    closingCash,
    hasActual,
    diff,
    status,
  };
}

export function computeCumulativeShift2Breakdown(
  posCumulative: PosCumulative,
  shift1Breakdown: Breakdown,
  shift1TotalOmset: number,
  autoTotal: boolean
): { breakdown: Breakdown; manualTotalOmset: number } {
  const breakdown: Breakdown = { tunai: 0, qris: 0, online: 0, edc: 0 };
  (['tunai', 'qris', 'online', 'edc'] as const).forEach((k) => {
    const raw = posCumulative[k];
    breakdown[k] = raw === null || raw === undefined ? 0 : Math.max(0, Number(raw) - (shift1Breakdown[k] || 0));
  });
  const manualTotalOmset =
    !autoTotal && posCumulative.total !== null && posCumulative.total !== undefined
      ? Math.max(0, Number(posCumulative.total) - shift1TotalOmset)
      : 0;
  return { breakdown, manualTotalOmset };
}

export function sanitizeNullableNonNegInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

export function getCumulativeUnderflows(
  posCumulative: PosCumulative,
  shift1Breakdown: Breakdown,
  shift1TotalOmset?: number,
  autoTotal = true
): Array<{ key: keyof Breakdown | 'total'; label: string; entered: number; shift1: number }> {
  const labels: Record<keyof Breakdown, string> = {
    tunai: 'Tunai',
    qris: 'QRIS',
    online: 'Online Delivery',
    edc: 'EDC/Transfer',
  };
  const issues: Array<{ key: keyof Breakdown | 'total'; label: string; entered: number; shift1: number }> = [];
  (['tunai', 'qris', 'online', 'edc'] as const).forEach((k) => {
    const raw = posCumulative[k];
    if (raw !== null && raw !== undefined && Number(raw) < (shift1Breakdown[k] || 0)) {
      issues.push({ key: k, label: labels[k], entered: Number(raw), shift1: shift1Breakdown[k] || 0 });
    }
  });
  if (
    !autoTotal &&
    typeof shift1TotalOmset === 'number' &&
    posCumulative.total !== null &&
    posCumulative.total !== undefined &&
    Number(posCumulative.total) < shift1TotalOmset
  ) {
    issues.push({
      key: 'total',
      label: 'Total Omset',
      entered: Number(posCumulative.total),
      shift1: shift1TotalOmset,
    });
  }
  return issues;
}

export function normalizeTextTokens(str: string): string[] {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

export function findDuplicateExpenseInList(
  expensesToday: Array<ExpenseRecord & { cashier?: string }>,
  desc: string,
  category: string,
  amount: number
): (ExpenseRecord & { cashier?: string }) | null {
  const newNorm = desc.trim().toLowerCase();
  const newTokens = new Set(normalizeTextTokens(desc));

  for (const exp of expensesToday) {
    if ((exp.amount || 0) !== amount) continue;
    const expNorm = (exp.desc || '').trim().toLowerCase();
    const sameDesc = expNorm === newNorm || expNorm.includes(newNorm) || newNorm.includes(expNorm);
    const sharedWord = normalizeTextTokens(exp.desc).some((t) => newTokens.has(t));
    const sameCat = (exp.category || '') === category;
    if (sameDesc || sharedWord || sameCat) {
      return exp;
    }
  }
  return null;
}

export function buildCorrectionChanges(beforeRec: ShiftRecord, afterRec: ShiftRecord): string[] {
  const mb = calcShiftMetrics(beforeRec);
  const ma = calcShiftMetrics(afterRec);
  const diffs: string[] = [];
  const check = (label: string, v1: number | null | undefined, v2: number | null | undefined) => {
    if ((v1 || 0) !== (v2 || 0)) {
      diffs.push(`${label}: ${formatRp(v1)} → ${formatRp(v2)}`);
    }
  };
  check('Total Omset', mb.totalOmset, ma.totalOmset);
  check('Tunai', beforeRec.breakdown.tunai, afterRec.breakdown.tunai);
  check('QRIS', beforeRec.breakdown.qris, afterRec.breakdown.qris);
  check('Online', beforeRec.breakdown.online, afterRec.breakdown.online);
  check('EDC/Tf', beforeRec.breakdown.edc, afterRec.breakdown.edc);
  check('Pengeluaran', mb.totalExpense, ma.totalExpense);
  check('Setor Owner', mb.cashDrop, ma.cashDrop);
  check('Saldo Akhir', mb.expectedCash, ma.expectedCash);
  check('Uang Fisik', beforeRec.actualCash, afterRec.actualCash);
  return diffs;
}

export function parseHhMmToMinutes(hhmm: string): number {
  const [h, m] = String(hhmm || '00:00').split(':').map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

export function getWibMinutesFromIso(isoStr: string): number {
  const d = new Date(isoStr);
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours() * 60 + wib.getUTCMinutes();
}

export function formatTimeWibFromIso(isoStr: string | null | undefined): string {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '-';
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')}`;
}

export function formatAttendanceShiftLabel(shift: AttendanceShift): string {
  if (shift === 3) return 'Full Shift';
  return `Shift ${shift}`;
}

export function computeAttendanceTiming(params: {
  shift: AttendanceShift;
  checkInAt: string | null;
  checkOutAt: string | null;
  schedule?: ShiftScheduleConfig;
}): { lateMinutes: number; workMinutes: number; overtimeMinutes: number } {
  const sched = params.schedule || DEFAULT_SHIFT_SCHEDULE;
  const startMin = parseHhMmToMinutes(params.shift === 2 ? sched.shift2Start : sched.shift1Start);
  const endMin = parseHhMmToMinutes(params.shift === 1 ? sched.shift1End : sched.shift2End);
  const grace = Math.max(0, Number(sched.lateGraceMinutes || 0));

  let lateMinutes = 0;
  if (params.checkInAt) {
    const inMin = getWibMinutesFromIso(params.checkInAt);
    const diff = inMin - startMin;
    lateMinutes = diff > grace ? diff : 0;
  }

  let workMinutes = 0;
  let overtimeMinutes = 0;
  if (params.checkInAt && params.checkOutAt) {
    const ms = new Date(params.checkOutAt).getTime() - new Date(params.checkInAt).getTime();
    workMinutes = Math.max(0, Math.round(ms / 60000));
    if (params.shift === 3) {
      // Full Shift: overtime is work time beyond 1 standard shift duration
      const s1Start = parseHhMmToMinutes(sched.shift1Start);
      const s1End = parseHhMmToMinutes(sched.shift1End);
      const normalShiftMinutes = Math.max(60, s1End > s1Start ? s1End - s1Start : 420);
      overtimeMinutes = Math.max(0, workMinutes - normalShiftMinutes);
    } else {
      const outMin = getWibMinutesFromIso(params.checkOutAt);
      if (outMin > endMin) {
        overtimeMinutes = outMin - endMin;
      }
    }
  }

  return { lateMinutes, workMinutes, overtimeMinutes };
}

export function getMonthRangeWib(): { fromDate: string; toDate: string; label: string } {
  const today = getLocalDateStr(0);
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  return {
    fromDate: `${y}-${String(m).padStart(2, '0')}-01`,
    toDate: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    label: `${months[(m || 1) - 1]} ${y}`,
  };
}

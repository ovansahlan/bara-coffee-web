export type UserRole = 'owner' | 'outlet' | 'crew';

export interface SessionPayload {
  role: UserRole;
  outletId: string | null;
  employeeId?: string | null;
  exp: number;
}

export interface OutletPublic {
  id: string;
  name: string;
  location: string;
  defaultOpeningCash: number;
  sortOrder: number;
}

export interface OutletAdmin extends OutletPublic {
  pin: string;
}

export interface PosCumulative {
  tunai: number | null;
  qris: number | null;
  online: number | null;
  edc: number | null;
  total: number | null;
}

export interface Breakdown {
  tunai: number;
  qris: number;
  online: number;
  edc: number;
}

export interface ExpenseRecord {
  id: string;
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  desc: string;
  category: string;
  amount: number;
  time: string;
}

export interface CashDropRecord {
  id: string;
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  method: string;
  note: string;
  amount: number;
  time: string;
}

export interface CorrectionLogRecord {
  id: string;
  shiftId: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  actor: string;
  reason: string;
  changes: string[];
  at: string;
}

export interface ShiftRecord {
  id: string;
  outletId: string;
  date: string;
  shift: 1 | 2;
  cashier: string;
  inputMode: 'standalone' | 'cumulative';
  posCumulative: PosCumulative;
  autoTotal: boolean;
  manualTotalOmset: number;
  breakdown: Breakdown;
  openingCash: number;
  openingCashSource: 'carryover' | 'manual';
  cashDrop: number;
  drawerKasbon?: number;
  actualCash: number | null;
  denomCounts: Record<string, number>;
  balanceChecked: boolean;
  balanceNote: string;
  checkedAt: string | null;
  expenses: ExpenseRecord[];
  cashDrops: CashDropRecord[];
  correctionLogs: CorrectionLogRecord[];
}

export interface ShiftMetrics {
  sumBreakdown: number;
  totalOmset: number;
  breakdownDiff: number;
  totalExpense: number;
  openingCash: number;
  cashDrop: number;
  drawerKasbon: number;
  accumulatedCash: number;
  expectedCash: number;
  closingCash: number;
  hasActual: boolean;
  diff: number | null;
  status: 'draft' | 'balanced' | 'surplus' | 'deficit';
}

export interface PreviousBalanceInfo {
  found: boolean;
  date?: string;
  shift?: 1 | 2;
  label: string;
  amount: number;
}

export interface Shift1RefInfo {
  found: boolean;
  breakdown: Breakdown;
  totalOmset: number;
  expenses: ExpenseRecord[];
}

export interface ShiftScheduleConfig {
  shift1Start: string; // HH:mm e.g. '08:00'
  shift1End: string;   // HH:mm e.g. '15:00'
  shift2Start: string; // HH:mm e.g. '15:00'
  shift2End: string;   // HH:mm e.g. '22:00'
  lateGraceMinutes: number;
}

export interface AppSettingsPublic {
  expenseCategories: string[];
  requireOwnerPinForCorrection: boolean;
  shiftSchedule?: ShiftScheduleConfig;
}

export interface AppSettingsAdmin extends AppSettingsPublic {
  ownerPin: string;
  googleSheetsWebhookUrl?: string;
  googleSheetsAutoSync?: boolean;
  googleSheetsLastSync?: string | null;
}

export type PayType = 'monthly' | 'daily';

export interface EmployeePublic {
  id: string;
  name: string;
  roleTitle: string;
  outletId: string; // outlet id or 'all' (rolling)
  payType: PayType;
  active: boolean;
}

export interface EmployeeAdmin extends EmployeePublic {
  pin: string;
  baseSalary: number;        // untuk monthly (gaji pokok bulanan)
  dailyRate: number;         // untuk daily / part-time harian
  mealAllowance: number;     // uang makan/transport per hari hadir
  overtimeRatePerHour: number;
  latePenalty: number;       // denda per keterlambatan (opsional, default 0)
  kasbonLimit: number;       // batas maksimal kasbon aktif (0 = tanpa batas)
}

export type AttendanceStatus = 'hadir' | 'telat' | 'izin' | 'sakit' | 'alpha';
export type AttendanceShift = 1 | 2 | 3; // 1 = Shift 1, 2 = Shift 2, 3 = Full Shift

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  outletId: string;
  date: string;
  shift: AttendanceShift;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInPhoto: string | null;  // compressed base64 JPEG data URL
  checkOutPhoto: string | null;
  status: AttendanceStatus;
  lateMinutes: number;
  overtimeMinutes: number;
  workMinutes: number;
  note: string;
}

export type CashAdvanceSource = 'drawer' | 'owner_transfer' | 'mixed';
export type CashAdvanceStatus = 'unpaid' | 'partial' | 'paid';
export type CashAdvanceType = 'kasbon' | 'loan';

export interface CashAdvanceRepayment {
  id: string;
  cashAdvanceId: string;
  amount: number;
  method: 'payroll' | 'cash_return' | 'transfer_return';
  payrollRunId?: string | null;
  note: string;
  date: string;
  at: string;
}

export interface CashAdvanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  outletId: string;
  shiftId: string | null;
  date: string;
  shift: 1 | 2;
  type?: CashAdvanceType;          // 'kasbon' = kasbon harian biasa; 'loan' = pinjaman berjangka dicicil
  tenorMonths?: number;            // 1 untuk kasbon; >= 2 untuk pinjaman berjangka
  installmentAmount?: number;      // cicilan per bulan untuk pinjaman berjangka (0 untuk kasbon biasa)
  amount: number;                  // total kasbon/pinjaman = drawerAmount + ownerTransferAmount
  drawerAmount: number;            // diambil dari laci kasir (mengurangi saldo laci shift)
  ownerTransferAmount: number;     // ditransfer/dibayar langsung oleh Owner
  source: CashAdvanceSource;
  note: string;
  time: string;
  createdBy: string;
  repayments: CashAdvanceRepayment[];
  paidAmount: number;
  remainingAmount: number;
  status: CashAdvanceStatus;
}

export interface PayrollItemRecord {
  employeeId: string;
  employeeName: string;
  roleTitle: string;
  outletId: string;
  payType: PayType;
  daysPresent: number;
  fullShiftCount?: number;
  lateCount: number;
  absentCount: number;
  overtimeHours: number;
  basePay: number;
  mealTotal: number;
  overtimePay: number;
  bonus: number;
  lateDeduction: number;
  kasbonDeduction: number;
  suggestedKasbonDeduction?: number;
  otherDeduction: number;
  grossPay: number;
  netPay: number;
  activeKasbonBefore: number;
  note: string;
}

export interface PayrollRunRecord {
  id: string;
  periodLabel: string;
  fromDate: string;
  toDate: string;
  outletId: string; // 'all' or specific outlet
  status: 'draft' | 'paid';
  items: PayrollItemRecord[];
  totalGross: number;
  totalKasbonDeducted: number;
  totalNet: number;
  createdAt: string;
  paidAt: string | null;
}

export interface CrewPayslipEntry {
  payrollId: string;
  periodLabel: string;
  fromDate: string;
  toDate: string;
  paidAt: string | null;
  item: PayrollItemRecord;
}

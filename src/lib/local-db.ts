import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_SHIFT_SCHEDULE, getLocalDateStr, makeShiftId } from './calc';
import type {
  AppSettingsAdmin,
  AttendanceRecord,
  CashAdvanceRecord,
  CashDropRecord,
  CorrectionLogRecord,
  EmployeeAdmin,
  ExpenseRecord,
  OutletAdmin,
  OwnerExpenseRecord,
  PayrollRunRecord,
  ShiftRecord,
} from './types';

export interface LocalDbData {
  settings: AppSettingsAdmin;
  outlets: OutletAdmin[];
  shifts: Array<Omit<ShiftRecord, 'expenses' | 'cashDrops' | 'correctionLogs' | 'drawerKasbon'> & { updatedAt: string }>;
  expenses: Array<ExpenseRecord & { createdAt: string }>;
  cashDrops: Array<CashDropRecord & { createdAt: string }>;
  correctionLogs: CorrectionLogRecord[];
  employees: EmployeeAdmin[];
  attendances: Array<Omit<AttendanceRecord, 'employeeName'> & { createdAt: string }>;
  cashAdvances: Array<
    Omit<CashAdvanceRecord, 'employeeName' | 'paidAmount' | 'remainingAmount' | 'status'> & { createdAt: string }
  >;
  payrolls: PayrollRunRecord[];
  ownerExpenses?: OwnerExpenseRecord[];
}

const LOCAL_DB_DIR = path.join(process.cwd(), '.local-data');
const LOCAL_DB_FILE = path.join(LOCAL_DB_DIR, 'bara-coffee-db.json');

export function isLocalDbEnabled(): boolean {
  return process.env.USE_LOCAL_DB === 'true' || process.env.USE_LOCAL_DB === '1';
}

export function getLocalDbPath(): string {
  return LOCAL_DB_FILE;
}

function buildSeedData(): LocalDbData {
  const yesterday = getLocalDateStr(-1);
  const today = getLocalDateStr(0);
  const nowIso = new Date().toISOString();

  const o1YestS1 = makeShiftId('outlet-1', yesterday, 1);
  const o1YestS2 = makeShiftId('outlet-1', yesterday, 2);
  const o1TodayS1 = makeShiftId('outlet-1', today, 1);
  const o2YestS1 = makeShiftId('outlet-2', yesterday, 1);
  const o2TodayS1 = makeShiftId('outlet-2', today, 1);

  return {
    settings: {
      ownerPin: '9999',
      requireOwnerPinForCorrection: false,
      expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
      shiftSchedule: { ...DEFAULT_SHIFT_SCHEDULE },
    },
    outlets: [
      {
        id: 'outlet-1',
        name: 'Bara Coffee - Outlet 1',
        location: 'Pusat',
        defaultOpeningCash: 300000,
        sortOrder: 1,
        pin: '1111',
      },
      {
        id: 'outlet-2',
        name: 'Bara Coffee - Outlet 2',
        location: 'Cabang',
        defaultOpeningCash: 250000,
        sortOrder: 2,
        pin: '2222',
      },
    ],
    shifts: [
      {
        id: o1YestS1,
        outletId: 'outlet-1',
        date: yesterday,
        shift: 1,
        cashier: 'Rina',
        inputMode: 'standalone',
        posCumulative: { tunai: null, qris: null, online: null, edc: null, total: null },
        autoTotal: true,
        manualTotalOmset: 0,
        breakdown: { tunai: 450000, qris: 620000, online: 280000, edc: 150000 },
        openingCash: 300000,
        openingCashSource: 'manual',
        cashDrop: 0,
        actualCash: 685000,
        denomCounts: {},
        balanceChecked: true,
        balanceNote: 'Shift pagi cocok semua.',
        checkedAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: o1YestS2,
        outletId: 'outlet-1',
        date: yesterday,
        shift: 2,
        cashier: 'Budi',
        inputMode: 'cumulative',
        posCumulative: { tunai: 1050000, qris: 1520000, online: 630000, edc: 350000, total: null },
        autoTotal: true,
        manualTotalOmset: 0,
        breakdown: { tunai: 600000, qris: 900000, online: 350000, edc: 200000 },
        openingCash: 685000,
        openingCashSource: 'carryover',
        cashDrop: 700000,
        actualCash: 540000,
        denomCounts: {},
        balanceChecked: true,
        balanceNote: 'Setor owner Rp 700.000 via kasir sore.',
        checkedAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: o1TodayS1,
        outletId: 'outlet-1',
        date: today,
        shift: 1,
        cashier: 'Rina',
        inputMode: 'standalone',
        posCumulative: { tunai: null, qris: null, online: null, edc: null, total: null },
        autoTotal: true,
        manualTotalOmset: 0,
        breakdown: { tunai: 520000, qris: 780000, online: 310000, edc: 190000 },
        openingCash: 540000,
        openingCashSource: 'carryover',
        cashDrop: 0,
        actualCash: 1005000,
        denomCounts: {},
        balanceChecked: true,
        balanceNote: 'Balance pagi.',
        checkedAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: o2YestS1,
        outletId: 'outlet-2',
        date: yesterday,
        shift: 1,
        cashier: 'Dina',
        inputMode: 'standalone',
        posCumulative: { tunai: null, qris: null, online: null, edc: null, total: null },
        autoTotal: true,
        manualTotalOmset: 0,
        breakdown: { tunai: 380000, qris: 510000, online: 220000, edc: 90000 },
        openingCash: 250000,
        openingCashSource: 'manual',
        cashDrop: 0,
        actualCash: 590000,
        denomCounts: {},
        balanceChecked: true,
        balanceNote: 'Selisih kurang Rp 5.000 receh kembalian.',
        checkedAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: o2TodayS1,
        outletId: 'outlet-2',
        date: today,
        shift: 1,
        cashier: 'Dina',
        inputMode: 'standalone',
        posCumulative: { tunai: null, qris: null, online: null, edc: null, total: null },
        autoTotal: true,
        manualTotalOmset: 0,
        breakdown: { tunai: 410000, qris: 590000, online: 185000, edc: 120000 },
        openingCash: 590000,
        openingCashSource: 'carryover',
        cashDrop: 0,
        actualCash: null,
        denomCounts: {},
        balanceChecked: false,
        balanceNote: '',
        checkedAt: null,
        updatedAt: nowIso,
      },
    ],
    expenses: [
      {
        id: crypto.randomUUID(),
        shiftId: o1YestS1,
        outletId: 'outlet-1',
        date: yesterday,
        shift: 1,
        desc: 'Es batu kristal 2 karung',
        category: 'Minuman',
        amount: 40000,
        time: '09:15',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        shiftId: o1YestS1,
        outletId: 'outlet-1',
        date: yesterday,
        shift: 1,
        desc: 'Tisu meja & sedotan',
        category: 'Lain-Lain',
        amount: 25000,
        time: '11:30',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        shiftId: o1YestS2,
        outletId: 'outlet-1',
        date: yesterday,
        shift: 2,
        desc: 'Susu UHT 2 karton kecil',
        category: 'Minuman',
        amount: 45000,
        time: '16:20',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        shiftId: o1TodayS1,
        outletId: 'outlet-1',
        date: today,
        shift: 1,
        desc: 'Roti toast & mentega',
        category: 'Makanan',
        amount: 55000,
        time: '08:45',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        shiftId: o2YestS1,
        outletId: 'outlet-2',
        date: yesterday,
        shift: 1,
        desc: 'Es batu & galon air',
        category: 'Minuman',
        amount: 35000,
        time: '10:05',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        shiftId: o2TodayS1,
        outletId: 'outlet-2',
        date: today,
        shift: 1,
        desc: 'Gula aren cair 1 liter',
        category: 'Minuman',
        amount: 42000,
        time: '09:30',
        createdAt: nowIso,
      },
    ],
    cashDrops: [
      {
        id: crypto.randomUUID(),
        shiftId: o1YestS2,
        outletId: 'outlet-1',
        date: yesterday,
        shift: 2,
        method: 'Transfer Bank',
        note: 'Setor tunai via transfer BCA harian',
        amount: 500000,
        time: '20:30',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        shiftId: o1YestS2,
        outletId: 'outlet-1',
        date: yesterday,
        shift: 2,
        method: 'Tunai ke Owner',
        note: 'Diambil langsung Owner saat closing',
        amount: 200000,
        time: '21:45',
        createdAt: nowIso,
      },
    ],
    correctionLogs: [],
    employees: [
      {
        id: 'emp-rina',
        name: 'Rina',
        roleTitle: 'Head Barista',
        outletId: 'outlet-1',
        payType: 'monthly',
        pin: '1001',
        baseSalary: 2800000,
        dailyRate: 0,
        mealAllowance: 20000,
        overtimeRatePerHour: 20000,
        latePenalty: 10000,
        kasbonLimit: 1000000,
        active: true,
      },
      {
        id: 'emp-budi',
        name: 'Budi',
        roleTitle: 'Barista Part-Time',
        outletId: 'outlet-1',
        payType: 'daily',
        pin: '1002',
        baseSalary: 0,
        dailyRate: 110000,
        mealAllowance: 15000,
        overtimeRatePerHour: 15000,
        latePenalty: 5000,
        kasbonLimit: 500000,
        active: true,
      },
      {
        id: 'emp-dina',
        name: 'Dina',
        roleTitle: 'Barista & Kasir',
        outletId: 'outlet-2',
        payType: 'monthly',
        pin: '2001',
        baseSalary: 2500000,
        dailyRate: 0,
        mealAllowance: 20000,
        overtimeRatePerHour: 18000,
        latePenalty: 10000,
        kasbonLimit: 800000,
        active: true,
      },
    ],
    attendances: [
      {
        id: crypto.randomUUID(),
        employeeId: 'emp-rina',
        outletId: 'outlet-1',
        date: yesterday,
        shift: 1,
        checkInAt: `${yesterday}T00:55:00.000Z`, // 07:55 WIB
        checkOutAt: `${yesterday}T08:10:00.000Z`, // 15:10 WIB
        checkInPhoto: null,
        checkOutPhoto: null,
        status: 'hadir',
        lateMinutes: 0,
        overtimeMinutes: 10,
        workMinutes: 435,
        note: 'Hadir tepat waktu',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        employeeId: 'emp-budi',
        outletId: 'outlet-1',
        date: yesterday,
        shift: 2,
        checkInAt: `${yesterday}T08:15:00.000Z`, // 15:15 WIB (telat 15 mnt)
        checkOutAt: `${yesterday}T15:30:00.000Z`, // 22:30 WIB (lembur 30 mnt)
        checkInPhoto: null,
        checkOutPhoto: null,
        status: 'telat',
        lateMinutes: 15,
        overtimeMinutes: 30,
        workMinutes: 435,
        note: 'Macet hujan',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        employeeId: 'emp-dina',
        outletId: 'outlet-2',
        date: yesterday,
        shift: 1,
        checkInAt: `${yesterday}T00:58:00.000Z`,
        checkOutAt: `${yesterday}T08:00:00.000Z`,
        checkInPhoto: null,
        checkOutPhoto: null,
        status: 'hadir',
        lateMinutes: 0,
        overtimeMinutes: 0,
        workMinutes: 422,
        note: '',
        createdAt: nowIso,
      },
      {
        id: crypto.randomUUID(),
        employeeId: 'emp-rina',
        outletId: 'outlet-1',
        date: today,
        shift: 1,
        checkInAt: `${today}T00:52:00.000Z`,
        checkOutAt: `${today}T08:05:00.000Z`,
        checkInPhoto: null,
        checkOutPhoto: null,
        status: 'hadir',
        lateMinutes: 0,
        overtimeMinutes: 5,
        workMinutes: 433,
        note: '',
        createdAt: nowIso,
      },
    ],
    cashAdvances: [
      {
        id: crypto.randomUUID(),
        employeeId: 'emp-budi',
        outletId: 'outlet-1',
        shiftId: null,
        date: yesterday,
        shift: 2,
        type: 'kasbon',
        tenorMonths: 1,
        installmentAmount: 0,
        amount: 250000,
        drawerAmount: 0,
        ownerTransferAmount: 250000,
        source: 'owner_transfer',
        note: 'Kasbon servis motor (transfer BCA Owner)',
        time: '17:10',
        createdBy: 'Owner',
        repayments: [],
        createdAt: nowIso,
      },
      {
        id: 'loan-seed-rina',
        employeeId: 'emp-rina',
        outletId: 'outlet-1',
        shiftId: null,
        date: getLocalDateStr(-30),
        shift: 1,
        type: 'loan',
        tenorMonths: 10,
        installmentAmount: 300000,
        amount: 3000000,
        drawerAmount: 0,
        ownerTransferAmount: 3000000,
        source: 'owner_transfer',
        note: 'Pinjaman darurat keluarga (cicilan 10 bulan)',
        time: '10:00',
        createdBy: 'Owner',
        repayments: [
          {
            id: crypto.randomUUID(),
            cashAdvanceId: 'loan-seed-rina',
            amount: 300000,
            method: 'payroll',
            payrollRunId: 'pay-seed-prev-month',
            note: 'Cicilan ke-1 (Payroll)',
            date: getLocalDateStr(-2),
            at: nowIso,
          },
        ],
        createdAt: nowIso,
      },
    ],
    payrolls: [
      {
        id: 'pay-seed-prev-month',
        periodLabel: 'Periode Bulan Lalu (Contoh)',
        fromDate: getLocalDateStr(-30),
        toDate: getLocalDateStr(-2),
        outletId: 'all',
        status: 'paid',
        items: [
          {
            employeeId: 'emp-rina',
            employeeName: 'Rina',
            roleTitle: 'Head Barista',
            outletId: 'outlet-1',
            payType: 'monthly',
            daysPresent: 25,
            lateCount: 1,
            absentCount: 0,
            overtimeHours: 3.5,
            basePay: 2800000,
            mealTotal: 500000,
            overtimePay: 70000,
            bonus: 150000,
            lateDeduction: 10000,
            kasbonDeduction: 0,
            otherDeduction: 0,
            grossPay: 3520000,
            netPay: 3510000,
            activeKasbonBefore: 0,
            note: 'Bonus target omset bulan lalu',
          },
          {
            employeeId: 'emp-budi',
            employeeName: 'Budi',
            roleTitle: 'Barista Part-Time',
            outletId: 'outlet-1',
            payType: 'daily',
            daysPresent: 14,
            lateCount: 0,
            absentCount: 0,
            overtimeHours: 2,
            basePay: 1540000,
            mealTotal: 210000,
            overtimePay: 30000,
            bonus: 0,
            lateDeduction: 0,
            kasbonDeduction: 0,
            otherDeduction: 0,
            grossPay: 1780000,
            netPay: 1780000,
            activeKasbonBefore: 0,
            note: '14 shift hadir part-time',
          },
          {
            employeeId: 'emp-dina',
            employeeName: 'Dina',
            roleTitle: 'Barista & Kasir',
            outletId: 'outlet-2',
            payType: 'monthly',
            daysPresent: 24,
            lateCount: 0,
            absentCount: 0,
            overtimeHours: 1,
            basePay: 2500000,
            mealTotal: 480000,
            overtimePay: 18000,
            bonus: 100000,
            lateDeduction: 0,
            kasbonDeduction: 0,
            otherDeduction: 0,
            grossPay: 3098000,
            netPay: 3098000,
            activeKasbonBefore: 0,
            note: '',
          },
        ],
        totalGross: 8398000,
        totalKasbonDeducted: 0,
        totalNet: 8388000,
        createdAt: nowIso,
        paidAt: nowIso,
      },
    ],
  };
}

export function readLocalDb(): LocalDbData {
  if (!fs.existsSync(LOCAL_DB_DIR)) {
    fs.mkdirSync(LOCAL_DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_DB_FILE)) {
    const seed = buildSeedData();
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  try {
    const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LocalDbData;
    return {
      settings: {
        ownerPin: parsed.settings?.ownerPin || '9999',
        requireOwnerPinForCorrection: Boolean(parsed.settings?.requireOwnerPinForCorrection),
        expenseCategories:
          Array.isArray(parsed.settings?.expenseCategories) && parsed.settings.expenseCategories.length > 0
            ? parsed.settings.expenseCategories
            : [...DEFAULT_EXPENSE_CATEGORIES],
        shiftSchedule: parsed.settings?.shiftSchedule || { ...DEFAULT_SHIFT_SCHEDULE },
      },
      outlets: Array.isArray(parsed.outlets) ? parsed.outlets : [],
      shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      cashDrops: Array.isArray(parsed.cashDrops) ? parsed.cashDrops : [],
      correctionLogs: Array.isArray(parsed.correctionLogs) ? parsed.correctionLogs : [],
      employees: Array.isArray(parsed.employees) ? parsed.employees : buildSeedData().employees,
      attendances: Array.isArray(parsed.attendances) ? parsed.attendances : [],
      cashAdvances: Array.isArray(parsed.cashAdvances) ? parsed.cashAdvances : [],
      payrolls: Array.isArray(parsed.payrolls) ? parsed.payrolls : [],
    };
  } catch {
    const seed = buildSeedData();
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
}

export function writeLocalDb(data: LocalDbData): void {
  if (!fs.existsSync(LOCAL_DB_DIR)) {
    fs.mkdirSync(LOCAL_DB_DIR, { recursive: true });
  }
  const tmpFile = `${LOCAL_DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, LOCAL_DB_FILE);
}

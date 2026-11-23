import {
  calcShiftMetrics,
  formatAttendanceShiftLabel,
  formatTimeWibFromIso,
} from './calc';
import {
  fetchHydratedShifts,
  getAppSettings,
  getOutletsAdmin,
  updateAppSettings,
} from './db';
import {
  fetchAttendances,
  fetchCashAdvances,
  fetchOwnerExpenses,
  fetchPayrolls,
} from './hr-db';

export interface GoogleSheetsSyncResult {
  ok: boolean;
  skipped?: boolean;
  counts?: Record<string, number>;
  syncedAt?: string;
  error?: string;
}

export async function buildGoogleSheetsSyncPayload() {
  const [outlets, settings, shifts, attendances, cashAdvances, payrolls, ownerExpenses] = await Promise.all([
    getOutletsAdmin(),
    getAppSettings(),
    fetchHydratedShifts({ includeCorrections: false }),
    fetchAttendances({}),
    fetchCashAdvances({}),
    fetchPayrolls(),
    fetchOwnerExpenses({}).catch(() => []),
  ]);

  const outletNameById = new Map(outlets.map((o) => [o.id, o.name]));
  const resolveOutletName = (oid: string) =>
    oid === 'all' ? 'Semua Outlet (Rolling)' : outletNameById.get(oid) || oid;

  const statusLabel = (st: string) => {
    if (st === 'balanced') return 'Sesuai';
    if (st === 'surplus') return 'Surplus';
    if (st === 'deficit') return 'Defisit';
    return 'Draft';
  };

  // 1. Transaksi_Harian
  const transaksiRows = [...shifts]
    .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.shift - a.shift))
    .map((s) => {
      const m = calcShiftMetrics(s);
      return [
        s.date,
        resolveOutletName(s.outletId),
        `Shift ${s.shift}`,
        s.cashier || '-',
        s.inputMode === 'cumulative' ? 'Kumulatif POS' : 'Standalone',
        m.openingCash,
        s.breakdown.tunai,
        s.breakdown.qris,
        s.breakdown.online,
        s.breakdown.edc,
        m.totalOmset,
        m.totalExpense,
        m.drawerKasbon,
        m.cashDrop,
        m.expectedCash,
        s.actualCash === null ? '' : s.actualCash,
        m.diff === null ? '' : m.diff,
        statusLabel(m.status),
        s.balanceNote || '',
      ];
    });

  // 2. Pembelanjaan
  const pembelanjaanRows = shifts
    .flatMap((s) =>
      s.expenses.map((e) => [
        e.date,
        e.time || '-',
        resolveOutletName(e.outletId),
        `Shift ${e.shift}`,
        e.category,
        e.desc,
        e.amount,
      ])
    )
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  // 3. Setor_Owner_Bank
  const setorRows = shifts
    .flatMap((s) =>
      s.cashDrops.map((d) => [
        d.date,
        d.time || '-',
        resolveOutletName(d.outletId),
        `Shift ${d.shift}`,
        d.method,
        d.note || '',
        d.amount,
      ])
    )
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  // 4. Absensi
  const absensiRows = attendances.map((a) => [
    a.date,
    resolveOutletName(a.outletId),
    a.employeeName,
    formatAttendanceShiftLabel(a.shift),
    formatTimeWibFromIso(a.checkInAt),
    formatTimeWibFromIso(a.checkOutAt),
    a.status.charAt(0).toUpperCase() + a.status.slice(1),
    a.lateMinutes || 0,
    a.overtimeMinutes || 0,
    a.workMinutes || 0,
    a.note || '',
  ]);

  // 5. Kasbon_Pinjaman
  const kasbonRows = cashAdvances.map((c) => [
    c.date,
    resolveOutletName(c.outletId),
    c.employeeName,
    c.type === 'loan' ? 'Pinjaman Berjangka' : 'Kasbon',
    c.tenorMonths || 1,
    c.installmentAmount || 0,
    c.source === 'drawer' ? 'Laci Kasir' : c.source === 'owner_transfer' ? 'Transfer Owner' : 'Gabungan',
    c.drawerAmount,
    c.ownerTransferAmount,
    c.amount,
    c.paidAmount,
    c.remainingAmount,
    c.status === 'paid' ? 'Lunas' : c.status === 'partial' ? 'Dicicil' : 'Belum Lunas',
    c.note || '',
  ]);

  // 6. Payroll
  const payrollRows = payrolls.flatMap((p) =>
    p.items.map((it) => [
      p.periodLabel,
      p.fromDate,
      p.toDate,
      resolveOutletName(it.outletId),
      it.employeeName,
      it.roleTitle,
      it.payType === 'daily' ? 'Part-Time Harian' : 'Bulanan',
      it.daysPresent,
      it.fullShiftCount || 0,
      it.lateCount,
      it.overtimeHours,
      it.basePay,
      it.mealTotal,
      it.overtimePay,
      it.bonus,
      it.grossPay,
      it.lateDeduction,
      it.kasbonDeduction,
      it.otherDeduction,
      it.netPay,
      p.status === 'paid' ? 'Dibayar' : 'Draft',
      it.note || '',
    ])
  );

  const pengeluaranOwnerRows = ownerExpenses.map((e) => [
    e.date,
    e.category,
    e.outletIds.map((id) => resolveOutletName(id)).join(', '),
    e.description,
    e.paymentMethod,
    e.amount,
    e.notes || '',
  ]);

  return {
    outlets: outlets.map((o) => o.name),
    categories: settings.expenseCategories,
    ownerCategories: ['Belanja Bahan', 'Operasional', 'Perlengkapan', 'Lain-Lain'],
    tabs: {
      Transaksi_Harian: transaksiRows,
      Pembelanjaan: pembelanjaanRows,
      Setor_Owner_Bank: setorRows,
      Absensi: absensiRows,
      Kasbon_Pinjaman: kasbonRows,
      Payroll: payrollRows,
      Pengeluaran_Owner: pengeluaranOwnerRows,
    },
  };
}

export async function syncToGoogleSheets(options?: { force?: boolean }): Promise<GoogleSheetsSyncResult> {
  try {
    const settings = await getAppSettings();
    const webhookUrl = (settings.googleSheetsWebhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
    if (!webhookUrl) {
      return { ok: false, skipped: true, error: 'URL Webhook Google Sheets belum diisi di Pengaturan.' };
    }
    if (!options?.force && !settings.googleSheetsAutoSync) {
      return { ok: false, skipped: true };
    }

    const payload = await buildGoogleSheetsSyncPayload();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (!res.ok || (parsed && parsed.ok === false)) {
        return {
          ok: false,
          error: parsed?.error || `Webhook Google Sheets mengembalikan HTTP ${res.status}.`,
        };
      }

      const syncedAt = parsed?.syncedAt || new Date().toISOString();
      await updateAppSettings({ googleSheetsLastSync: syncedAt }).catch(() => undefined);

      return {
        ok: true,
        counts: parsed?.counts || {
          Transaksi_Harian: payload.tabs.Transaksi_Harian.length,
          Pembelanjaan: payload.tabs.Pembelanjaan.length,
          Setor_Owner_Bank: payload.tabs.Setor_Owner_Bank.length,
          Absensi: payload.tabs.Absensi.length,
          Kasbon_Pinjaman: payload.tabs.Kasbon_Pinjaman.length,
          Payroll: payload.tabs.Payroll.length,
        },
        syncedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal sinkronisasi ke Google Sheets.',
    };
  }
}

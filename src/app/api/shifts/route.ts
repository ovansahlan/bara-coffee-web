import { after, NextResponse } from 'next/server';
import { syncToGoogleSheets } from '@/lib/gsheets-sync';
import { getSession, safeComparePin } from '@/lib/session';
import {
  cascadeRunningBalancesInDb,
  computePreviousBalanceFromShifts,
  fetchHydratedShifts,
  fetchSingleHydratedShift,
  getAppSettings,
  getOutletById,
  getPreviousBalanceForShift,
  getShift1RefInfo,
  insertCorrectionLog,
  syncShiftCashDropsForCorrection,
  syncShiftExpensesForCorrection,
  upsertShiftData,
} from '@/lib/db';
import {
  buildCorrectionChanges,
  calcShiftMetrics,
  computeCumulativeShift2Breakdown,
  getCumulativeUnderflows,
  makeShiftId,
  sanitizeNullableNonNegInt,
} from '@/lib/calc';
import { resolveOutletAccessForSession } from '@/lib/hr-db';
import type { PosCumulative, ShiftRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedOutlet = searchParams.get('outletId');
    // Strict server-side isolation: cashiers & single-outlet crew can only query their assigned outlet
    const access = await resolveOutletAccessForSession(session, requestedOutlet);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error || 'Akses ditolak.' }, { status: 403 });
    }
    const outletId = access.outletId;
    const date = searchParams.get('date');
    const shiftParam = searchParams.get('shift');

    // Mode 1: Single shift detail + running previous balance + Shift 1 ref + day shift statuses (1 parallel DB wave)
    if (outletId && date && (shiftParam === '1' || shiftParam === '2')) {
      const shiftNum = Number(shiftParam) as 1 | 2;
      const [allToDate, outlet] = await Promise.all([
        fetchHydratedShifts({ outletId, toDate: date }),
        getOutletById(outletId),
      ]);

      const targetId = makeShiftId(outletId, date, shiftNum);
      const existing = allToDate.find((s) => s.id === targetId) || null;
      const previousBalance = computePreviousBalanceFromShifts(
        allToDate,
        date,
        shiftNum,
        outlet?.defaultOpeningCash || 0
      );

      let shift1Ref = null;
      if (shiftNum === 2) {
        const s1 = allToDate.find((s) => s.date === date && s.shift === 1) || null;
        if (s1) {
          const m1 = calcShiftMetrics(s1);
          shift1Ref = {
            found: true,
            breakdown: s1.breakdown,
            totalOmset: m1.totalOmset,
            expenses: s1.expenses,
          };
        } else {
          shift1Ref = {
            found: false,
            breakdown: { tunai: 0, qris: 0, online: 0, edc: 0 },
            totalOmset: 0,
            expenses: [],
          };
        }
      }

      const dayStatuses: Record<number, string> = {};
      allToDate
        .filter((s) => s.date === date)
        .forEach((s) => {
          dayStatuses[s.shift] = calcShiftMetrics(s).status;
        });

      const shiftRecord: ShiftRecord = existing || {
        id: makeShiftId(outletId, date, shiftNum),
        outletId,
        date,
        shift: shiftNum,
        cashier: '',
        inputMode: shiftNum === 2 ? 'cumulative' : 'standalone',
        posCumulative: { tunai: null, qris: null, online: null, edc: null, total: null },
        autoTotal: true,
        manualTotalOmset: 0,
        breakdown: { tunai: 0, qris: 0, online: 0, edc: 0 },
        openingCash: previousBalance.amount,
        openingCashSource: previousBalance.found ? 'carryover' : 'manual',
        cashDrop: 0,
        actualCash: null,
        denomCounts: {},
        balanceChecked: false,
        balanceNote: '',
        checkedAt: null,
        expenses: [],
        cashDrops: [],
        correctionLogs: [],
      };

      // Dynamically ensure carryover matches previous closing (or default opening cash if earliest shift)
      if (existing && existing.openingCashSource !== 'manual') {
        shiftRecord.openingCash = previousBalance.amount;
      }

      return NextResponse.json({
        shift: shiftRecord,
        previousBalance,
        shift1Ref,
        dayStatuses,
      });
    }

    // Mode 2: Shift history list (scoped strictly to cashier's outlet if role === 'outlet')
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const shifts = await fetchHydratedShifts({
      outletId: outletId && outletId !== 'all' ? outletId : null,
      fromDate,
      toDate,
    });

    return NextResponse.json({ shifts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat data shift.' },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    const body = await req.json();
    const access = await resolveOutletAccessForSession(session, String(body?.outletId || ''));
    if (!access.allowed) {
      return NextResponse.json({ error: access.error || 'Akses ditolak.' }, { status: 403 });
    }
    const outletId = access.outletId || '';
    const date = String(body?.date || '');
    const shiftNum = Number(body?.shift) === 2 ? 2 : 1;

    if (!outletId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Outlet atau tanggal tidak valid.' }, { status: 400 });
    }

    const shiftId = makeShiftId(outletId, date, shiftNum);
    const existing = await fetchSingleHydratedShift(outletId, date, shiftNum);
    const confirmBalance = Boolean(body?.confirmBalance);
    const correctionReason = typeof body?.correctionReason === 'string' ? body.correctionReason.trim() : '';
    const correctionOwnerPin = typeof body?.correctionOwnerPin === 'string' ? body.correctionOwnerPin.trim() : '';
    const isLockedCorrection = Boolean(existing?.balanceChecked);

    // Server-side lock enforcement on already checked shifts
    if (isLockedCorrection) {
      if (!confirmBalance) {
        return NextResponse.json(
          { error: 'Shift terkunci tidak dapat disimpan sebagai draft. Klik Simpan Koreksi & Kunci.' },
          { status: 423 }
        );
      }
      if (!correctionReason) {
        return NextResponse.json(
          { error: 'Shift sudah terkunci. Gunakan mode Koreksi Data Shift dengan alasan yang jelas.' },
          { status: 423 }
        );
      }
      const settings = await getAppSettings();
      if (settings.requireOwnerPinForCorrection && session.role !== 'owner') {
        if (!safeComparePin(correctionOwnerPin, settings.ownerPin)) {
          return NextResponse.json({ error: 'PIN Owner salah untuk koreksi shift terkunci.' }, { status: 403 });
        }
      }
    }

    const inputMode: 'standalone' | 'cumulative' =
      shiftNum === 2 && body?.inputMode !== 'standalone' ? 'cumulative' : 'standalone';
    const autoTotal = body?.autoTotal !== false;
    const posCumulative: PosCumulative = {
      tunai: sanitizeNullableNonNegInt(body?.posCumulative?.tunai),
      qris: sanitizeNullableNonNegInt(body?.posCumulative?.qris),
      online: sanitizeNullableNonNegInt(body?.posCumulative?.online),
      edc: sanitizeNullableNonNegInt(body?.posCumulative?.edc),
      total: sanitizeNullableNonNegInt(body?.posCumulative?.total),
    };

    let breakdown = {
      tunai: sanitizeNullableNonNegInt(body?.breakdown?.tunai) ?? 0,
      qris: sanitizeNullableNonNegInt(body?.breakdown?.qris) ?? 0,
      online: sanitizeNullableNonNegInt(body?.breakdown?.online) ?? 0,
      edc: sanitizeNullableNonNegInt(body?.breakdown?.edc) ?? 0,
    };
    let manualTotalOmset = sanitizeNullableNonNegInt(body?.manualTotalOmset) ?? 0;

    if (shiftNum === 2 && inputMode === 'cumulative') {
      const s1 = await getShift1RefInfo(outletId, date);
      if (confirmBalance) {
        const underflows = getCumulativeUnderflows(posCumulative, s1.breakdown, s1.totalOmset, autoTotal);
        if (underflows.length > 0) {
          return NextResponse.json(
            {
              error: `Angka POS (${underflows.map((u) => u.label).join(', ')}) lebih kecil dari Shift 1.`,
            },
            { status: 400 }
          );
        }
      }
      const computed = computeCumulativeShift2Breakdown(posCumulative, s1.breakdown, s1.totalOmset, autoTotal);
      breakdown = computed.breakdown;
      manualTotalOmset = computed.manualTotalOmset;
    }

    const prev = await getPreviousBalanceForShift(outletId, date, shiftNum);
    const openingCashSource: 'carryover' | 'manual' =
      body?.openingCashSource === 'manual' || !prev.found ? 'manual' : 'carryover';
    const openingCash =
      openingCashSource === 'carryover'
        ? prev.amount
        : sanitizeNullableNonNegInt(body?.openingCash) ?? 0;

    const existingDropSum =
      existing && existing.cashDrops.length > 0
        ? existing.cashDrops.reduce((s, d) => s + d.amount, 0)
        : null;
    const cashDrop =
      isLockedCorrection && Array.isArray(body?.correctionCashDrops)
        ? body.correctionCashDrops.reduce(
            (s: number, d: { amount?: unknown }) => s + (sanitizeNullableNonNegInt(d?.amount) ?? 0),
            0
          )
        : existingDropSum !== null
          ? existingDropSum
          : sanitizeNullableNonNegInt(body?.cashDrop) ?? 0;
    const actualCash = sanitizeNullableNonNegInt(body?.actualCash);

    if (confirmBalance && actualCash === null) {
      return NextResponse.json(
        { error: 'Masukkan nominal Uang Fisik di Laci Kasir terlebih dahulu.' },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const nextBalanceChecked = confirmBalance ? true : Boolean(existing?.balanceChecked);

    await upsertShiftData({
      id: shiftId,
      outletId,
      date,
      shift: shiftNum,
      cashier: String(body?.cashier || '').trim(),
      inputMode,
      posCumulative,
      autoTotal,
      manualTotalOmset,
      breakdown,
      openingCash,
      openingCashSource,
      cashDrop,
      actualCash,
      denomCounts: body?.denomCounts && typeof body.denomCounts === 'object' ? body.denomCounts : {},
      balanceChecked: nextBalanceChecked,
      balanceNote: String(body?.balanceNote || ''),
      checkedAt: confirmBalance ? nowIso : existing?.checkedAt || null,
      updatedAt: nowIso,
    });

    // If correcting a locked shift and staged expenses/cash drops were sent, sync them atomically BEFORE audit diff
    if (isLockedCorrection && Array.isArray(body?.correctionExpenses)) {
      await syncShiftExpensesForCorrection({
        shiftId,
        outletId,
        date,
        shift: shiftNum,
        desiredExpenses: body.correctionExpenses,
      });
    }
    if (isLockedCorrection && Array.isArray(body?.correctionCashDrops)) {
      await syncShiftCashDropsForCorrection({
        shiftId,
        outletId,
        date,
        shift: shiftNum,
        desiredCashDrops: body.correctionCashDrops,
      });
    }

    // Record correction audit trail when confirming correction on previously checked shift
    if (confirmBalance && correctionReason) {
      const updatedAfter = await fetchSingleHydratedShift(outletId, date, shiftNum);
      if (updatedAfter) {
        const changes = existing ? buildCorrectionChanges(existing, updatedAfter) : ['Konfirmasi awal dengan catatan koreksi'];
        const actor =
          session.role === 'owner'
            ? 'Owner'
            : `Kasir (${updatedAfter.cashier || access.actorLabel})`;
        await insertCorrectionLog({
          shiftId,
          outletId,
          date,
          shift: shiftNum,
          actor,
          reason: correctionReason,
          changes: changes.length > 0 ? changes : ['Tidak ada perubahan angka (konfirmasi ulang)'],
        });
      }
    }

    // Cascade cumulative running balances & Shift 2 cumulative POS across subsequent shifts
    const [cascaded, outlet] = await Promise.all([
      cascadeRunningBalancesInDb(outletId, { includeCorrections: true }),
      getOutletById(outletId),
    ]);

    const finalShift = cascaded.find((s) => s.id === shiftId) || null;
    const updatedPrev = computePreviousBalanceFromShifts(
      cascaded,
      date,
      shiftNum,
      outlet?.defaultOpeningCash || 0
    );
    after(() => syncToGoogleSheets({ force: false }));
    return NextResponse.json({
      ok: true,
      shift: finalShift,
      previousBalance: updatedPrev,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menyimpan data shift.' },
      { status: 500 }
    );
  }
}

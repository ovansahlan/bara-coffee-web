import { after, NextResponse } from 'next/server';
import { syncToGoogleSheets } from '@/lib/gsheets-sync';
import { getSession } from '@/lib/session';
import {
  cascadeRunningBalancesInDb,
  deleteExpenseById,
  fetchSingleHydratedShift,
  getExpenseById,
} from '@/lib/db';
import { resolveOutletAccessForSession } from '@/lib/hr-db';

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Belum masuk.' }, { status: 401 });
    }

    const { id } = await context.params;
    const exp = await getExpenseById(id);
    if (!exp) {
      return NextResponse.json({ error: 'Pengeluaran tidak ditemukan.' }, { status: 404 });
    }

    // Strict outlet isolation
    const access = await resolveOutletAccessForSession(session, exp.outletId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error || 'Akses ditolak.' }, { status: 403 });
    }

    const parentShift = await fetchSingleHydratedShift(exp.outletId, exp.date, exp.shift);
    if (parentShift?.balanceChecked) {
      return NextResponse.json(
        { error: 'Shift sudah terkunci. Penghapusan pengeluaran wajib disimpan melalui Mode Koreksi Shift.' },
        { status: 423 }
      );
    }

    await deleteExpenseById(exp);
    const cascaded = await cascadeRunningBalancesInDb(exp.outletId, { includeCorrections: true });
    const updatedShift = cascaded.find((s) => s.id === exp.shiftId) || null;
    after(() => syncToGoogleSheets({ force: false }));
    return NextResponse.json({ ok: true, shift: updatedShift });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus pengeluaran.' },
      { status: 500 }
    );
  }
}

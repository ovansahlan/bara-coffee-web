import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  cascadeRunningBalancesInDb,
  deleteCashDropById,
  fetchSingleHydratedShift,
  getCashDropById,
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
    const drop = await getCashDropById(id);
    if (!drop) {
      return NextResponse.json({ error: 'Data setoran tidak ditemukan.' }, { status: 404 });
    }

    const access = await resolveOutletAccessForSession(session, drop.outletId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error || 'Akses ditolak.' }, { status: 403 });
    }

    const parentShift = await fetchSingleHydratedShift(drop.outletId, drop.date, drop.shift);
    if (parentShift?.balanceChecked) {
      return NextResponse.json(
        { error: 'Shift sudah terkunci. Penghapusan setoran wajib disimpan melalui Mode Koreksi Shift.' },
        { status: 423 }
      );
    }

    await deleteCashDropById(drop);
    const cascaded = await cascadeRunningBalancesInDb(drop.outletId, { includeCorrections: true });
    const updatedShift = cascaded.find((s) => s.id === drop.shiftId) || null;
    return NextResponse.json({ ok: true, shift: updatedShift });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus data setoran.' },
      { status: 500 }
    );
  }
}

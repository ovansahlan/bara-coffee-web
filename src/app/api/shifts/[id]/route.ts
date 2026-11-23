import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { cascadeRunningBalancesInDb, deleteShiftById } from '@/lib/db';

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat menghapus laporan shift.' }, { status: 403 });
    }

    const { id } = await context.params;
    const deleted = await deleteShiftById(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Laporan shift tidak ditemukan.' }, { status: 404 });
    }

    await cascadeRunningBalancesInDb(deleted.outletId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus laporan shift.' },
      { status: 500 }
    );
  }
}

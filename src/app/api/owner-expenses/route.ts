import { after, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { createOwnerExpense, deleteOwnerExpense, fetchOwnerExpenses } from '@/lib/hr-db';
import { syncToGoogleSheets } from '@/lib/gsheets-sync';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Akses khusus Owner.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;
    const category = searchParams.get('category') || undefined;
    const outletId = searchParams.get('outletId') || undefined;

    const expenses = await fetchOwnerExpenses({ fromDate, toDate, category, outletId });
    return NextResponse.json({ expenses });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat pengeluaran owner.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat mencatat pengeluaran owner.' }, { status: 403 });
    }

    const body = await req.json();
    const date = String(body?.date || '').trim();
    const category = String(body?.category || 'Belanja Bahan').trim() || 'Belanja Bahan';
    const outletIds = Array.isArray(body?.outletIds) ? body.outletIds.map(String) : [];
    const description = String(body?.description || '').trim();
    const amount = Math.round(Number(body?.amount || 0));
    const paymentMethod = String(body?.paymentMethod || 'Transfer').trim() || 'Transfer';
    const notes = String(body?.notes || '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Tanggal, keterangan, dan nominal (> 0) wajib diisi.' },
        { status: 400 }
      );
    }
    if (outletIds.length === 0) {
      return NextResponse.json(
        { error: 'Pilih minimal satu outlet tujuan pengeluaran.' },
        { status: 400 }
      );
    }

    const expense = await createOwnerExpense({
      date,
      category,
      outletIds,
      description,
      amount,
      paymentMethod,
      notes,
    });

    after(() => syncToGoogleSheets());

    return NextResponse.json({ ok: true, expense });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menyimpan pengeluaran owner.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Hanya Owner yang dapat menghapus pengeluaran owner.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'ID pengeluaran wajib disertakan.' }, { status: 400 });
    }

    await deleteOwnerExpense(id);
    after(() => syncToGoogleSheets());

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus pengeluaran owner.' },
      { status: 500 }
    );
  }
}

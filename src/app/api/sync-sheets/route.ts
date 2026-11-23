import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { syncToGoogleSheets } from '@/lib/gsheets-sync';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Akses khusus Owner.' }, { status: 403 });
    }

    const result = await syncToGoogleSheets({ force: true });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || 'Gagal melakukan sinkronisasi ke Google Sheets.' },
        { status: result.skipped ? 400 : 502 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal sinkronisasi Google Sheets.' },
      { status: 500 }
    );
  }
}

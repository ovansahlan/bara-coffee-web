import { NextResponse } from 'next/server';
import { getSession, safeComparePin } from '@/lib/session';
import { getAppSettings } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Sesi tidak valid.' }, { status: 401 });
    }

    const body = await req.json();
    const reason = String(body?.reason || '').trim();
    if (!reason) {
      return NextResponse.json({ error: 'Alasan koreksi wajib diisi.' }, { status: 400 });
    }

    const settings = await getAppSettings();
    if (settings.requireOwnerPinForCorrection && session.role !== 'owner') {
      const ownerPin = String(body?.ownerPin || '').trim();
      if (!safeComparePin(ownerPin, settings.ownerPin)) {
        return NextResponse.json({ error: 'PIN Owner salah.' }, { status: 403 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memverifikasi koreksi.' },
      { status: 500 }
    );
  }
}

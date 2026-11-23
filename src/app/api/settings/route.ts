import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  cascadeRunningBalancesInDb,
  deleteOutletById,
  getAppSettings,
  getOutletsAdmin,
  updateAppSettings,
  upsertOutlet,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Akses khusus Owner.' }, { status: 403 });
    }

    const [settings, outlets] = await Promise.all([getAppSettings(), getOutletsAdmin()]);
    return NextResponse.json({ settings, outlets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat pengaturan.' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'owner') {
      return NextResponse.json({ error: 'Akses khusus Owner.' }, { status: 403 });
    }

    const body = await req.json();
    const action = String(body?.action || '');

    if (action === 'update_owner_security') {
      const updates: { ownerPin?: string; requireOwnerPinForCorrection?: boolean } = {};
      if (typeof body.ownerPin === 'string') {
        const cleaned = body.ownerPin.replace(/[^0-9]/g, '');
        if (cleaned.length < 4) {
          return NextResponse.json({ error: 'PIN Owner minimal 4 digit angka.' }, { status: 400 });
        }
        updates.ownerPin = cleaned;
      }
      if (typeof body.requireOwnerPinForCorrection === 'boolean') {
        updates.requireOwnerPinForCorrection = body.requireOwnerPinForCorrection;
      }
      await updateAppSettings(updates);
    } else if (action === 'update_expense_categories') {
      const cats = Array.isArray(body.expenseCategories)
        ? body.expenseCategories.map((c: unknown) => String(c || '').trim()).filter(Boolean)
        : [];
      if (cats.length === 0) {
        return NextResponse.json({ error: 'Minimal harus ada 1 kategori pengeluaran.' }, { status: 400 });
      }
      await updateAppSettings({ expenseCategories: cats });
    } else if (action === 'update_shift_schedule') {
      const sched = body?.shiftSchedule || {};
      const hhmm = (v: unknown, fb: string) =>
        typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : fb;
      await updateAppSettings({
        shiftSchedule: {
          shift1Start: hhmm(sched.shift1Start, '08:00'),
          shift1End: hhmm(sched.shift1End, '15:00'),
          shift2Start: hhmm(sched.shift2Start, '15:00'),
          shift2End: hhmm(sched.shift2End, '22:00'),
          lateGraceMinutes: Math.max(0, Math.min(120, Math.round(Number(sched.lateGraceMinutes ?? 10)))),
        },
      });
    } else if (action === 'upsert_outlet') {
      const id = String(body.id || `outlet-${Date.now()}`);
      const name = String(body.name || '').trim();
      const location = String(body.location || '').trim();
      const pin = String(body.pin || '').replace(/[^0-9]/g, '');
      const defaultOpeningCash = Math.max(0, Math.round(Number(body.defaultOpeningCash || 0)));
      const sortOrder = Math.round(Number(body.sortOrder || 0));

      if (!name) return NextResponse.json({ error: 'Nama outlet wajib diisi.' }, { status: 400 });
      if (pin.length < 4) return NextResponse.json({ error: 'PIN kasir minimal 4 digit angka.' }, { status: 400 });

      await upsertOutlet({
        id,
        name,
        location,
        pin,
        defaultOpeningCash,
        sortOrder,
      });
      await cascadeRunningBalancesInDb(id);
    } else if (action === 'delete_outlet') {
      const id = String(body.id || '');
      const currentOutlets = await getOutletsAdmin();
      if (currentOutlets.length <= 1) {
        return NextResponse.json({ error: 'Minimal harus ada 1 outlet aktif.' }, { status: 400 });
      }
      await deleteOutletById(id);
    } else if (action === 'update_google_sheets') {
      const url = typeof body.googleSheetsWebhookUrl === 'string' ? body.googleSheetsWebhookUrl.trim() : '';
      if (url && !url.startsWith('https://script.google.com/')) {
        return NextResponse.json(
          { error: 'URL Webhook harus diawali https://script.google.com/...' },
          { status: 400 }
        );
      }
      await updateAppSettings({
        ...(typeof body.googleSheetsWebhookUrl === 'string' ? { googleSheetsWebhookUrl: url } : {}),
        ...(typeof body.googleSheetsAutoSync === 'boolean'
          ? { googleSheetsAutoSync: body.googleSheetsAutoSync }
          : {}),
      });
    } else {
      return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
    }

    const [settings, outlets] = await Promise.all([getAppSettings(), getOutletsAdmin()]);
    return NextResponse.json({ ok: true, settings, outlets });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memperbarui pengaturan.' },
      { status: 500 }
    );
  }
}

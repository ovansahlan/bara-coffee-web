import { NextResponse } from 'next/server';
import { getStorageMode, isStorageConfigured } from '@/lib/supabase';
import { getSession, clearSessionCookie } from '@/lib/session';
import { getLocalDateStr } from '@/lib/calc';
import { getAppSettings, getOutletById, getOutletsPublic } from '@/lib/db';
import { fetchAttendances, getEmployeeById } from '@/lib/hr-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const storageMode = getStorageMode();
  if (!isStorageConfigured()) {
    return NextResponse.json({ configured: false, authenticated: false, storageMode });
  }

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ configured: true, authenticated: false, storageMode });
    }

    const settings = await getAppSettings();
    const publicSettings = {
      expenseCategories: settings.expenseCategories,
      requireOwnerPinForCorrection: settings.requireOwnerPinForCorrection,
      shiftSchedule: settings.shiftSchedule,
    };

    if (session.role === 'owner') {
      const outlets = await getOutletsPublic();
      return NextResponse.json({
        configured: true,
        authenticated: true,
        storageMode,
        session: { role: 'owner', outletId: null, employeeId: null },
        outlets,
        settings: publicSettings,
      });
    }

    if (session.role === 'crew') {
      if (!session.employeeId) {
        await clearSessionCookie();
        return NextResponse.json({ configured: true, authenticated: false, storageMode });
      }
      const emp = await getEmployeeById(session.employeeId);
      if (!emp || !emp.active) {
        await clearSessionCookie();
        return NextResponse.json({ configured: true, authenticated: false, storageMode });
      }
      const allOutlets = await getOutletsPublic();
      const activeOutlet =
        (session.outletId &&
          (emp.outletId === 'all' || emp.outletId === session.outletId) &&
          allOutlets.find((o) => o.id === session.outletId)) ||
        allOutlets.find((o) => o.id === emp.outletId) ||
        allOutlets[0] ||
        null;

      const today = getLocalDateStr(0);
      const todayAtts = await fetchAttendances({
        employeeId: emp.id,
        fromDate: today,
        toDate: today,
      }).catch(() => []);
      const activeAtt = todayAtts[0] || null;

      return NextResponse.json({
        configured: true,
        authenticated: true,
        storageMode,
        session: {
          role: 'crew',
          outletId: activeOutlet?.id || null,
          employeeId: emp.id,
        },
        employee: {
          id: emp.id,
          name: emp.name,
          roleTitle: emp.roleTitle,
          outletId: emp.outletId,
          payType: emp.payType,
          active: emp.active,
        },
        todayAttendanceStatus: {
          checkedIn: Boolean(activeAtt?.checkInAt),
          checkedOut: Boolean(activeAtt?.checkOutAt),
          shift: activeAtt?.shift ?? null,
        },
        outlets: activeOutlet ? [activeOutlet] : allOutlets,
        settings: publicSettings,
      });
    }

    if (!session.outletId) {
      await clearSessionCookie();
      return NextResponse.json({ configured: true, authenticated: false, storageMode });
    }

    const outlet = await getOutletById(session.outletId);
    if (!outlet) {
      await clearSessionCookie();
      return NextResponse.json({ configured: true, authenticated: false, storageMode });
    }

    return NextResponse.json({
      configured: true,
      authenticated: true,
      storageMode,
      session: { role: 'outlet', outletId: outlet.id, employeeId: null },
      outlets: [
        {
          id: outlet.id,
          name: outlet.name,
          location: outlet.location,
          defaultOpeningCash: outlet.defaultOpeningCash,
          sortOrder: outlet.sortOrder,
        },
      ],
      settings: publicSettings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memverifikasi sesi.' },
      { status: 500 }
    );
  }
}

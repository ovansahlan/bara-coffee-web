import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getStorageMode, isStorageConfigured } from '@/lib/supabase';
import { getAppSettings, getOutletsAdmin } from '@/lib/db';
import { getEmployeeById, getEmployeesAdmin, upsertEmployee } from '@/lib/hr-db';
import { safeComparePin, setSessionCookie } from '@/lib/session';
import type { EmployeeAdmin } from '@/lib/types';

export async function POST(req: Request) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'Penyimpanan database belum dikonfigurasi.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const action = body?.action === 'reset_pin' ? 'reset_pin' : body?.action === 'register' ? 'register' : '';

    if (!action) {
      return NextResponse.json({ error: 'Aksi akun kru tidak valid.' }, { status: 400 });
    }

    if (action === 'register') {
      const name = String(body?.name || '').trim();
      const outletId = String(body?.outletId || '').trim();
      const roleTitle = String(body?.roleTitle || 'Barista').trim() || 'Barista';
      const payType = body?.payType === 'monthly' ? 'monthly' : 'daily';
      const newPin = String(body?.newPin || '').trim();
      const authPin = String(body?.authPin || '').trim();

      if (name.length < 2) {
        return NextResponse.json({ error: 'Nama kru minimal 2 karakter.' }, { status: 400 });
      }
      if (!outletId) {
        return NextResponse.json({ error: 'Outlet penugasan wajib dipilih.' }, { status: 400 });
      }
      if (!/^\d{4,8}$/.test(newPin)) {
        return NextResponse.json({ error: 'PIN pribadi harus 4–8 digit angka.' }, { status: 400 });
      }
      if (!authPin) {
        return NextResponse.json(
          { error: 'PIN Otorisasi (PIN Outlet atau PIN Owner) wajib diisi untuk mendaftar.' },
          { status: 400 }
        );
      }

      const [settings, outlets, existingEmployees] = await Promise.all([
        getAppSettings(),
        getOutletsAdmin(),
        getEmployeesAdmin(),
      ]);

      const isOwnerAuthorized = safeComparePin(authPin, settings.ownerPin);
      if (outletId === 'all') {
        if (!isOwnerAuthorized) {
          return NextResponse.json(
            { error: 'Pendaftaran kru Rolling (Semua Outlet) harus menggunakan PIN Owner.' },
            { status: 401 }
          );
        }
      } else {
        const targetOutlet = outlets.find((o) => o.id === outletId);
        if (!targetOutlet) {
          return NextResponse.json({ error: 'Outlet yang dipilih tidak ditemukan.' }, { status: 404 });
        }
        const isOutletAuthorized = safeComparePin(authPin, targetOutlet.pin);
        if (!isOwnerAuthorized && !isOutletAuthorized) {
          return NextResponse.json(
            { error: `PIN Otorisasi salah. Masukkan PIN ${targetOutlet.name} atau PIN Owner.` },
            { status: 401 }
          );
        }
      }

      const duplicate = existingEmployees.find(
        (e) => e.active && e.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        return NextResponse.json(
          {
            error: `Nama kru "${duplicate.name}" sudah terdaftar. Pilih nama tersebut lalu gunakan menu Lupa / Edit PIN.`,
          },
          { status: 409 }
        );
      }

      const newEmp: EmployeeAdmin = {
        id: `emp-${crypto.randomUUID().slice(0, 8)}`,
        name,
        roleTitle,
        outletId,
        payType,
        baseSalary: 0,
        dailyRate: 0,
        mealAllowance: 0,
        overtimeRatePerHour: 0,
        latePenalty: 0,
        kasbonLimit: 0,
        pin: newPin,
        active: true,
      };

      await upsertEmployee(newEmp);

      const requestedActiveOutlet = String(body?.activeOutletId || '').trim();
      const validRequestedOutlet =
        requestedActiveOutlet && outlets.some((o) => o.id === requestedActiveOutlet)
          ? requestedActiveOutlet
          : null;
      const assignedOutlet =
        newEmp.outletId !== 'all'
          ? newEmp.outletId
          : validRequestedOutlet || outlets[0]?.id || null;
      await setSessionCookie({ role: 'crew', outletId: assignedOutlet, employeeId: newEmp.id });

      return NextResponse.json(
        {
          ok: true,
          role: 'crew',
          outletId: assignedOutlet,
          employeeId: newEmp.id,
          name: newEmp.name,
          storageMode: getStorageMode(),
        },
        { status: 201 }
      );
    }

    // action === 'reset_pin'
    const employeeId = String(body?.employeeId || '').trim();
    const verifyMode = body?.verifyMode === 'owner_pin' ? 'owner_pin' : 'old_pin';
    const verifyPin = String(body?.verifyPin || '').trim();
    const newPin = String(body?.newPin || '').trim();

    if (!employeeId) {
      return NextResponse.json({ error: 'Nama kru belum dipilih.' }, { status: 400 });
    }
    if (!verifyPin) {
      return NextResponse.json({ error: 'PIN verifikasi wajib diisi.' }, { status: 400 });
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      return NextResponse.json({ error: 'PIN baru harus 4–8 digit angka.' }, { status: 400 });
    }

    const emp = await getEmployeeById(employeeId);
    if (!emp || !emp.active) {
      return NextResponse.json({ error: 'Akun kru tidak ditemukan atau sudah nonaktif.' }, { status: 404 });
    }

    if (verifyMode === 'owner_pin') {
      const settings = await getAppSettings();
      if (!safeComparePin(verifyPin, settings.ownerPin)) {
        return NextResponse.json({ error: 'PIN Owner salah.' }, { status: 401 });
      }
    } else {
      if (!safeComparePin(verifyPin, emp.pin)) {
        return NextResponse.json(
          { error: `PIN lama ${emp.name} salah. Jika lupa, ganti verifikasi ke PIN Owner.` },
          { status: 401 }
        );
      }
    }

    await upsertEmployee({ ...emp, pin: newPin });

    let assignedOutlet: string | null = emp.outletId !== 'all' ? emp.outletId : null;
    if (!assignedOutlet) {
      const outlets = await getOutletsAdmin();
      const requestedActiveOutlet = String(body?.activeOutletId || '').trim();
      const validRequested =
        requestedActiveOutlet && outlets.some((o) => o.id === requestedActiveOutlet)
          ? requestedActiveOutlet
          : null;
      assignedOutlet = validRequested || outlets[0]?.id || null;
    }
    await setSessionCookie({ role: 'crew', outletId: assignedOutlet, employeeId: emp.id });

    return NextResponse.json({
      ok: true,
      role: 'crew',
      outletId: assignedOutlet,
      employeeId: emp.id,
      name: emp.name,
      storageMode: getStorageMode(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memproses akun kru.' },
      { status: 500 }
    );
  }
}

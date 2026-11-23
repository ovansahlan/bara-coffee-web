import { NextResponse } from 'next/server';
import { getStorageMode, isStorageConfigured } from '@/lib/supabase';
import { getOutletsPublic } from '@/lib/db';
import { getEmployeesPublic } from '@/lib/hr-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const storageMode = getStorageMode();
  if (!isStorageConfigured()) {
    return NextResponse.json({
      configured: false,
      storageMode,
      outlets: [],
      employees: [],
      message: 'Variabel NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diatur (atau aktifkan USE_LOCAL_DB=true).',
    });
  }

  try {
    const [outlets, employees] = await Promise.all([getOutletsPublic(), getEmployeesPublic()]);
    return NextResponse.json({ configured: true, storageMode, outlets, employees });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        storageMode,
        outlets: [],
        employees: [],
        error: err instanceof Error ? err.message : 'Gagal memuat daftar outlet & kru.',
      },
      { status: 500 }
    );
  }
}

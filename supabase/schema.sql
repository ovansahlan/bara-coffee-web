-- ============================================================
-- Bara Coffee — Skema Database PostgreSQL untuk Supabase
-- Jalankan seluruh script ini sekali di Supabase -> SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Pengaturan Aplikasi & Keamanan Owner (1 baris, id = 1)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  owner_pin TEXT NOT NULL DEFAULT '9999',
  require_owner_pin_for_correction BOOLEAN NOT NULL DEFAULT FALSE,
  expense_categories JSONB NOT NULL DEFAULT '["Minuman","Makanan","Lain-Lain"]'::jsonb,
  shift_schedule JSONB NOT NULL DEFAULT '{"shift1Start":"08:00","shift1End":"15:00","shift2Start":"15:00","shift2End":"22:00","lateGraceMinutes":10}'::jsonb,
  google_sheets_webhook_url TEXT NOT NULL DEFAULT '',
  google_sheets_auto_sync BOOLEAN NOT NULL DEFAULT FALSE,
  google_sheets_last_sync TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tambahan aman untuk database yang sudah ada
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS google_sheets_webhook_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS google_sheets_auto_sync BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS google_sheets_last_sync TIMESTAMPTZ;

-- 2. Daftar Outlet & PIN Masing-Masing Kasir
CREATE TABLE IF NOT EXISTS public.outlets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  default_opening_cash BIGINT NOT NULL DEFAULT 0,
  pin TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Laporan Shift (Omset, Breakdown, Kumulatif POS Shift 2, Saldo Kas Berjalan & Check Balance)
CREATE TABLE IF NOT EXISTS public.shifts (
  id TEXT PRIMARY KEY, -- format: {outlet_id}__{YYYY-MM-DD}__{1|2}
  outlet_id TEXT NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift SMALLINT NOT NULL CHECK (shift IN (1, 2)),
  cashier TEXT NOT NULL DEFAULT '',
  input_mode TEXT NOT NULL DEFAULT 'standalone' CHECK (input_mode IN ('standalone', 'cumulative')),
  pos_cumulative JSONB NOT NULL DEFAULT '{"tunai":null,"qris":null,"online":null,"edc":null,"total":null}'::jsonb,
  auto_total BOOLEAN NOT NULL DEFAULT TRUE,
  manual_total_omset BIGINT NOT NULL DEFAULT 0,
  tunai BIGINT NOT NULL DEFAULT 0,
  qris BIGINT NOT NULL DEFAULT 0,
  online_delivery BIGINT NOT NULL DEFAULT 0,
  edc_transfer BIGINT NOT NULL DEFAULT 0,
  opening_cash BIGINT NOT NULL DEFAULT 0,
  opening_cash_source TEXT NOT NULL DEFAULT 'carryover' CHECK (opening_cash_source IN ('carryover', 'manual')),
  cash_drop BIGINT NOT NULL DEFAULT 0,
  actual_cash BIGINT,
  denom_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  balance_checked BOOLEAN NOT NULL DEFAULT FALSE,
  balance_note TEXT NOT NULL DEFAULT '',
  checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outlet_id, date, shift)
);

CREATE INDEX IF NOT EXISTS idx_shifts_outlet_date ON public.shifts (outlet_id, date DESC, shift DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON public.shifts (date DESC);

-- 4. Detail Pengeluaran Kas Kecil per Shift
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id TEXT NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift SMALLINT NOT NULL CHECK (shift IN (1, 2)),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Lain-Lain',
  amount BIGINT NOT NULL CHECK (amount > 0),
  expense_time TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_shift ON public.expenses (shift_id);
CREATE INDEX IF NOT EXISTS idx_expenses_outlet_date ON public.expenses (outlet_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses (category);

-- 4b. Riwayat Setor ke Owner / Bank per Shift
CREATE TABLE IF NOT EXISTS public.cash_drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id TEXT NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift SMALLINT NOT NULL CHECK (shift IN (1, 2)),
  method TEXT NOT NULL DEFAULT 'Tunai ke Owner',
  note TEXT NOT NULL DEFAULT '',
  amount BIGINT NOT NULL CHECK (amount > 0),
  drop_time TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_drops_shift ON public.cash_drops (shift_id);
CREATE INDEX IF NOT EXISTS idx_cash_drops_outlet_date ON public.cash_drops (outlet_id, date DESC);

-- 5. Jejak Audit Koreksi Shift (Untuk Pemantauan Owner)
CREATE TABLE IF NOT EXISTS public.correction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id TEXT NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift SMALLINT NOT NULL CHECK (shift IN (1, 2)),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_logs_shift ON public.correction_logs (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correction_logs_outlet_date ON public.correction_logs (outlet_id, date DESC);

-- 6. Master Karyawan (Bulanan & Part-Time Harian)
CREATE TABLE IF NOT EXISTS public.employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT 'Barista',
  outlet_id TEXT NOT NULL DEFAULT 'all', -- outlet id atau 'all' (rolling)
  pay_type TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly', 'daily')),
  pin TEXT NOT NULL,
  base_salary BIGINT NOT NULL DEFAULT 0,
  daily_rate BIGINT NOT NULL DEFAULT 0,
  meal_allowance BIGINT NOT NULL DEFAULT 0,
  overtime_rate_per_hour BIGINT NOT NULL DEFAULT 0,
  late_penalty BIGINT NOT NULL DEFAULT 0,
  kasbon_limit BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Absensi Karyawan (Selfie Terkompresi + Jam Server WIB)
CREATE TABLE IF NOT EXISTS public.attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift SMALLINT NOT NULL CHECK (shift IN (1, 2, 3)),
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  check_in_photo TEXT,
  check_out_photo TEXT,
  status TEXT NOT NULL DEFAULT 'hadir' CHECK (status IN ('hadir', 'telat', 'izin', 'sakit', 'alpha')),
  late_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  work_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendances_date ON public.attendances (date DESC);
CREATE INDEX IF NOT EXISTS idx_attendances_emp_date ON public.attendances (employee_id, date DESC);

-- 8. Kasbon Karyawan (Laci Kasir, Transfer Owner, atau Gabungan)
CREATE TABLE IF NOT EXISTS public.cash_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES public.shifts(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  shift SMALLINT NOT NULL CHECK (shift IN (1, 2)),
  amount BIGINT NOT NULL CHECK (amount > 0),
  drawer_amount BIGINT NOT NULL DEFAULT 0 CHECK (drawer_amount >= 0),
  owner_transfer_amount BIGINT NOT NULL DEFAULT 0 CHECK (owner_transfer_amount >= 0),
  source TEXT NOT NULL DEFAULT 'drawer' CHECK (source IN ('drawer', 'owner_transfer', 'mixed')),
  advance_type TEXT NOT NULL DEFAULT 'kasbon' CHECK (advance_type IN ('kasbon', 'loan')),
  tenor_months INT NOT NULL DEFAULT 1 CHECK (tenor_months >= 1),
  installment_amount BIGINT NOT NULL DEFAULT 0 CHECK (installment_amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  advance_time TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_advances_emp ON public.cash_advances (employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_advances_shift ON public.cash_advances (shift_id);

-- 9. Riwayat Pelunasan / Cicilan Kasbon
CREATE TABLE IF NOT EXISTS public.cash_advance_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_advance_id UUID NOT NULL REFERENCES public.cash_advances(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'payroll' CHECK (method IN ('payroll', 'cash_return', 'transfer_return')),
  payroll_run_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Rekap Payroll per Periode
CREATE TABLE IF NOT EXISTS public.payrolls (
  id TEXT PRIMARY KEY,
  period_label TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  outlet_id TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_gross BIGINT NOT NULL DEFAULT 0,
  total_kasbon_deducted BIGINT NOT NULL DEFAULT 0,
  total_net BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- Aktifkan Row Level Security (RLS) tanpa policy anon agar akses publik langsung tertutup.
-- Seluruh query dilakukan aman lewat Next.js API Routes menggunakan SUPABASE_SERVICE_ROLE_KEY.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_advance_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payrolls ENABLE ROW LEVEL SECURITY;

-- Pastikan role service_role memiliki hak akses penuh pada seluruh tabel & sequence
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- Data Awal (Aman dijalankan berulang kali)
INSERT INTO public.app_settings (id, owner_pin, require_owner_pin_for_correction, expense_categories)
VALUES (1, '9999', FALSE, '["Minuman","Makanan","Lain-Lain"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.outlets (id, name, location, default_opening_cash, pin, sort_order)
VALUES
  ('outlet-1', 'Bara Coffee - Outlet 1', 'Pusat', 0, '1111', 1),
  ('outlet-2', 'Bara Coffee - Outlet 2', 'Cabang', 0, '2222', 2)
ON CONFLICT (id) DO NOTHING;

# Bara Coffee — Aplikasi Omset, Kas Kecil & Dashboard Owner (Next.js + Supabase)

Aplikasi web live siap deploy ke **Vercel** dengan database **Supabase (PostgreSQL)** untuk operasional multi-outlet **Bara Coffee**.

## Fitur Utama
- **Akses Terpisah per Outlet (Server-Side Isolated)**: Kasir Outlet 1 (PIN default `1111`) dan Outlet 2 (PIN default `2222`) terkunci di sisi server sehingga tidak dapat saling melihat data cabang lain.
- **Dashboard Owner** (PIN default `9999`): Pemantauan live hari ini per cabang, **Saldo Kas Berjalan**, peringatan selisih kas, perbandingan performa outlet, rekap & detail pengeluaran per kategori, ekspor CSV, dan manajemen PIN/outlet.
- **Mode Kumulatif POS untuk Shift 2**: Kasir Shift 2 cukup menyalin angka total layar POS (pagi–closing) — aplikasi otomatis mengurangi omset Shift 1 tanpa hitung manual.
- **Saldo Kas Berjalan (Kumulatif Antar Hari & Shift)**: Saldo akhir hari ini otomatis terbawa menjadi saldo awal besok (`Saldo Sebelumnya + Tunai − Pengeluaran − Setor Owner = Saldo Akhir`), lengkap dengan kalkulator Hitung Pecahan Uang & Laporan WA 1-klik.
- **Kategori Pengeluaran & Anti Double Input**: Kategori default `Minuman`, `Makanan`, `Lain-Lain` (bisa dikustom Owner), panel referensi pengeluaran Shift 1 di layar Shift 2, dan deteksi otomatis duplikat lintas shift di server.
- **Kunci Shift & Jejak Audit Koreksi**: Shift yang sudah Check Balance otomatis terkunci; koreksi wajib mengisi alasan (dan opsional verifikasi PIN Owner) serta otomatis tercatat di Jejak Audit Owner.

---

## Panduan Deploy Live ke Vercel + Supabase (5 Menit)

### Langkah 1: Siapkan Database di Supabase
1. Buka [supabase.com](https://supabase.com), login, lalu klik **New Project** (pilih Region **Singapore** agar cepat dari Indonesia).
2. Setelah project siap, buka menu **SQL Editor** → **New query**.
3. Salin seluruh isi file `supabase/schema.sql`, tempel di SQL Editor, lalu klik **Run**.
4. Buka **Project Settings → API** lalu catat 2 nilai ini:
   - **Project URL** (`https://xxxxx.supabase.co`)
   - **service_role secret key** *(jangan gunakan `anon` key — aplikasi ini memakai `service_role` hanya di sisi server API Vercel untuk keamanan PIN & isolasi outlet)*.

### Langkah 2: Deploy ke Vercel
1. Upload folder `bara-coffee-web` ini ke repository GitHub Anda (atau deploy langsung via `npx vercel`).
2. Di [vercel.com](https://vercel.com), klik **Add New → Project**, lalu pilih repository tersebut.
3. Sebelum klik Deploy, buka bagian **Environment Variables** dan masukkan 3 variabel berikut:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL dari Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key dari Supabase
   - `SESSION_SECRET` = string acak bebas minimal 32 karakter (contoh: `bara-coffee-secret-2026-aman-sekali-987654`)
4. Klik **Deploy** dan tunggu ~1 menit hingga aplikasi live!

### Langkah 3: Ganti PIN Default
1. Buka URL Vercel Anda → pilih **Dashboard Owner** → masukkan PIN awal `9999`.
2. Masuk ke tab **Pengaturan & PIN** untuk mengubah nama outlet, PIN Outlet 1, PIN Outlet 2, dan PIN Owner.

---

## Menjalankan Lokal (Opsional)

### Opsi A: Mode Lokal Dummy (Tanpa Supabase)
Cocok untuk coba-coba dan pengembangan lokal tanpa koneksi database cloud. Data tersimpan otomatis di file `.local-data/bara-coffee-db.json` (terisi data contoh awal):
```bash
# Buat .env.local berisi:
# USE_LOCAL_DB=true
# SESSION_SECRET=bara-coffee-local-dev-secret-key-minimal-32-karakter
npm install
npm run dev
```
PIN default: Owner `9999`, Outlet 1 `1111`, Outlet 2 `2222`.

### Opsi B: Mode Live Supabase
```bash
cp .env.example .env.local
# Isi NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET di .env.local
# (Pastikan USE_LOCAL_DB tidak aktif / dihapus)
npm install
npm run dev
```

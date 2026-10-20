# Portal Presensi Peserta & Dosen - Pemira HIMASI

Aplikasi web presensi digital mahasiswa dan dosen untuk kegiatan Pemira HIMASI.
Terintegrasi secara realtime dengan database Supabase dan Google Sheets.

## Fitur Peserta
- Presensi Mahasiswa berbasis NIM dengan validasi otomatis nama dan angkatan.
- Presensi Dosen Pengampu kegiatan.
- Validasi anti-titip absen: 1 alamat IP/HP hanya dapat melakukan 1 kali presensi per hari.
- Desain antarmuka responsif dan modern untuk perangkat mobile.

## Environment Variables
Salin berkas `.env.local.example` ke `.env.local` dan isi nilainya:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_SERVICE_ACCOUNT_KEY`

## Menjalankan di Lokal
```bash
npm install
npm run dev
```
Buka [http://localhost:3000](http://localhost:3000)

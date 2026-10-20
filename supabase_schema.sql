-- ========================================================
-- SKEMA DATABASE SUPABASE: SISTEM ABSENSI MAHASISWA & ADMIN
-- ========================================================
-- Jalankan seluruh query ini di menu SQL Editor pada Dashboard Supabase Anda.

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABEL DATA MASTER MAHASISWA
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nim VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    class_name VARCHAR(50) NOT NULL,
    phone VARCHAR(30),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pencarian cepat untuk auto-fill NIM
CREATE INDEX IF NOT EXISTS idx_students_nim ON public.students(nim);
CREATE INDEX IF NOT EXISTS idx_students_class ON public.students(class_name);

-- 3. TABEL RIWAYAT ABSENSI MAHASISWA
CREATE TABLE IF NOT EXISTS public.attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    nim VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    class_name VARCHAR(50) NOT NULL,
    lecturer_name VARCHAR(150), -- Dosen Pengampu / Penanggung Jawab
    attendance_date DATE DEFAULT CURRENT_DATE NOT NULL,
    check_in_time TIME WITHOUT TIME ZONE DEFAULT CURRENT_TIME NOT NULL,
    status VARCHAR(30) DEFAULT 'Hadir' NOT NULL, -- 'Hadir', 'Terlambat', 'Izin', 'Sakit'
    notes TEXT,
    device_info TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Cegah mahasiswa absen lebih dari 1 kali pada tanggal yang sama
    CONSTRAINT unique_nim_per_date UNIQUE (nim, attendance_date)
);

-- Pastikan kolom lecturer_name ada jika tabel sudah terlanjur dibuat sebelumnya
ALTER TABLE public.attendances ADD COLUMN IF NOT EXISTS lecturer_name VARCHAR(150);

CREATE INDEX IF NOT EXISTS idx_attendances_date ON public.attendances(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendances_class ON public.attendances(class_name);
CREATE INDEX IF NOT EXISTS idx_attendances_nim ON public.attendances(nim);

-- 4. TABEL PENGATURAN LANDING PAGE & TAMPILAN
CREATE TABLE IF NOT EXISTS public.landing_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_name VARCHAR(150) DEFAULT 'Universitas Sains & Teknologi',
    page_title VARCHAR(200) DEFAULT 'Sistem Presensi Kehadiran Mahasiswa',
    page_subtitle TEXT DEFAULT 'Silakan masukkan NIM Anda untuk mencatat kehadiran perkuliahan hari ini.',
    announcement TEXT DEFAULT 'Batas absensi matakuliah dibuka mulai jam 07:00 hingga 17:00 WIB setiap hari kuliah.',
    logo_url TEXT,
    hero_images JSONB DEFAULT '[]'::jsonb, -- Array URL banner dinamis
    extra_texts JSONB DEFAULT '{
      "badge_text": "Presensi Dibuka",
      "instruction_title": "Panduan Presensi Mahasiswa",
      "instructions": [
        "Masukkan NIM lengkap Anda pada kolom yang tersedia di formulir sebelah.",
        "Pastikan Nama dan Kelas yang muncul otomatis sudah sesuai dengan identitas Anda.",
        "Setiap mahasiswa hanya dapat melakukan absensi 1 kali per hari perkuliahan.",
        "Jika berhalangan, pilih opsi Izin atau Sakit dan cantumkan alasan yang jelas."
      ],
      "card1_title": "Waktu Presensi",
      "card1_desc": "07.00 - 17.00 WIB",
      "card2_title": "Presisi NIM",
      "card2_desc": "Anti-typo & Auto-fill",
      "card3_title": "Sinkronisasi",
      "card3_desc": "Terkoneksi Sheets",
      "footer_text": "Sistem Absensi Terintegrasi."
    }'::jsonb,
    academic_year VARCHAR(50) DEFAULT '2026/2027 Ganjil',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pastikan kolom extra_texts ada jika tabel sudah terlanjur dibuat sebelumnya
ALTER TABLE public.landing_settings ADD COLUMN IF NOT EXISTS extra_texts JSONB DEFAULT '{
  "badge_text": "Presensi Dibuka",
  "instruction_title": "Panduan Presensi Mahasiswa",
  "instructions": [
    "Masukkan NIM lengkap Anda pada kolom yang tersedia di formulir sebelah.",
    "Pastikan Nama dan Kelas yang muncul otomatis sudah sesuai dengan identitas Anda.",
    "Setiap mahasiswa hanya dapat melakukan absensi 1 kali per hari perkuliahan.",
    "Jika berhalangan, pilih opsi Izin atau Sakit dan cantumkan alasan yang jelas."
  ],
  "card1_title": "Waktu Presensi",
  "card1_desc": "07.00 - 17.00 WIB",
  "card2_title": "Presisi NIM",
  "card2_desc": "Anti-typo & Auto-fill",
  "card3_title": "Sinkronisasi",
  "card3_desc": "Terkoneksi Sheets",
  "footer_text": "Sistem Absensi Terintegrasi."
}'::jsonb;

-- 5. TABEL PENGATURAN GOOGLE SHEETS
CREATE TABLE IF NOT EXISTS public.sheet_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_role VARCHAR(50) DEFAULT 'admin' UNIQUE NOT NULL,
    sheet_id VARCHAR(200) NOT NULL,
    sheet_name VARCHAR(100) DEFAULT 'Presensi',
    sync_mode VARCHAR(30) DEFAULT 'realtime', -- 'manual', 'realtime'
    last_synced_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. DATA AWAL (SEED PLACEHOLDER DATA)
INSERT INTO public.landing_settings (id, institution_name, page_title, page_subtitle, announcement, hero_images)
SELECT 
    gen_random_uuid(),
    'Institut Teknologi & Sains',
    'Presensi Perkuliahan Mahasiswa',
    'Pencatatan kehadiran resmi mahasiswa secara real-time dan terintegrasi.',
    'Batas absensi dibuka mulai jam 07:00 hingga 17:00 WIB setiap hari perkuliahan.',
    '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.landing_settings);

INSERT INTO public.sheet_configs (sheet_role, sheet_id, sheet_name, sync_mode)
SELECT 'admin', '', 'Presensi', 'realtime'
WHERE NOT EXISTS (SELECT 1 FROM public.sheet_configs WHERE sheet_role = 'admin');

-- Contoh 5 Data Mahasiswa Awal untuk Pengujian
INSERT INTO public.students (nim, name, class_name)
VALUES
    ('21102001', 'Ahmad Fauzi Pratama', 'TI-3A'),
    ('21102002', 'Budi Santoso', 'TI-3A'),
    ('21102003', 'Citra Dewi Lestari', 'TI-3A'),
    ('21102004', 'Dimas Anggara', 'TI-3B'),
    ('21102005', 'Eka Putri Rahayu', 'TI-3B')
ON CONFLICT (nim) DO NOTHING;

-- 7. SETUP ROW LEVEL SECURITY (RLS)
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheet_configs ENABLE ROW LEVEL SECURITY;

-- Policy untuk Mahasiswa (Publik / Tanpa Login):
CREATE POLICY "Public students read access" ON public.students
    FOR SELECT TO anon, authenticated
    USING (is_active = true);

CREATE POLICY "Public landing settings read access" ON public.landing_settings
    FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "Public attendance insert" ON public.attendances
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Public attendance check" ON public.attendances
    FOR SELECT TO anon, authenticated
    USING (attendance_date = CURRENT_DATE);

-- Policy untuk Admin (Authenticated):
CREATE POLICY "Admin full access students" ON public.students
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "Admin full access attendances" ON public.attendances
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "Admin full access landing_settings" ON public.landing_settings
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "Admin full access sheet_configs" ON public.sheet_configs
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

-- 8. AKTIFKAN REALTIME UNTUK MONITORING ADMIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendances;

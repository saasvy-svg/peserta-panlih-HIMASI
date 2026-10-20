import NavbarPublic from '@/components/public/NavbarPublic';
import HeroBannerSlider from '@/components/public/HeroBannerSlider';
import AttendanceForm from '@/components/public/AttendanceForm';
import { createAdminClient } from '@/utils/supabase/admin';
import { LandingSettings } from '@/types/database';
import { Bell, Users, CheckCircle, Clock3 } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Dynamic

async function getLandingSettings(): Promise<LandingSettings | null> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('landing_settings')
      .select('*')
      .maybeSingle();

    return data || null;
  } catch (e) {
    return null;
  }
}

export default async function HomePage() {
  const settings = await getLandingSettings();

  const extra = settings?.extra_texts || {};
  const instructions = extra.instructions && extra.instructions.length > 0
    ? extra.instructions
    : [
        'Masukkan NIM lengkap Anda pada kolom yang tersedia di formulir sebelah.',
        'Pastikan Nama dan Angkatan yang muncul otomatis sudah sesuai dengan identitas Anda.',
        'Setiap mahasiswa hanya dapat melakukan absensi 1 kali per hari perkuliahan.',
        'Jika berhalangan, pilih opsi Izin atau Sakit dan cantumkan alasan yang jelas.',
      ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
      {/* Dynamic Navbar */}
      <NavbarPublic settings={settings} />

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Dynamic Announcement Banner */}
        {settings?.announcement && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-4 flex items-start sm:items-center gap-3 text-xs sm:text-sm text-[#1E40AF] shadow-xs">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Bell size={16} />
            </div>
            <div className="flex-1">
              <span className="font-bold mr-1.5 uppercase text-[11px] tracking-wider text-blue-700 bg-blue-100 px-2 py-0.5 rounded-md">
                Pengumuman
              </span>
              <span>{settings.announcement}</span>
            </div>
          </div>
        )}

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column: Hero Banner + Info Cards (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Dynamic Banner Slider from Supabase Storage */}
            <HeroBannerSlider
              customImages={settings?.hero_images || []}
              title={settings?.page_title || 'Presensi Kehadiran Mahasiswa'}
              desc={settings?.page_subtitle || 'Pencatatan kehadiran resmi mahasiswa secara real-time dan terintegrasi.'}
              badge={settings?.institution_name || 'Portal Presensi Resmi'}
            />

            {/* Quick Informational Highlights (Dynamic) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-2xs flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0">
                  <Clock3 size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#111827]">
                    {extra.card1_title || 'Waktu Presensi'}
                  </h4>
                  <p className="text-[11px] text-[#6B7280]">
                    {extra.card1_desc || '07.00 - 17.00 WIB'}
                  </p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-2xs flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <CheckCircle size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#111827]">
                    {extra.card2_title || 'Presisi NIM'}
                  </h4>
                  <p className="text-[11px] text-[#6B7280]">
                    {extra.card2_desc || 'Anti-typo & Auto-fill'}
                  </p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-2xs flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <Users size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#111827]">
                    {extra.card3_title || 'Sinkronisasi'}
                  </h4>
                  <p className="text-[11px] text-[#6B7280]">
                    {extra.card3_desc || 'Terkoneksi Sheets'}
                  </p>
                </div>
              </div>
            </div>

            {/* Academic Info Card (Dynamic) */}
            <div className="bg-white rounded-2xl border border-black/5 p-5 shadow-2xs space-y-2.5">
              <h3 className="font-bold text-sm text-[#111827]">
                {extra.instruction_title || 'Panduan Presensi Mahasiswa'}
              </h3>
              <ul className="text-xs text-[#6B7280] space-y-1.5 list-disc list-inside">
                {instructions.map((point: string, idx: number) => (
                  <li key={idx}>{point}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right Column: Attendance Form (5 cols) */}
          <div className="lg:col-span-5">
            <AttendanceForm lecturers={settings?.extra_texts?.lecturers || []} />
          </div>
        </div>
      </main>

      {/* Footer (Dynamic) */}
      <footer className="border-t border-black/5 bg-white py-6 mt-12 text-center text-xs text-[#6B7280]">
        <div className="max-w-7xl mx-auto px-4">
          <p>
            © {new Date().getFullYear()} {settings?.institution_name || 'Institut Teknologi & Sains'}.{' '}
            {extra.footer_text || 'Sistem Absensi Terintegrasi.'}
          </p>
        </div>
      </footer>
    </div>
  );
}

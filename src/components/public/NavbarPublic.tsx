'use client';

import { GraduationCap } from 'lucide-react';
import { LandingSettings } from '@/types/database';

export default function NavbarPublic({ settings }: { settings?: LandingSettings | null }) {
  const institutionName = settings?.institution_name || 'Institut Teknologi & Sains';
  const subtitle = settings?.page_subtitle || 'Portal Presensi Kehadiran Mahasiswa';
  const badgeText = settings?.extra_texts?.badge_text || 'Presensi Dibuka';

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-black/5 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {settings?.logo_url ? (
            <img
              src={settings.logo_url}
              alt="Logo"
              className="w-10 h-10 object-contain rounded-xl border border-black/5 p-1 bg-white shadow-2xs"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-[#2563EB] flex items-center justify-center text-white shadow-sm">
              <GraduationCap size={22} />
            </div>
          )}
          <div>
            <h1 className="font-bold text-base text-[#111827] leading-tight tracking-tight">
              {institutionName}
            </h1>
            <p className="text-xs text-[#6B7280] line-clamp-1">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>{badgeText}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

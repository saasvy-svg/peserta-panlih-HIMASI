'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

interface HeroBannerSliderProps {
  customImages?: string[];
  title?: string;
  desc?: string;
  badge?: string;
}

export default function HeroBannerSlider({
  customImages,
  title = 'Presensi Kehadiran Mahasiswa',
  desc = 'Silakan masukkan Nomor Induk Mahasiswa (NIM) Anda untuk mencatat kehadiran resmi perkuliahan.',
  badge = 'Portal Presensi Resmi',
}: HeroBannerSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const images = (customImages || []).filter(Boolean);

  useEffect(() => {
    if (images.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [images.length]);

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  // JIKA BELUM ADA FOTO YANG DIUPLOAD ADMIN
  if (images.length === 0) {
    return (
      <div className="relative w-full h-[280px] sm:h-[340px] md:h-[380px] rounded-2xl overflow-hidden shadow-xs border border-blue-100 bg-gradient-to-br from-[#1E40AF] via-[#2563EB] to-[#3B82F6] flex flex-col justify-end p-6 sm:p-8 text-white">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />

        <div className="relative z-10 max-w-lg space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/15 backdrop-blur-md rounded-full text-xs font-semibold w-fit text-white border border-white/20 shadow-xs">
            <Sparkles size={13} className="text-amber-300" />
            <span>{badge}</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-xs">
            {title}
          </h2>

          <p className="text-xs sm:text-sm text-blue-100 leading-relaxed drop-shadow-2xs">
            {desc}
          </p>
        </div>
      </div>
    );
  }

  // JIKA SUDAH ADA FOTO DOKUMENTASI DARI ADMIN
  return (
    <div className="relative w-full h-[280px] sm:h-[340px] md:h-[380px] rounded-2xl overflow-hidden shadow-xs border border-black/5 group bg-gray-900">
      {images.map((imgUrl, idx) => (
        <div
          key={idx}
          className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
            idx === currentIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'
          }`}
        >
          <img
            src={imgUrl}
            alt={`Banner #${idx + 1}`}
            className="w-full h-full object-cover brightness-[0.78]"
          />
          {/* Overlay Teks Dinamis di atas Foto */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent flex flex-col justify-end p-6 sm:p-8 text-white z-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold w-fit mb-2 text-white border border-white/20 shadow-xs">
              <Sparkles size={12} className="text-amber-300" />
              <span>{badge}</span>
            </div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight mb-1 text-white drop-shadow-md">
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-gray-200 max-w-xl drop-shadow-xs line-clamp-2 leading-relaxed">
              {desc}
            </p>
          </div>
        </div>
      ))}

      {/* Kontrol Navigasi (Hanya jika foto > 1) */}
      {images.length > 1 && (
        <>
          <button
            onClick={handlePrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            aria-label="Previous slide"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            aria-label="Next slide"
          >
            <ChevronRight size={18} />
          </button>

          {/* Dots Indicator */}
          <div className="absolute bottom-3 right-6 z-20 flex items-center gap-1.5 bg-black/30 backdrop-blur-xs px-2.5 py-1 rounded-full">
            {images.map((_, dotIdx) => (
              <button
                key={dotIdx}
                onClick={() => setCurrentIndex(dotIdx)}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  dotIdx === currentIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/50'
                }`}
                aria-label={`Slide ${dotIdx + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

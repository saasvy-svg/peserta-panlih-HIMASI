import { getWIBTime } from './utils';
import { ExtraTexts } from '@/types/database';

export interface TimeLockStatus {
  enabled: boolean;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  currentTime: string;
  reason?: 'TOO_EARLY' | 'TOO_LATE';
  message: string;
}

/**
 * Checks if current Asia/Jakarta (WIB) time is within the allowed attendance window.
 */
export function checkAttendanceTimeLock(extraTexts?: ExtraTexts | null): TimeLockStatus {
  const enabled = extraTexts?.time_lock_enabled === true;
  const openTime = extraTexts?.open_time || '07:00';
  const closeTime = extraTexts?.close_time || '15:00';
  const currentTime = getWIBTime().slice(0, 5); // HH:MM format in WIB

  if (!enabled) {
    return {
      enabled: false,
      isOpen: true,
      openTime,
      closeTime,
      currentTime,
      message: 'Presensi dibuka 24 jam (pembatasan jam dinonaktifkan).',
    };
  }

  // Compare HH:MM strings lexicographically
  if (currentTime < openTime) {
    return {
      enabled: true,
      isOpen: false,
      openTime,
      closeTime,
      currentTime,
      reason: 'TOO_EARLY',
      message:
        extraTexts?.time_lock_message ||
        `Mohon maaf, sesi presensi belum dibuka. Presensi dibuka pada pukul ${openTime} WIB (Waktu saat ini: ${currentTime} WIB).`,
    };
  }

  if (currentTime > closeTime) {
    return {
      enabled: true,
      isOpen: false,
      openTime,
      closeTime,
      currentTime,
      reason: 'TOO_LATE',
      message:
        extraTexts?.time_lock_message ||
        `Mohon maaf, sesi presensi telah resmi ditutup pada pukul ${closeTime} WIB (Waktu saat ini: ${currentTime} WIB).`,
    };
  }

  return {
    enabled: true,
    isOpen: true,
    openTime,
    closeTime,
    currentTime,
    message: `Presensi sedang dibuka (Jam Operasional: ${openTime} - ${closeTime} WIB).`,
  };
}

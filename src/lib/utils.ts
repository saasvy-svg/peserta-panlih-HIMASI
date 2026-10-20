import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | Date) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatTime(timeStr?: string) {
  if (!timeStr) return '';
  return timeStr.slice(0, 5) + ' WIB';
}

/**
 * Mendapatkan tanggal hari ini dalam zona waktu WIB (Asia/Jakarta) format YYYY-MM-DD
 */
export function getWIBDate(): string {
  const d = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Mendapatkan jam saat ini dalam zona waktu WIB (Asia/Jakarta) format HH:MM:SS (24 jam)
 */
export function getWIBTime(): string {
  const d = new Date();
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Mendapatkan timestamp tercatat dalam format waktu lokal Indonesia (WIB)
 */
export function getWIBLocaleString(): string {
  const d = new Date();
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
  }) + ' WIB';
}

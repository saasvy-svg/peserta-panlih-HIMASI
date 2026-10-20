/**
 * Utility untuk normalisasi dan standarisasi Angkatan.
 * Menghilangkan pemisahan kelas seperti 'A' atau 'B' (contoh: A25, B25 -> Angkatan 25).
 */
export function normalizeAngkatan(input?: string | null): string {
  if (!input) return 'Umum';
  const trimmed = input.trim();

  // Khusus Dosen
  if (/^dosen/i.test(trimmed)) {
    return 'Dosen';
  }

  // Jika sudah bertuliskan "Angkatan XX"
  const alreadyAngkatan = trimmed.match(/^angkatan\s*(\d+)/i);
  if (alreadyAngkatan) {
    return `Angkatan ${alreadyAngkatan[1]}`;
  }

  // Pola A25, B25, a25, b25, TI-25, 25, 2025 dsb.
  const batchMatch = trimmed.match(/^[a-zA-Z\-_/ ]*(\d{2,4})$/);
  if (batchMatch) {
    const raw = batchMatch[1];
    const yearDigits = raw.length === 4 ? raw.slice(2) : raw;
    return `Angkatan ${yearDigits}`;
  }

  // Cek apakah mengandung 2 digit angka (contoh: "Kelas 25", "TI 25")
  const anyDigits = trimmed.match(/(\d{2})/);
  if (anyDigits) {
    return `Angkatan ${anyDigits[1]}`;
  }

  return trimmed;
}

/**
 * Menentukan nama tab tujuan di Google Sheets untuk suatu data presensi.
 * Jika Dosen -> "Dosen"
 * Jika Mahasiswa -> "Angkatan XX" (contoh: "Angkatan 25", "Angkatan 26")
 */
export function getTargetTabName(record: {
  class_name?: string | null;
  lecturer_name?: string | null;
  nim?: string | null;
}): string {
  if (
    record.lecturer_name ||
    (record.nim && record.nim.toUpperCase().startsWith('DOSEN')) ||
    (record.class_name && record.class_name.toLowerCase().includes('dosen'))
  ) {
    return 'Dosen';
  }

  return normalizeAngkatan(record.class_name);
}

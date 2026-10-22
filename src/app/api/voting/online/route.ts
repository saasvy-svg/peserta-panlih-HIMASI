import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { 
  hasStudentVotedOnline, 
  recordOnlineVote, 
  getMemberAttendanceType,
  getOnlineVotingStats 
} from '@/lib/onlineVoting';
import { getWIBDate } from '@/lib/utils';
import { resolveActiveDay } from '@/lib/dayHelper';
import { QuickCountCandidate } from '@/types/database';

const DEFAULT_CANDIDATES: QuickCountCandidate[] = [
  {
    id: 'paslon-1',
    number: '01',
    name: 'Paslon 01 (Calon Ketua & Wakil)',
    tagline: 'Sinergi, Kolaboratif, dan Berintegritas',
    votes: 0,
  },
  {
    id: 'paslon-2',
    number: '02',
    name: 'Paslon 02 (Calon Ketua & Wakil)',
    tagline: 'Inovatif, Progresif, dan Transparan',
    votes: 0,
  },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nim = searchParams.get('nim');
    const supabase = createAdminClient();

    // 1. Ambil landing settings
    const { data: landingData } = await supabase
      .from('landing_settings')
      .select('extra_texts')
      .maybeSingle();

    const extraTexts = landingData?.extra_texts || {};
    const quickCountConfig = extraTexts.quick_count || {};
    const rawCandidates: QuickCountCandidate[] = quickCountConfig.candidates || DEFAULT_CANDIDATES;

    // Bersihkan kandidat (jangan bocorkan perolehan suara ke pemilih publik)
    const publicCandidates = rawCandidates.map((c) => ({
      id: c.id,
      number: c.number,
      name: c.name,
      ketua: c.ketua || null,
      wakil_ketua: c.wakil_ketua || null,
      visi: c.visi || null,
      misi: c.misi || null,
      tagline: c.tagline || '',
      photo_url: c.photo_url || null,
    }));

    // Opsi Golput Resmi
    const golputOption = {
      id: 'golput',
      number: '00',
      name: 'Kotak Kosong / Golput (Tidak Memilih)',
      tagline: 'Menyalurkan hak pilih tanpa memilih pasangan calon manapun',
      is_golput: true,
    };

    let hasVoted = false;
    let attendanceType = 'offline';

    if (nim) {
      const cleanNim = nim.trim();
      hasVoted = await hasStudentVotedOnline(cleanNim);
      attendanceType = await getMemberAttendanceType(cleanNim);
    }

    return NextResponse.json({
      success: true,
      candidates: publicCandidates,
      golputOption,
      has_voted: hasVoted,
      attendance_type: attendanceType,
      is_locked: Boolean(quickCountConfig.is_locked),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Gagal memuat bilik suara' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      nim,
      name,
      class_name,
      voter_role = 'mahasiswa',
      choice_id,
      choice_number,
      choice_name,
      is_golput = false,
    } = body;

    if (!nim || !choice_id) {
      return NextResponse.json(
        { error: 'NIM dan pilihan pasangan calon wajib diisi.' },
        { status: 400 }
      );
    }

    const cleanNim = String(nim).trim().toUpperCase();
    const supabase = createAdminClient();

    // 1. Ambil setting sesi aktif
    const { data: landingData } = await supabase
      .from('landing_settings')
      .select('extra_texts')
      .maybeSingle();

    const extraTexts = landingData?.extra_texts || {};
    const quickCountConfig = extraTexts.quick_count || {};

    // Cek apakah voting sedang dikunci oleh admin
    if (quickCountConfig.is_locked) {
      return NextResponse.json(
        { error: 'Pemungutan suara online sedang ditutup/dikunci oleh panitia.' },
        { status: 403 }
      );
    }

    // 2. Verifikasi status online pemilih
    const attendanceType = await getMemberAttendanceType(cleanNim);
    if (attendanceType !== 'online') {
      return NextResponse.json(
        {
          error:
            'NIM Anda terdaftar sebagai Pemilih Offline (Tatap Muka). Silakan mencoblos langsung di Bilik Suara Fisik Panitia Pemira.',
        },
        { status: 403 }
      );
    }

    // 3. Verifikasi apakah sudah absen pada hari ini
    const dayResolution = resolveActiveDay(extraTexts);
    const targetDate = dayResolution.effectiveDate;

    let query = supabase
      .from('attendances')
      .select('id, status')
      .eq('attendance_date', targetDate);

    if (cleanNim.startsWith('DOSEN')) {
      query = query.eq('name', name || cleanNim);
    } else {
      query = query.eq('nim', cleanNim);
    }

    const { data: attendance } = await query.maybeSingle();
    if (!attendance) {
      return NextResponse.json(
        {
          error: 'Anda belum mengisi presensi kehadiran hari ini. Silakan lakukan presensi terlebih dahulu sebelum mencoblos.',
        },
        { status: 403 }
      );
    }

    // 4. Catat suara online secara rahasia ke Supabase
    const result = await recordOnlineVote({
      nim: cleanNim,
      name,
      class_name,
      voter_role,
      choice_id,
      choice_number: choice_number || (is_golput ? '00' : '01'),
      choice_name: choice_name || (is_golput ? 'Kotak Kosong / Golput' : 'Paslon'),
      is_golput: Boolean(is_golput),
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Gagal menyimpan suara.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Hak suara Anda berhasil dicatat secara sah, rahasia, dan berintegritas!',
      receipt: {
        nim: cleanNim,
        voted_at: new Date().toISOString(),
        status: 'Suara Sah Terverifikasi',
      },
    });
  } catch (err: any) {
    console.error('Online voting error:', err);
    return NextResponse.json(
      { error: err.message || 'Terjadi kesalahan sistem saat pemungutan suara.' },
      { status: 500 }
    );
  }
}

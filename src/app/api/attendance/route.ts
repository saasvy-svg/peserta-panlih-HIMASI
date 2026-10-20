import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { updateOrAppendAttendanceInSheet } from '@/lib/googleSheets';
import { normalizeAngkatan, getTargetTabName } from '@/utils/angkatan';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }
  return '127.0.0.1';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      student_id,
      nim,
      name,
      class_name,
      lecturer_name,
      status = 'Hadir',
      notes,
      admin_override = false,
    } = body;

    if (!nim || !name || !class_name) {
      return NextResponse.json(
        { error: 'NIM, Nama, dan Angkatan wajib diisi' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS
    const clientIp = getClientIp(request);
    const isAdminOverride = Boolean(admin_override);

    // 1. Cek apakah NIM sudah presensi hari ini
    let query = supabase
      .from('attendances')
      .select('id, check_in_time, status')
      .eq('attendance_date', today);

    if (nim.startsWith('DOSEN')) {
      query = query.eq('name', name);
    } else {
      query = query.eq('nim', nim);
    }

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          error: `Anda sudah tercatat presensi hari ini pada pk ${existing.check_in_time.slice(0, 5)} WIB (${existing.status}).`,
          existing,
        },
        { status: 409 }
      );
    }

    // 2. Proteksi Anti-Titip Absen: Cek saklar pengaturan
    let isAntiTitipEnabled = true;
    try {
      const { data: landingData } = await supabase
        .from('landing_settings')
        .select('extra_texts')
        .maybeSingle();

      if (landingData?.extra_texts && typeof landingData.extra_texts.anti_titip_enabled === 'boolean') {
        isAntiTitipEnabled = landingData.extra_texts.anti_titip_enabled;
      }
    } catch (e) {}

    // Bypassed jika saklar dinonaktifkan, atau diabsenkan langsung oleh Admin, atau untuk Dosen
    if (isAntiTitipEnabled && !isAdminOverride && !nim.startsWith('DOSEN')) {
      const isLocalIp = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';
      if (!isLocalIp) {
        const { data: duplicateDevice } = await supabase
          .from('attendances')
          .select('id, name, nim, check_in_time')
          .eq('attendance_date', today)
          .eq('device_info', clientIp)
          .maybeSingle();

        if (duplicateDevice) {
          return NextResponse.json(
            {
              error: `Perangkat / HP ini sudah digunakan untuk presensi hari ini oleh: ${duplicateDevice.name} (${duplicateDevice.nim}) pada pk ${duplicateDevice.check_in_time.slice(0, 5)} WIB. Demi ketertiban (anti-titip absen), 1 HP hanya boleh absen 1 kali. Jika HP Anda terkendala, silakan melapor ke Admin/Dosen untuk diabsenkan manual.`,
              code: 'DEVICE_IP_LIMIT_EXCEEDED',
            },
            { status: 403 }
          );
        }
      }
    }

    // 3. Simpan absensi ke Supabase
    const insertPayload: any = {
      student_id: student_id || null,
      nim,
      name,
      class_name: normalizeAngkatan(class_name),
      attendance_date: today,
      check_in_time: nowTime,
      status,
      notes: notes || (isAdminOverride ? 'Diabsenkan oleh Admin (Kendala HP/Perangkat)' : null),
      device_info: isAdminOverride ? 'ADMIN_OVERRIDE' : clientIp,
    };

    if (lecturer_name) {
      insertPayload.lecturer_name = lecturer_name;
    }

    let { data: newRecord, error: insertError } = await supabase
      .from('attendances')
      .insert(insertPayload)
      .select()
      .single();

    // Fallback if lecturer_name column is not in DB yet
    if (insertError && insertError.message.includes('lecturer_name')) {
      delete insertPayload.lecturer_name;
      const retry = await supabase
        .from('attendances')
        .insert(insertPayload)
        .select()
        .single();
      newRecord = retry.data;
      insertError = retry.error;
    }

    if (insertError) {
      console.error('Error insert attendance:', insertError);
      return NextResponse.json(
        { error: 'Gagal mencatat presensi ke database: ' + insertError.message },
        { status: 500 }
      );
    }

    // 4. Integrasi Realtime Google Sheets (In-Place Update jika sudah pre-populated atau Append jika belum)
    try {
      const { data: config } = await supabase
        .from('sheet_configs')
        .select('*')
        .eq('sheet_role', 'admin')
        .maybeSingle();

      if (config && config.sheet_id && config.sync_mode !== 'manual_only') {
        try {
          await updateOrAppendAttendanceInSheet(config.sheet_id, {
            nim,
            name,
            class_name,
            lecturer_name,
            attendance_date: today,
            check_in_time: nowTime,
            status,
            notes: insertPayload.notes,
          });
        } catch (syncErr: any) {
          console.error('Realtime Google Sheets update error:', syncErr?.message || syncErr);
        }
      }
    } catch (sheetErr: any) {
      console.error('Google Sheets check error:', sheetErr.message);
    }

    return NextResponse.json({
      success: true,
      message: isAdminOverride
        ? `Presensi mahasiswa ${name} berhasil dicatat oleh Admin!`
        : 'Presensi berhasil dicatat!',
      data: newRecord,
    });
  } catch (error: any) {
    console.error('API Attendance Error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan sistem' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const className = searchParams.get('class');
  const status = searchParams.get('status');

  const supabase = createAdminClient();

  try {
    let query = supabase
      .from('attendances')
      .select('*')
      .eq('attendance_date', date)
      .order('check_in_time', { ascending: false });

    if (className && className !== 'all') {
      query = query.eq('class_name', className);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: 'Gagal memuat riwayat presensi' }, { status: 500 });
  }
}

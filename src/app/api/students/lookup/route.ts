import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { normalizeAngkatan } from '@/utils/angkatan';
import { getWIBDate } from '@/lib/utils';
import { resolveActiveDay } from '@/lib/dayHelper';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawNim = searchParams.get('nim');

  if (!rawNim) {
    // Return active day info if no NIM provided
    let extraTexts: any = null;
    try {
      const { data: landingData } = await supabase
        .from('landing_settings')
        .select('extra_texts')
        .maybeSingle();
      extraTexts = landingData?.extra_texts || null;
    } catch (e) {}

    const dayResolution = resolveActiveDay(extraTexts);
    return NextResponse.json({
      activeDay: dayResolution.activeDay,
      day1Date: dayResolution.day1Date,
      day2Date: dayResolution.day2Date,
    });
  }

  const nim = rawNim.trim();
  const supabase = createAdminClient();

  try {
    // 1. Cari mahasiswa berdasarkan NIM (case-insensitive)
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id, nim, name, class_name, is_active')
      .ilike('nim', nim)
      .eq('is_active', true)
      .single();

    if (studentError || !student) {
      return NextResponse.json({
        error: 'NIM tidak terdaftar di sistem perkuliahan.',
        student: null,
      }, { status: 404 });
    }

    // Ambil setting sesi aktif (Hari 1 atau Hari 2)
    let extraTexts: any = null;
    try {
      const { data: landingData } = await supabase
        .from('landing_settings')
        .select('extra_texts')
        .maybeSingle();
      extraTexts = landingData?.extra_texts || null;
    } catch (e) {}

    const dayResolution = resolveActiveDay(extraTexts);
    const activeDay = dayResolution.activeDay;
    const targetDate = dayResolution.effectiveDate;

    // 2. Cek apakah sudah absen pada sesi hari ini
    const { data: attendance } = await supabase
      .from('attendances')
      .select('id, check_in_time, status')
      .eq('nim', student.nim)
      .eq('attendance_date', targetDate)
      .maybeSingle();

    return NextResponse.json({
      student: {
        id: student.id,
        nim: student.nim,
        name: student.name,
        class_name: normalizeAngkatan(student.class_name),
      },
      activeDay,
      attendanceDate: targetDate,
      existingAttendance: attendance || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Gagal mencari data mahasiswa' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { normalizeAngkatan } from '@/utils/angkatan';
import { getWIBDate } from '@/lib/utils';
import { resolveActiveDay } from '@/lib/dayHelper';
import { checkAttendanceTimeLock } from '@/lib/timeLock';
import { getMemberAttendanceType, hasStudentVotedOnline } from '@/lib/onlineVoting';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawNim = searchParams.get('nim');
  const supabase = createAdminClient();

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
    const timeLock = checkAttendanceTimeLock(extraTexts);
    return NextResponse.json({
      activeDay: dayResolution.activeDay,
      day1Date: dayResolution.day1Date,
      day2Date: dayResolution.day2Date,
      timeLock,
    });
  }

  const nim = rawNim.trim();

  try {
    // 1. Cari mahasiswa berdasarkan NIM (case-insensitive)
    let student: any = null;
    let studentError: any = null;

    // Coba select dengan kolom attendance_type
    const resWithCol = await supabase
      .from('students')
      .select('id, nim, name, class_name, is_active, attendance_type')
      .ilike('nim', nim)
      .eq('is_active', true)
      .maybeSingle();

    if (resWithCol.error && resWithCol.error.message.includes('attendance_type')) {
      // Fallback jika kolom attendance_type belum ditambahkan di DB
      const resFallback = await supabase
        .from('students')
        .select('id, nim, name, class_name, is_active')
        .ilike('nim', nim)
        .eq('is_active', true)
        .maybeSingle();
      student = resFallback.data;
      studentError = resFallback.error;
    } else {
      student = resWithCol.data;
      studentError = resWithCol.error;
    }

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

    // 3. Tentukan tipe kehadiran (online vs offline) & status mencoblos online
    const attendanceType = await getMemberAttendanceType(student.nim, student);
    const hasVotedOnline = await hasStudentVotedOnline(student.nim);

    return NextResponse.json({
      student: {
        id: student.id,
        nim: student.nim,
        name: student.name,
        class_name: normalizeAngkatan(student.class_name),
        attendance_type: attendanceType, // 'online' | 'offline'
        has_voted_online: hasVotedOnline,
      },
      activeDay,
      attendanceDate: targetDate,
      timeLock: checkAttendanceTimeLock(extraTexts),
      existingAttendance: attendance || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Gagal mencari data mahasiswa' }, { status: 500 });
  }
}

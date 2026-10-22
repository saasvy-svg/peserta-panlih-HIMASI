import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { normalizeAngkatan } from '@/utils/angkatan';
import { getWIBDate } from '@/lib/utils';
import { resolveActiveDay } from '@/lib/dayHelper';
import { checkAttendanceTimeLock } from '@/lib/timeLock';
import { getMemberAttendanceType, hasStudentVotedOnline } from '@/lib/onlineVoting';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache',
      },
    });
  }

  const nim = rawNim.trim();

  try {
    // 1. Ambil data mahasiswa dan landing_settings secara paralel
    const [studentRes, landingRes] = await Promise.all([
      supabase
        .from('students')
        .select('id, nim, name, class_name, is_active, attendance_type')
        .ilike('nim', nim)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('landing_settings')
        .select('extra_texts')
        .maybeSingle(),
    ]);

    let student: any = studentRes.data;
    if (studentRes.error && studentRes.error.message.includes('attendance_type')) {
      const resFallback = await supabase
        .from('students')
        .select('id, nim, name, class_name, is_active')
        .ilike('nim', nim)
        .eq('is_active', true)
        .maybeSingle();
      student = resFallback.data;
    }

    if (!student) {
      return NextResponse.json({
        error: 'NIM tidak terdaftar di sistem perkuliahan.',
        student: null,
      }, { status: 404 });
    }

    const extraTexts = landingRes.data?.extra_texts || null;
    const dayResolution = resolveActiveDay(extraTexts);
    const activeDay = dayResolution.activeDay;
    const targetDate = dayResolution.effectiveDate;

    // 2. Ambil absensi hari ini, attendanceType, dan status vote online secara paralel
    const [attendanceRes, attendanceType, hasVotedOnline] = await Promise.all([
      supabase
        .from('attendances')
        .select('id, check_in_time, status')
        .eq('nim', student.nim)
        .eq('attendance_date', targetDate)
        .maybeSingle(),
      getMemberAttendanceType(student.nim, student, extraTexts),
      hasStudentVotedOnline(student.nim, extraTexts),
    ]);

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
      existingAttendance: attendanceRes.data || null,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Gagal mencari data mahasiswa' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { normalizeAngkatan } from '@/utils/angkatan';
import { getWIBDate } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawNim = searchParams.get('nim');

  if (!rawNim) {
    return NextResponse.json({ error: 'NIM wajib disertakan' }, { status: 400 });
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

    // 2. Cek apakah sudah absen hari ini
    const today = getWIBDate();
    const { data: attendance } = await supabase
      .from('attendances')
      .select('id, check_in_time, status')
      .eq('nim', student.nim)
      .eq('attendance_date', today)
      .single();

    return NextResponse.json({
      student: {
        id: student.id,
        nim: student.nim,
        name: student.name,
        class_name: normalizeAngkatan(student.class_name),
      },
      existingAttendance: attendance || null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Gagal mencari data mahasiswa' }, { status: 500 });
  }
}

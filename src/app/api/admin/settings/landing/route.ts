import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/admin';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('landing_settings')
      .select('*')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const defaultExtra = {
      badge_text: 'Presensi Dibuka',
      instruction_title: 'Panduan Presensi Mahasiswa',
      instructions: [
        'Masukkan NIM lengkap Anda pada kolom yang tersedia di formulir sebelah.',
        'Pastikan Nama dan Angkatan yang muncul otomatis sudah sesuai dengan identitas Anda.',
        'Setiap mahasiswa hanya dapat melakukan absensi 1 kali per hari perkuliahan.',
        'Jika berhalangan, pilih opsi Izin atau Sakit dan cantumkan alasan yang jelas.',
      ],
      lecturers: [],
      anti_titip_enabled: true,
      card1_title: 'Waktu Presensi',
      card1_desc: '07.00 - 17.00 WIB',
      card2_title: 'Presisi NIM',
      card2_desc: 'Anti-typo & Auto-fill',
      card3_title: 'Sinkronisasi',
      card3_desc: 'Terkoneksi Sheets',
      footer_text: 'Sistem Absensi Terintegrasi.',
    };

    return NextResponse.json({
      data: {
        ...(data || {
          institution_name: 'Universitas Sains & Teknologi',
          page_title: 'Presensi Perkuliahan Mahasiswa',
          page_subtitle: 'Silakan masukkan NIM Anda untuk mencatat kehadiran perkuliahan hari ini.',
          announcement: 'Batas absensi matakuliah dibuka mulai jam 07:00 hingga 17:00 WIB setiap hari kuliah.',
          logo_url: '',
          hero_images: [],
        }),
        extra_texts: data?.extra_texts ? { ...defaultExtra, ...data.extra_texts } : defaultExtra,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      institution_name,
      page_title,
      page_subtitle,
      announcement,
      logo_url,
      hero_images,
      extra_texts,
    } = body;

    const supabase = createAdminClient();

    // 1. Get existing id
    const { data: existing } = await supabase
      .from('landing_settings')
      .select('id')
      .maybeSingle();

    const basePayload: any = {
      institution_name,
      page_title,
      page_subtitle,
      announcement,
      logo_url,
      hero_images: hero_images || [],
      updated_at: new Date().toISOString(),
    };

    // Try including extra_texts
    let savePayload = { ...basePayload };
    if (extra_texts) {
      savePayload.extra_texts = extra_texts;
    }

    let result;
    if (existing) {
      result = await supabase
        .from('landing_settings')
        .update(savePayload)
        .eq('id', existing.id)
        .select()
        .single();

      // If failed due to extra_texts column not existing, retry with basePayload
      if (result.error && result.error.message.includes('extra_texts')) {
        result = await supabase
          .from('landing_settings')
          .update(basePayload)
          .eq('id', existing.id)
          .select()
          .single();
      }
    } else {
      result = await supabase
        .from('landing_settings')
        .insert(savePayload)
        .select()
        .single();

      if (result.error && result.error.message.includes('extra_texts')) {
        result = await supabase
          .from('landing_settings')
          .insert(basePayload)
          .select()
          .single();
      }
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Pengaturan tampilan dan teks berhasil diperbarui!',
      data: result.data,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

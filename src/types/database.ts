export interface Student {
  id: string;
  nim: string;
  name: string;
  class_name: string;
  phone?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Attendance {
  id: string;
  student_id: string | null;
  nim: string;
  name: string;
  class_name: string;
  lecturer_name?: string | null;
  attendance_date: string;
  check_in_time: string;
  status: 'Hadir' | 'Terlambat' | 'Izin' | 'Sakit';
  notes?: string | null;
  device_info?: string | null;
  created_at: string;
}

export interface ExtraTexts {
  badge_text?: string;
  instruction_title?: string;
  instructions?: string[];
  lecturers?: string[];
  card1_title?: string;
  card1_desc?: string;
  card2_title?: string;
  card2_desc?: string;
  card3_title?: string;
  card3_desc?: string;
  footer_text?: string;
}

export interface LandingSettings {
  id: string;
  institution_name: string;
  page_title: string;
  page_subtitle: string;
  announcement: string;
  logo_url?: string | null;
  hero_images: string[];
  academic_year: string;
  extra_texts?: ExtraTexts;
  updated_at?: string;
}

export interface SheetConfig {
  id: string;
  sheet_role: 'admin';
  sheet_id: string;
  sheet_name: string;
  sync_mode: 'manual' | 'realtime';
  last_synced_at?: string | null;
  updated_at?: string;
}

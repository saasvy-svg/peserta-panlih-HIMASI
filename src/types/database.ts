export interface Student {
  id: string;
  nim: string;
  name: string;
  class_name: string;
  phone?: string | null;
  attendance_type?: 'online' | 'offline';
  is_active: boolean;
  created_at: string;
}

export interface OnlineVote {
  id: string;
  nim: string;
  name?: string;
  class_name?: string;
  voter_role?: 'mahasiswa' | 'dosen';
  choice_id: string;
  choice_number: string;
  choice_name: string;
  is_golput: boolean;
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

export interface DayConfigItem {
  dayNumber: number;
  date: string;
  label?: string;
}

export interface VotingRecord {
  has_voted: boolean;
  voted_at?: string;
  notes?: string;
}

export interface QuickCountCandidate {
  id: string;
  number: string;
  name: string;
  ketua?: string;
  wakil_ketua?: string;
  visi?: string;
  misi?: string[] | string;
  tagline?: string;
  photo_url?: string;
  votes: number;
}

export interface QuickCountConfig {
  is_locked?: boolean;
  invalid_votes?: number;
  notes?: string;
  candidates?: QuickCountCandidate[];
  updated_at?: string;
}

export interface ExtraTexts {
  badge_text?: string;
  instruction_title?: string;
  instructions?: string[];
  lecturers?: string[];
  anti_titip_enabled?: boolean;
  active_day?: number | 'auto';
  day1_date?: string;
  day2_date?: string;
  days?: DayConfigItem[];
  time_lock_enabled?: boolean;
  open_time?: string;
  close_time?: string;
  time_lock_message?: string;
  voting_records?: Record<string, VotingRecord>;
  online_members?: Record<string, 'online' | 'offline'>;
  online_votes_fallback?: OnlineVote[];
  online_votes_merged?: boolean;
  quick_count?: QuickCountConfig;
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

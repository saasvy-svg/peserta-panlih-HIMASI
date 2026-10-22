import { createAdminClient } from '@/utils/supabase/admin';
import { getWIBLocaleString, getWIBDate } from '@/lib/utils';
import { OnlineVote, QuickCountCandidate } from '@/types/database';

export interface OnlineVotingStats {
  totalOnlineVoters: number;
  totalOnlineStudents: number;
  totalOnlineLecturers: number;
  onlineAttended: number;
  onlineVoted: number;
  onlineTurnoutPct: number;
  candidateTallies: Record<string, {
    number: string;
    name: string;
    votes: number;
  }>;
  golputCount: number;
  totalOnlineVotesCast: number;
  isMerged: boolean;
}

/**
 * Mendapatkan status online/offline untuk student atau dosen
 */
export async function getMemberAttendanceType(
  nim: string,
  studentFromDb?: { attendance_type?: string | null } | null,
  providedExtraTexts?: any
): Promise<'online' | 'offline'> {
  if (!nim) return 'offline';
  const cleanNim = String(nim).trim().toUpperCase();

  // 1. Cek dari providedExtraTexts (jika sudah di-fetch oleh pemanggil secara paralel)
  if (providedExtraTexts?.online_members && providedExtraTexts.online_members[cleanNim]) {
    return providedExtraTexts.online_members[cleanNim] === 'online' ? 'online' : 'offline';
  }

  // 2. Cek dari kolom attendance_type jika disediakan
  if (studentFromDb?.attendance_type) {
    const typeStr = String(studentFromDb.attendance_type).trim().toLowerCase();
    if (typeStr === 'online' || typeStr === 'daring') {
      return 'online';
    }
    return 'offline';
  }

  const supabase = createAdminClient();

  // 3. Prioritaskan setting eksplisit dari extra_texts.online_members (tempat Admin toggle realtime)
  if (!providedExtraTexts) {
    try {
      const { data: landingData } = await supabase
        .from('landing_settings')
        .select('extra_texts')
        .maybeSingle();

      const onlineMembers: Record<string, 'online' | 'offline'> = landingData?.extra_texts?.online_members || {};
      if (onlineMembers[cleanNim]) {
        return onlineMembers[cleanNim] === 'online' ? 'online' : 'offline';
      }
    } catch (e) {}
  }

  // 4. Fallback query langsung ke tabel students di database
  try {
    const { data: s } = await supabase
      .from('students')
      .select('attendance_type')
      .ilike('nim', cleanNim)
      .maybeSingle();

    if (s?.attendance_type) {
      const typeStr = String(s.attendance_type).trim().toLowerCase();
      if (typeStr === 'online' || typeStr === 'daring') {
        return 'online';
      }
    }
  } catch (e) {}

  return 'offline';
}

/**
 * Memeriksa apakah NIM sudah mencoblos secara online
 */
export async function hasStudentVotedOnline(nim: string, providedExtraTexts?: any): Promise<boolean> {
  const cleanNim = String(nim).trim().toUpperCase();

  // 1. Cek cepat di providedExtraTexts jika sudah di-cache oleh pemanggil
  if (providedExtraTexts) {
    if (providedExtraTexts.voting_records && providedExtraTexts.voting_records[cleanNim]?.has_voted) {
      return true;
    }
    const fallbackVotes: OnlineVote[] = providedExtraTexts.online_votes_fallback || [];
    if (fallbackVotes.some((v) => String(v.nim).trim().toUpperCase() === cleanNim)) {
      return true;
    }
  }

  const supabase = createAdminClient();

  // 2. Cek tabel online_votes jika ada
  try {
    const { data, error } = await supabase
      .from('online_votes')
      .select('id')
      .ilike('nim', cleanNim)
      .maybeSingle();

    if (!error && data) {
      return true;
    }
  } catch (e) {}

  // 3. Cek fallback di extra_texts jika belum dicek
  if (!providedExtraTexts) {
    try {
      const { data: landingData } = await supabase
        .from('landing_settings')
        .select('extra_texts')
        .maybeSingle();

      const extraTexts = landingData?.extra_texts || {};
      const votingRecords = extraTexts.voting_records || {};
      if (votingRecords[cleanNim]?.has_voted) {
        return true;
      }

      const fallbackVotes: OnlineVote[] = extraTexts.online_votes_fallback || [];
      if (fallbackVotes.some((v) => String(v.nim).trim().toUpperCase() === cleanNim)) {
        return true;
      }
    } catch (e) {}
  }

  return false;
}

/**
 * Mencatat suara online (Confidential: disimpan di Supabase, TIDAK di Google Sheets)
 */
export async function recordOnlineVote(voteData: {
  nim: string;
  name?: string;
  class_name?: string;
  voter_role?: 'mahasiswa' | 'dosen';
  choice_id: string;
  choice_number: string;
  choice_name: string;
  is_golput: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const cleanNim = String(voteData.nim).trim().toUpperCase();
  const nowWib = getWIBLocaleString();
  const supabase = createAdminClient();

  // Cek apakah sudah pernah mencoblos
  const alreadyVoted = await hasStudentVotedOnline(cleanNim);
  if (alreadyVoted) {
    return { success: false, error: 'Anda sudah menggunakan hak suara Anda sebelumnya.' };
  }

  const voteRecord: OnlineVote = {
    id: `ov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nim: cleanNim,
    name: voteData.name || '',
    class_name: voteData.class_name || '',
    voter_role: voteData.voter_role || 'mahasiswa',
    choice_id: voteData.choice_id,
    choice_number: voteData.choice_number,
    choice_name: voteData.choice_name,
    is_golput: Boolean(voteData.is_golput),
    created_at: new Date().toISOString(),
  };

  // 1. Simpan ke tabel public.online_votes (jika tabel ada)
  let insertedToTable = false;
  try {
    const { error: insertErr } = await supabase
      .from('online_votes')
      .insert({
        nim: cleanNim,
        name: voteRecord.name,
        class_name: voteRecord.class_name,
        voter_role: voteRecord.voter_role,
        choice_id: voteRecord.choice_id,
        choice_number: voteRecord.choice_number,
        choice_name: voteRecord.choice_name,
        is_golput: voteRecord.is_golput,
      });

    if (!insertErr) {
      insertedToTable = true;
    }
  } catch (e) {}

  // 2. Selalu sinkronkan ke landing_settings.extra_texts (voting_records + online_votes_fallback)
  try {
    const { data: landingData } = await supabase
      .from('landing_settings')
      .select('id, extra_texts')
      .maybeSingle();

    if (landingData) {
      const extraTexts = landingData.extra_texts || {};
      const votingRecords = extraTexts.voting_records || {};
      const fallbackVotes: OnlineVote[] = extraTexts.online_votes_fallback || [];

      // Catat di voting_records agar di antrean terdeteksi sudah mencoblos
      votingRecords[cleanNim] = {
        has_voted: true,
        voted_at: nowWib,
        notes: 'Online E-Voting',
      };

      // Simpan backup confidential vote
      if (!fallbackVotes.some((v) => String(v.nim).trim().toUpperCase() === cleanNim)) {
        fallbackVotes.push(voteRecord);
      }

      await supabase
        .from('landing_settings')
        .update({
          extra_texts: {
            ...extraTexts,
            voting_records: votingRecords,
            online_votes_fallback: fallbackVotes,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', landingData.id);
    }
  } catch (e) {
    console.error('Error updating landing settings with online vote:', e);
  }

  return { success: true };
}

/**
 * Mengambil ringkasan statistik pemungutan suara online (HANYA AGREGAT, RAHASIA DAPUR)
 */
export async function getOnlineVotingStats(date?: string): Promise<OnlineVotingStats> {
  const targetDate = date || getWIBDate();
  const supabase = createAdminClient();

  // 1. Ambil landing settings
  const { data: landingData } = await supabase
    .from('landing_settings')
    .select('extra_texts')
    .maybeSingle();

  const extraTexts = landingData?.extra_texts || {};
  const onlineMembers: Record<string, 'online' | 'offline'> = extraTexts.online_members || {};
  const fallbackVotes: OnlineVote[] = extraTexts.online_votes_fallback || [];
  const quickCountConfig = extraTexts.quick_count || {};
  const candidates: QuickCountCandidate[] = quickCountConfig.candidates || [];
  const isMerged = Boolean(extraTexts.online_votes_merged);

  // 2. Ambil students
  const { data: allStudents } = await supabase
    .from('students')
    .select('nim, attendance_type')
    .eq('is_active', true);

  const onlineStudentsSet = new Set<string>();
  (allStudents || []).forEach((s) => {
    const nimKey = String(s.nim).trim().toUpperCase();
    if (s.attendance_type === 'online' || onlineMembers[nimKey] === 'online') {
      onlineStudentsSet.add(nimKey);
    }
  });

  // 3. Ambil dosen online
  const lecturers: string[] = extraTexts.lecturers || [];
  const onlineLecturersSet = new Set<string>();
  lecturers.forEach((doc, idx) => {
    const docNim = `DOSEN-${String(idx + 1).padStart(2, '0')}`;
    const docKey = doc.trim().toUpperCase();
    if (onlineMembers[docKey] === 'online' || onlineMembers[docNim] === 'online') {
      onlineLecturersSet.add(docNim);
    }
  });

  const totalOnlineStudents = onlineStudentsSet.size;
  const totalOnlineLecturers = onlineLecturersSet.size;
  const totalOnlineVoters = totalOnlineStudents + totalOnlineLecturers;

  // 4. Ambil absensi hari ini untuk pemilih online
  const { data: attendances } = await supabase
    .from('attendances')
    .select('nim, name')
    .eq('attendance_date', targetDate);

  let onlineAttended = 0;
  (attendances || []).forEach((att) => {
    const upperNim = String(att.nim || '').trim().toUpperCase();
    const upperName = String(att.name || '').trim().toUpperCase();
    if (onlineStudentsSet.has(upperNim) || onlineLecturersSet.has(upperNim) || onlineMembers[upperName] === 'online') {
      onlineAttended++;
    }
  });

  // 5. Ambil data suara online (coba dari public.online_votes, jika tidak ada pakai fallback)
  let allVotes: { choice_id: string; choice_number: string; choice_name: string; is_golput: boolean }[] = [];
  try {
    const { data: dbVotes, error: dbErr } = await supabase
      .from('online_votes')
      .select('choice_id, choice_number, choice_name, is_golput');

    if (!dbErr && dbVotes && dbVotes.length > 0) {
      allVotes = dbVotes;
    } else {
      allVotes = fallbackVotes;
    }
  } catch (e) {
    allVotes = fallbackVotes;
  }

  // Agregasi suara (TIDAK menyertakan NIM/identitas pemilih)
  const candidateTallies: Record<string, { number: string; name: string; votes: number }> = {};
  candidates.forEach((c) => {
    candidateTallies[c.id] = {
      number: c.number,
      name: c.name,
      votes: 0,
    };
  });

  let golputCount = 0;
  allVotes.forEach((v) => {
    if (v.is_golput || v.choice_id === 'golput') {
      golputCount++;
    } else if (candidateTallies[v.choice_id]) {
      candidateTallies[v.choice_id].votes++;
    } else {
      // Jika paslon tidak terdaftar di candidateTallies, pasangkan berdasarkan number
      const foundCand = candidates.find((c) => c.number === v.choice_number);
      if (foundCand) {
        if (!candidateTallies[foundCand.id]) {
          candidateTallies[foundCand.id] = { number: foundCand.number, name: foundCand.name, votes: 0 };
        }
        candidateTallies[foundCand.id].votes++;
      } else {
        candidateTallies[v.choice_id] = {
          number: v.choice_number || '?',
          name: v.choice_name || 'Paslon ' + v.choice_id,
          votes: 1,
        };
      }
    }
  });

  const onlineVoted = allVotes.length;
  const onlineTurnoutPct = totalOnlineVoters > 0 ? Math.round((onlineVoted / totalOnlineVoters) * 100) : 0;

  return {
    totalOnlineVoters,
    totalOnlineStudents,
    totalOnlineLecturers,
    onlineAttended,
    onlineVoted,
    onlineTurnoutPct,
    candidateTallies,
    golputCount,
    totalOnlineVotesCast: onlineVoted,
    isMerged,
  };
}

/**
 * Menghapus / mereset data suara online untuk seorang mahasiswa tertentu (untuk keperluan testing)
 */
export async function removeStudentOnlineVote(nim: string): Promise<void> {
  const cleanNim = String(nim).trim().toUpperCase();
  const supabase = createAdminClient();

  // 1. Hapus dari public.online_votes
  try {
    await supabase.from('online_votes').delete().ilike('nim', cleanNim);
  } catch (e) {}

  // 2. Hapus dari landing_settings.extra_texts
  try {
    const { data: landingData } = await supabase
      .from('landing_settings')
      .select('id, extra_texts')
      .maybeSingle();

    if (landingData) {
      const extraTexts = landingData.extra_texts || {};
      const votingRecords = { ...(extraTexts.voting_records || {}) };
      delete votingRecords[cleanNim];

      const fallbackVotes = (extraTexts.online_votes_fallback || []).filter(
        (v: OnlineVote) => String(v.nim).trim().toUpperCase() !== cleanNim
      );

      await supabase
        .from('landing_settings')
        .update({
          extra_texts: {
            ...extraTexts,
            voting_records: votingRecords,
            online_votes_fallback: fallbackVotes,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', landingData.id);
    }
  } catch (e) {}
}

/**
 * Mereset SEMUA data suara online pengetesan kembali ke 0
 */
export async function resetAllOnlineVotes(): Promise<void> {
  const supabase = createAdminClient();

  // 1. Hapus semua baris dari public.online_votes
  try {
    await supabase.from('online_votes').delete().neq('nim', '___DUMMY_NOT_EXIST___');
  } catch (e) {}

  // 2. Bersihkan extra_texts (online_votes_fallback, unmerged, dan voting_records online)
  try {
    const { data: landingData } = await supabase
      .from('landing_settings')
      .select('id, extra_texts')
      .maybeSingle();

    if (landingData) {
      const extraTexts = landingData.extra_texts || {};
      const votingRecords = { ...(extraTexts.voting_records || {}) };

      // Hapus voting_records yang dicatat dari Online E-Voting
      Object.keys(votingRecords).forEach((key) => {
        if (votingRecords[key]?.notes === 'Online E-Voting') {
          delete votingRecords[key];
        }
      });

      await supabase
        .from('landing_settings')
        .update({
          extra_texts: {
            ...extraTexts,
            voting_records: votingRecords,
            online_votes_fallback: [],
            online_votes_merged: false,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', landingData.id);
    }
  } catch (e) {}
}

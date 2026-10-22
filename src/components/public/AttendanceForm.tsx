'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Loader2, 
  User, 
  GraduationCap, 
  Clock, 
  Send, 
  Check, 
  CalendarDays,
  UserCheck,
  Users,
  ChevronDown,
  BookOpen,
  Vote,
  Globe,
  Building,
  ShieldCheck,
  CheckCheck,
  Info,
  Lock,
  ArrowRight,
  Sparkles,
  X
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { createClient } from '@/utils/supabase/client';

interface AttendanceFormProps {
  lecturers?: string[];
}

interface StudentData {
  id: string;
  nim: string;
  name: string;
  class_name: string;
  attendance_type?: 'online' | 'offline';
  has_voted_online?: boolean;
}

interface VotingCandidate {
  id: string;
  number: string;
  name: string;
  ketua?: string | null;
  wakil_ketua?: string | null;
  visi?: string | null;
  misi?: string[] | string | null;
  tagline?: string;
  photo_url?: string | null;
  is_golput?: boolean;
}

export default function AttendanceForm({ lecturers = [] }: AttendanceFormProps) {
  // Tab Navigation: 'peserta' (Kiri) atau 'dosen' (Kanan)
  const [activeTab, setActiveTab] = useState<'peserta' | 'dosen'>('peserta');

  // ===============================
  // STATE MAHASISWA / PESERTA
  // ===============================
  const [nim, setNim] = useState('');
  const [student, setStudent] = useState<StudentData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState<{ time: string; status: string } | null>(null);

  // ===============================
  // STATE DOSEN
  // ===============================
  const [selectedLecturer, setSelectedLecturer] = useState<string>('');
  const [lecturerNip, setLecturerNip] = useState('');
  const [lecturerRole, setLecturerRole] = useState('Dosen');

  // Status & Submit
  const [status, setStatus] = useState<'Hadir' | 'Izin' | 'Sakit'>('Hadir');
  const [notes, setNotes] = useState('');
  const [currentDay, setCurrentDay] = useState<number>(1);
  const [timeLock, setTimeLock] = useState<{
    enabled: boolean;
    isOpen: boolean;
    openTime: string;
    closeTime: string;
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Receipt State
  const [successReceipt, setSuccessReceipt] = useState<{
    role: 'peserta' | 'dosen';
    nim?: string;
    name: string;
    class_name?: string;
    lecturer_name?: string;
    time: string;
    date: string;
    status: string;
    activeDay?: number;
    attendance_type?: 'online' | 'offline';
    has_voted_online?: boolean;
  } | null>(null);

  // ===============================
  // STATE BILIK SUARA DIGITAL (E-VOTING)
  // ===============================
  const [showVotingBooth, setShowVotingBooth] = useState(false);
  const [loadingBooth, setLoadingBooth] = useState(false);
  const [candidatesList, setCandidatesList] = useState<VotingCandidate[]>([]);
  const [golputCandidate, setGolputCandidate] = useState<VotingCandidate>({
    id: 'golput',
    number: '00',
    name: 'Kotak Kosong / Golput (Tidak Memilih)',
    tagline: 'Menyalurkan hak pilih tanpa memilih pasangan calon manapun',
    is_golput: true,
  });
  const [selectedCandidate, setSelectedCandidate] = useState<VotingCandidate | null>(null);
  const [confirmVoteModal, setConfirmVoteModal] = useState(false);
  const [viewVisiMisi, setViewVisiMisi] = useState<VotingCandidate | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [voteReceipt, setVoteReceipt] = useState<{
    voted_at: string;
    candidate_name: string;
    candidate_number: string;
  } | null>(null);

  // Fetch active day & time lock on initial mount
  useEffect(() => {
    fetch('/api/students/lookup')
      .then((r) => r.json())
      .then((d) => {
        if (d.activeDay) setCurrentDay(d.activeDay);
        if (d.timeLock) setTimeLock(d.timeLock);
      })
      .catch(() => {});
  }, []);

  // Debounced auto-lookup when NIM changes (Mode Peserta)
  useEffect(() => {
    if (activeTab !== 'peserta') return;

    const trimmedNim = nim.trim();
    if (trimmedNim.length < 4) {
      setStudent(null);
      setSearchError(null);
      setAlreadyCheckedIn(null);
      return;
    }

    const timer = setTimeout(() => {
      lookupNim(trimmedNim);
    }, 450);

    return () => clearTimeout(timer);
  }, [nim, activeTab]);

  const lookupNim = async (nimQuery: string) => {
    setIsSearching(true);
    setSearchError(null);
    setAlreadyCheckedIn(null);

    try {
      const res = await fetch(`/api/students/lookup?nim=${encodeURIComponent(nimQuery)}`);
      const data = await res.json();

      if (res.ok && data.student) {
        setStudent(data.student);
        if (data.activeDay) {
          setCurrentDay(data.activeDay);
        }
        if (data.timeLock) {
          setTimeLock(data.timeLock);
        }
        if (data.existingAttendance) {
          setAlreadyCheckedIn({
            time: data.existingAttendance.check_in_time,
            status: data.existingAttendance.status,
          });
        }
      } else {
        setStudent(null);
        setSearchError(data.error || 'NIM tidak terdaftar di sistem.');
      }
    } catch (err) {
      setSearchError('Gagal memeriksa data NIM. Silakan coba lagi.');
    } finally {
      setIsSearching(false);
    }
  };

  // Muat data Bilik Suara Digital
  const loadVotingBooth = async (studentNim: string) => {
    setLoadingBooth(true);
    try {
      const res = await fetch(`/api/voting/online?nim=${encodeURIComponent(studentNim)}`);
      const data = await res.json();
      if (res.ok && data.candidates) {
        setCandidatesList(data.candidates);
        if (data.golputOption) {
          setGolputCandidate(data.golputOption);
        }
        setSuccessReceipt(null);
        setShowVotingBooth(true);
      } else {
        toast.error(data.error || 'Gagal memuat kandidat bilik suara.');
      }
    } catch (e) {
      toast.error('Gagal terhubung ke bilik suara.');
    } finally {
      setLoadingBooth(false);
    }
  };

  // SUBMIT FORM PESERTA
  const handleSubmitPeserta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) {
      toast.error('Masukkan NIM yang valid terlebih dahulu.');
      return;
    }
    if (alreadyCheckedIn) {
      toast.warning('Anda sudah melakukan absensi hari ini!');
      return;
    }
    if (timeLock?.enabled && !timeLock.isOpen) {
      toast.error(timeLock.message);
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: student.id,
          nim: student.nim || nim.trim(),
          name: student.name,
          class_name: student.class_name,
          status,
          notes: notes.trim() || null,
        }),
      });

      const result = await res.json();

      if (res.ok) {
        setSubmitError(null);
        toast.success('Presensi peserta berhasil dicatat!');

        // Broadcast instan 0-detik ke dashboard admin
        try {
          const supabase = createClient();
          const channel = supabase.channel('himasi-live-sync');
          channel.subscribe((subStatus) => {
            if (subStatus === 'SUBSCRIBED') {
              channel.send({
                type: 'broadcast',
                event: 'attendance_checkin',
                payload: {
                  name: student.name,
                  nim: student.nim || nim.trim(),
                  class_name: student.class_name,
                  status,
                  attendance_type: student.attendance_type || 'offline',
                },
              });
            }
          });
        } catch (e) {}

        const checkInTime = result.data?.check_in_time || new Date().toLocaleTimeString('id-ID');
        setAlreadyCheckedIn({
          time: checkInTime,
          status,
        });

        // ========================================================
        // LOGIKA TRANSISI BILIK SUARA ONLINE VS OFFLINE
        // ========================================================
        const resolvedType = String(result.attendance_type || student.attendance_type || 'offline').trim().toLowerCase();
        const hasVoted = Boolean(result.has_voted_online ?? student.has_voted_online);

        setStudent((prev) => prev ? {
          ...prev,
          attendance_type: resolvedType === 'online' ? 'online' : 'offline',
          has_voted_online: hasVoted,
        } : null);

        if (resolvedType === 'online') {
          // Jika mahasiswa online dan belum mencoblos -> Buka Bilik Suara Digital!
          if (!hasVoted) {
            toast.info('Identitas terverifikasi sebagai Mahasiswa Online. Membuka Bilik Suara Digital...', {
              duration: 3500,
            });
            setSuccessReceipt(null);
            await loadVotingBooth(student.nim);
            return;
          }
        }

        // Tampilkan tanda terima kehadiran biasa
        setSuccessReceipt({
          role: 'peserta',
          nim: student.nim || nim.trim(),
          name: student.name,
          class_name: student.class_name,
          time: checkInTime,
          date: formatDate(new Date()),
          status,
          activeDay: result.activeDay || currentDay,
          attendance_type: resolvedType === 'online' ? 'online' : 'offline',
          has_voted_online: hasVoted,
        });
      } else {
        setSubmitError(result.error || 'Gagal mengirim presensi.');
        toast.error(result.error || 'Gagal mengirim presensi.');
      }
    } catch (err: any) {
      setSubmitError('Terjadi kesalahan jaringan.');
      toast.error('Terjadi kesalahan jaringan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // SUBMIT FORM DOSEN
  const handleSubmitDosen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLecturer) {
      toast.error('Pilih nama dosen terlebih dahulu.');
      return;
    }
    if (timeLock?.enabled && !timeLock.isOpen) {
      toast.error(timeLock.message);
      return;
    }

    const finalNip = lecturerNip.trim() || `DOSEN-${selectedLecturer.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15)}`;

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nim: finalNip,
          name: selectedLecturer,
          class_name: lecturerRole || 'Dosen',
          lecturer_name: selectedLecturer,
          status,
          notes: notes.trim() || null,
        }),
      });

      const result = await res.json();

      if (res.ok) {
        toast.success(`Presensi ${selectedLecturer} berhasil dicatat!`);

        // Broadcast instan 0-detik ke dashboard admin
        try {
          const supabase = createClient();
          const channel = supabase.channel('himasi-live-sync');
          channel.subscribe((subStatus) => {
            if (subStatus === 'SUBSCRIBED') {
              channel.send({
                type: 'broadcast',
                event: 'attendance_checkin',
                payload: {
                  name: selectedLecturer,
                  nim: finalNip,
                  class_name: lecturerRole || 'Dosen',
                  status,
                },
              });
            }
          });
        } catch (e) {}

        setSuccessReceipt({
          role: 'dosen',
          name: selectedLecturer,
          class_name: lecturerRole,
          lecturer_name: selectedLecturer,
          time: result.data?.check_in_time || new Date().toLocaleTimeString('id-ID'),
          date: formatDate(new Date()),
          status,
          activeDay: result.activeDay || currentDay,
        });
      } else {
        toast.error(result.error || 'Gagal mengirim presensi dosen.');
      }
    } catch (err: any) {
      toast.error('Terjadi kesalahan jaringan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // SUBMIT PILIHAN SUARA ONLINE (E-VOTING)
  const handleConfirmVote = async () => {
    if (!selectedCandidate || !student) return;

    setIsSubmittingVote(true);
    try {
      const res = await fetch('/api/voting/online', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nim: student.nim,
          name: student.name,
          class_name: student.class_name,
          voter_role: 'mahasiswa',
          choice_id: selectedCandidate.id,
          choice_number: selectedCandidate.number,
          choice_name: selectedCandidate.name,
          is_golput: Boolean(selectedCandidate.is_golput),
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        toast.success('Suara Anda berhasil dicatat secara sah dan rahasia! 🗳️');
        setConfirmVoteModal(false);
        setVoteReceipt({
          voted_at: new Date().toLocaleTimeString('id-ID') + ' WIB',
          candidate_name: selectedCandidate.name,
          candidate_number: selectedCandidate.number,
        });
        setStudent((prev) => prev ? { ...prev, has_voted_online: true } : null);
      } else {
        toast.error(data.error || 'Gagal menyimpan suara.');
      }
    } catch (err) {
      toast.error('Terjadi kesalahan jaringan saat mengirim suara.');
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleResetForm = () => {
    setSuccessReceipt(null);
    setShowVotingBooth(false);
    setSelectedCandidate(null);
    setVoteReceipt(null);
    setConfirmVoteModal(false);
    setNim('');
    setStudent(null);
    setSearchError(null);
    setAlreadyCheckedIn(null);
    setSubmitError(null);
    setSelectedLecturer('');
    setLecturerNip('');
    setNotes('');
    setStatus('Hadir');
  };

  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 sm:p-8 space-y-6">
      {/* NAVBAR ATAS (TAB KIRI: PESERTA, KANAN: DOSEN) */}
      {!successReceipt && !showVotingBooth && (
        <div className="grid grid-cols-2 p-1.5 bg-[#F1F5F9] rounded-2xl border border-black/5">
          {/* TAB KIRI: PESERTA */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('peserta');
              setStatus('Hadir');
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'peserta'
                ? 'bg-white text-[#2563EB] shadow-xs'
                : 'text-[#64748B] hover:text-[#111827]'
            }`}
          >
            <Users size={16} />
            <span>Presensi Peserta</span>
          </button>

          {/* TAB KANAN: DOSEN */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('dosen');
              setStatus('Hadir');
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'dosen'
                ? 'bg-[#2563EB] text-white shadow-xs'
                : 'text-[#64748B] hover:text-[#111827]'
            }`}
          >
            <UserCheck size={16} />
            <span>Presensi Dosen</span>
          </button>
        </div>
      )}

      {/* ========================================================
          TAMPILAN: BILIK SUARA DIGITAL (E-VOTING PEMIRA)
          ======================================================== */}
      {showVotingBooth ? (
        <div className="space-y-6 animate-in fade-in duration-300">
          {voteReceipt ? (
            /* TANDA TERIMA SUARA E-VOTING BERHASIL */
            <div className="text-center py-6 space-y-5 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 size={36} />
              </div>

              <div>
                <span className="inline-block px-3 py-1 bg-purple-50 text-purple-700 text-xs font-bold rounded-full border border-purple-200 mb-2">
                  E-Voting Pemira HIMASI 2026/2027 Selesai
                </span>
                <h3 className="text-xl sm:text-2xl font-bold text-[#111827]">
                  Terima Kasih, Suara Sah Anda Berhasil Masuk! 🗳️
                </h3>
                <p className="text-xs text-[#6B7280] max-w-md mx-auto mt-1">
                  Hak suara Anda telah tersimpan secara aman, terenkripsi, dan rahasia ke dalam sistem Pemira HIMASI.
                </p>
              </div>

              {/* Receipt Card */}
              <div className="bg-[#F8F9FA] rounded-xl border border-black/5 p-4 text-left max-w-md mx-auto space-y-2.5 text-xs sm:text-sm">
                <div className="flex justify-between border-b border-black/5 pb-2">
                  <span className="text-[#6B7280]">Nama Pemilih</span>
                  <span className="font-bold text-[#111827]">{student?.name}</span>
                </div>
                <div className="flex justify-between border-b border-black/5 pb-2">
                  <span className="text-[#6B7280]">NIM</span>
                  <span className="font-mono font-semibold text-[#111827]">{student?.nim}</span>
                </div>
                <div className="flex justify-between border-b border-black/5 pb-2">
                  <span className="text-[#6B7280]">Angkatan</span>
                  <span className="font-semibold text-[#111827]">{student?.class_name}</span>
                </div>
                <div className="flex justify-between border-b border-black/5 pb-2">
                  <span className="text-[#6B7280]">Jalur Pemilihan</span>
                  <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full font-bold text-xs">
                    🌐 Mahasiswa Online
                  </span>
                </div>
                <div className="flex justify-between border-b border-black/5 pb-2">
                  <span className="text-[#6B7280]">Waktu Pencoblosan</span>
                  <span className="font-medium text-[#111827]">{voteReceipt.voted_at}</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-[#6B7280]">Status Suara</span>
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold text-xs">
                    Suara Sah Terverifikasi ✅
                  </span>
                </div>
              </div>

              <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl text-purple-900 text-xs text-left max-w-md mx-auto flex items-start gap-2">
                <ShieldCheck size={16} className="text-purple-600 shrink-0 mt-0.5" />
                <p>
                  <b>Jaminan Kerahasiaan (Luber Jurdil):</b> Pilihan spesifik Anda dirahasiakan dan tidak akan ditampilkan pada Google Sheets maupun sidebar admin umum.
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetForm}
                className="w-full max-w-md mx-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold py-2.5 px-4 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check size={16} />
                <span>Selesai / Kembali ke Beranda</span>
              </button>
            </div>
          ) : (
            /* LEMBAR SURAT SUARA DIGITAL */
            <div className="space-y-5">
              <div className="border-b border-black/5 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-purple-600 font-bold text-xs uppercase tracking-wider">
                    <Vote size={15} />
                    <span>Bilik Suara Digital (E-Voting)</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                    Jalur Mahasiswa Online
                  </span>
                </div>
                <h2 className="text-xl font-bold text-[#111827]">
                  Surat Suara Pemilihan Ketua & Wakil HIMASI
                </h2>
                <p className="text-xs text-[#6B7280]">
                  Gunakan hak pilih Anda dengan bijak. Setiap mahasiswa online hanya dapat mencoblos <b>1 kali</b>.
                </p>
              </div>

              {/* Voter Identity Badge */}
              <div className="p-3 bg-[#F8F9FA] rounded-xl border border-black/5 flex items-center justify-between text-xs">
                <div>
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">Identitas Pemilih:</span>
                  <span className="font-bold text-[#111827]">{student?.name}</span>
                  <span className="text-gray-500 font-mono text-[11px] ml-1.5">({student?.nim})</span>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-lg text-[11px]">
                  Presensi Hadir ✅
                </span>
              </div>

              {/* DAFTAR PASANGAN CALON */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-[#374151] uppercase tracking-wider">
                  Pilih Salah Satu Pasangan Calon di Bawah Ini:
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {candidatesList.map((cand) => (
                    <div
                      key={cand.id}
                      onClick={() => setSelectedCandidate(cand)}
                      className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative flex flex-col justify-between ${
                        selectedCandidate?.id === cand.id
                          ? 'border-[#2563EB] bg-blue-50/40 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-2xs'
                      }`}
                    >
                      <div>
                        {/* Candidate Number Header */}
                        <div className="flex items-center justify-between mb-3">
                          <span className="w-10 h-10 rounded-xl bg-[#2563EB] text-white font-mono font-black text-base flex items-center justify-center shadow-xs">
                            {cand.number}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            selectedCandidate?.id === cand.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {selectedCandidate?.id === cand.id ? 'Dipilih' : 'Paslon Sah'}
                          </span>
                        </div>

                        {/* Foto Paslon */}
                        {cand.photo_url && (
                          <div className="w-full h-52 sm:h-56 rounded-xl overflow-hidden bg-slate-900/5 mb-3 border border-black/5 relative shadow-2xs flex items-center justify-center">
                            <img
                              src={cand.photo_url}
                              alt={cand.name}
                              className="w-full h-full object-contain hover:scale-105 transition-all duration-300"
                            />
                          </div>
                        )}

                        {/* Candidate Name & Tagline */}
                        <h4 className="font-bold text-sm text-[#111827] line-clamp-2">
                          {cand.name}
                        </h4>

                        {/* Calon Ketua & Wakil Ketua */}
                        {cand.ketua && cand.wakil_ketua && (
                          <div className="mt-2 text-[11px] bg-slate-50 p-2 rounded-xl border border-slate-200/80 space-y-0.5">
                            <div><span className="font-semibold text-gray-500">Ketua:</span> <span className="font-bold text-gray-800">{cand.ketua}</span></div>
                            <div><span className="font-semibold text-gray-500">Wakil:</span> <span className="font-bold text-gray-800">{cand.wakil_ketua}</span></div>
                          </div>
                        )}

                        {cand.tagline && (
                          <p className="text-xs text-[#6B7280] mt-1.5 italic">
                            &quot;{cand.tagline}&quot;
                          </p>
                        )}

                        {/* Tombol Lihat Visi & Misi */}
                        {(cand.visi || cand.misi) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewVisiMisi(cand);
                            }}
                            className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-bold hover:underline cursor-pointer"
                          >
                            <BookOpen size={13} />
                            <span>Lihat Visi & Misi Paslon</span>
                          </button>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#2563EB] flex items-center gap-1">
                          {selectedCandidate?.id === cand.id ? 'Siap Dicoblos' : 'Klik untuk Pilih'}
                          <ArrowRight size={13} />
                        </span>
                        <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          selectedCandidate?.id === cand.id
                            ? 'border-[#2563EB] bg-[#2563EB] text-white'
                            : 'border-gray-300 bg-white'
                        }`}>
                          {selectedCandidate?.id === cand.id && <Check size={13} />}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* OPSI GOLPUT / KOTAK KOSONG */}
                <div
                  onClick={() => setSelectedCandidate(golputCandidate)}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer mt-3 ${
                    selectedCandidate?.id === golputCandidate.id
                      ? 'border-gray-700 bg-gray-100 shadow-sm'
                      : 'border-dashed border-gray-300 bg-gray-50/70 hover:border-gray-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-xl bg-gray-300 text-gray-700 font-mono font-bold text-sm flex items-center justify-center">
                        00
                      </span>
                      <div>
                        <h4 className="font-bold text-xs text-[#111827]">
                          {golputCandidate.name}
                        </h4>
                        <p className="text-[11px] text-gray-500">
                          {golputCandidate.tagline}
                        </p>
                      </div>
                    </div>

                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                      selectedCandidate?.id === golputCandidate.id
                        ? 'border-gray-800 bg-gray-800 text-white'
                        : 'border-gray-300 bg-white'
                    }`}>
                      {selectedCandidate?.id === golputCandidate.id && <Check size={13} />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={!selectedCandidate || isSubmittingVote}
                  onClick={() => setConfirmVoteModal(true)}
                  className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all ${
                    !selectedCandidate
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700 text-white cursor-pointer active:scale-[0.99]'
                  }`}
                >
                  <Vote size={18} />
                  <span>
                    {selectedCandidate
                      ? `Lanjutkan Coblos ${selectedCandidate.number === '00' ? 'Kotak Kosong' : `Paslon ${selectedCandidate.number}`}`
                      : 'Silakan Pilih Pasangan Calon Terlebih Dahulu'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : successReceipt ? (
        /* ========================================================
           TAMPILAN: TANDA TERIMA PRESENSI BIASA (OFFLINE / SELESAI)
           ======================================================== */
        <div className="text-center py-4 space-y-5 animate-in fade-in duration-300">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 size={36} />
          </div>

          <div>
            <span className="inline-block px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-200 mb-2">
              Presensi {successReceipt.role === 'dosen' ? 'Dosen' : 'Peserta'} Berhasil Disimpan
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-[#111827]">
              Terima Kasih, Kehadiran Tercatat!
            </h3>
            <p className="text-sm text-[#6B7280]">
              Data kehadiran telah tersimpan ke sistem database dan Google Sheets.
            </p>
          </div>

          {/* Receipt Card */}
          <div className="bg-[#F8F9FA] rounded-xl border border-black/5 p-4 text-left max-w-md mx-auto space-y-2.5 text-xs sm:text-sm">
            <div className="flex justify-between border-b border-black/5 pb-2">
              <span className="text-[#6B7280]">
                {successReceipt.role === 'dosen' ? 'Nama Dosen' : 'Nama Peserta'}
              </span>
              <span className="font-bold text-[#111827]">{successReceipt.name}</span>
            </div>

            {successReceipt.nim && successReceipt.role === 'peserta' && (
              <div className="flex justify-between border-b border-black/5 pb-2">
                <span className="text-[#6B7280]">NIM</span>
                <span className="font-semibold text-[#111827]">{successReceipt.nim}</span>
              </div>
            )}

            <div className="flex justify-between border-b border-black/5 pb-2">
              <span className="text-[#6B7280]">
                {successReceipt.role === 'dosen' ? 'Peran / Jabatan' : 'Angkatan'}
              </span>
              <span className="font-semibold text-[#111827]">{successReceipt.class_name}</span>
            </div>

            {successReceipt.role === 'peserta' && (
              <div className="flex justify-between border-b border-black/5 pb-2">
                <span className="text-[#6B7280]">Tipe Kehadiran</span>
                <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${
                  successReceipt.attendance_type === 'online'
                    ? 'bg-purple-100 text-purple-800'
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {successReceipt.attendance_type === 'online' ? '🌐 Mahasiswa Online' : '🏛️ Mahasiswa Offline'}
                </span>
              </div>
            )}

            <div className="flex justify-between border-b border-black/5 pb-2">
              <span className="text-[#6B7280]">Tanggal & Waktu</span>
              <span className="font-medium text-[#111827]">
                {successReceipt.date} • {successReceipt.time} WIB
              </span>
            </div>

            <div className="flex justify-between border-b border-black/5 pb-2">
              <span className="text-[#6B7280]">Sesi Presensi</span>
              <span className={`font-bold ${successReceipt.activeDay && successReceipt.activeDay > 1 ? 'text-emerald-600' : 'text-[#2563EB]'}`}>
                Hari ke-{successReceipt.activeDay || currentDay}
              </span>
            </div>

            <div className="flex justify-between items-center pt-1">
              <span className="text-[#6B7280]">Status Kehadiran</span>
              <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold text-xs">
                {successReceipt.status}
              </span>
            </div>
          </div>

          {/* Info Khusus Pemilih Offline */}
          {successReceipt.role === 'peserta' && successReceipt.attendance_type !== 'online' && (
            <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl text-blue-900 text-xs text-left max-w-md mx-auto flex items-start gap-2">
              <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <p>
                <b>Pemilih Offline:</b> Silakan menuju ke <b>Bilik Suara Fisik</b> panitia untuk mengambil surat suara dan mencoblos langsung di TPS.
              </p>
            </div>
          )}

          {/* Akses Cepat Bilik Suara untuk Mahasiswa Online */}
          {successReceipt.role === 'peserta' && successReceipt.attendance_type === 'online' && !successReceipt.has_voted_online && (
            <div className="p-4 bg-purple-50 border-2 border-purple-300 rounded-2xl text-left max-w-md mx-auto space-y-3 shadow-md animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0">
                  <Vote size={18} />
                </span>
                <div>
                  <h4 className="font-bold text-sm text-purple-950">
                    Bilik Suara Digital (E-Voting) Siap!
                  </h4>
                  <p className="text-[11px] text-purple-700">
                    Anda terdaftar sebagai Mahasiswa Online. Silakan salurkan hak suara Anda secara rahasia dan sah.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (successReceipt.nim) {
                    loadVotingBooth(successReceipt.nim);
                  }
                }}
                disabled={loadingBooth}
                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.99]"
              >
                {loadingBooth ? <Loader2 size={16} className="animate-spin" /> : <Vote size={16} />}
                <span>Masuk ke Bilik Suara Digital (E-Voting) Sekarang →</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleResetForm}
            className="w-full max-w-md mx-auto bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold py-2.5 px-4 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check size={16} />
            <span>Selesai / Presensi Lainnya</span>
          </button>
        </div>
      ) : activeTab === 'peserta' ? (
        /* ========================================================
           TAB KIRI: FORMULIR PRESENSI PESERTA / MAHASISWA
           ======================================================== */
        <form onSubmit={handleSubmitPeserta} className="space-y-5">
          <div className="border-b border-black/5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-[#2563EB] font-semibold text-xs uppercase tracking-wider">
                <CalendarDays size={14} />
                <span>{formatDate(new Date())}</span>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                currentDay > 1
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-blue-100 text-blue-800 border border-blue-300'
              }`}>
                Hari ke-{currentDay}
              </span>
            </div>
            <h2 className="text-xl font-bold text-[#111827]">
              Formulir Presensi Mahasiswa
            </h2>
            <p className="text-xs text-[#6B7280]">
              Masukkan NIM Anda, sistem akan mendeteksi status dan data angkatan secara otomatis.
            </p>
          </div>

          {/* TIME LOCK BANNER IF CLOSED */}
          {timeLock?.enabled && !timeLock.isOpen && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold block mb-0.5">Presensi Ditutup:</span>
                {timeLock.message}
              </div>
            </div>
          )}

          {/* INPUT NIM */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5 flex items-center justify-between">
              <span>Nomor Induk Mahasiswa (NIM) <span className="text-rose-500">*</span></span>
              {isSearching && (
                <span className="text-[10px] text-[#2563EB] flex items-center gap-1 font-bold">
                  <Loader2 size={10} className="animate-spin" /> Memeriksa NIM...
                </span>
              )}
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <Search size={16} />
              </div>
              <input
                type="text"
                value={nim}
                onChange={(e) => setNim(e.target.value)}
                placeholder="Contoh: 25120039"
                required
                autoComplete="off"
                className={`w-full bg-[#F8F9FA] focus:bg-white border rounded-xl pl-10 pr-3.5 py-2.5 text-sm font-semibold outline-hidden transition-all ${
                  searchError
                    ? 'border-rose-400 focus:border-rose-500 text-rose-900'
                    : student
                    ? 'border-emerald-400 focus:border-emerald-500 text-[#111827]'
                    : 'border-gray-200 focus:border-[#2563EB] text-[#111827]'
                }`}
              />
            </div>

            {searchError && (
              <p className="mt-1.5 text-xs text-rose-600 flex items-center gap-1 font-medium">
                <AlertCircle size={13} /> {searchError}
              </p>
            )}

            {/* BADGE DETEKSI ONLINE VS OFFLINE */}
            {student && (
              <div className={`mt-2 p-2.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in duration-200 ${
                String(student.attendance_type || '').toLowerCase() === 'online'
                  ? 'bg-purple-50/80 border-purple-200 text-purple-900'
                  : 'bg-blue-50/80 border-blue-200 text-blue-900'
              }`}>
                <div className="flex items-center gap-2">
                  {String(student.attendance_type || '').toLowerCase() === 'online' ? (
                    <Globe size={16} className="text-purple-600 shrink-0" />
                  ) : (
                    <Building size={16} className="text-blue-600 shrink-0" />
                  )}
                  <div>
                    <span className="font-bold block">
                      {String(student.attendance_type || '').toLowerCase() === 'online'
                        ? 'Mahasiswa Online (E-Voting Digital)'
                        : 'Mahasiswa Offline (Presensi Tatap Muka)'}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {String(student.attendance_type || '').toLowerCase() === 'online'
                        ? (student.has_voted_online
                            ? '✅ Anda telah menggunakan hak suara E-Voting.'
                            : 'Setelah presensi, Anda akan langsung diarahkan ke Bilik Suara E-Voting.')
                        : 'Mencoblos langsung menggunakan surat suara fisik di TPS.'}
                    </span>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                  String(student.attendance_type || '').toLowerCase() === 'online'
                    ? 'bg-purple-200 text-purple-800'
                    : 'bg-blue-200 text-blue-800'
                }`}>
                  {String(student.attendance_type || '').toLowerCase() === 'online' ? 'Online' : 'Offline'}
                </span>
              </div>
            )}

            {alreadyCheckedIn && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2.5 rounded-xl space-y-2">
                <div className="flex items-start gap-1.5">
                  <Clock size={15} className="shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="font-bold">Sudah Presensi Hari Ini:</span> Anda telah tercatat hadir pada pk <b>{alreadyCheckedIn.time} WIB</b> ({alreadyCheckedIn.status}).
                  </div>
                </div>

                {/* Tombol Masuk Bilik Suara jika mahasiswa online dan belum mencoblos */}
                {Boolean(student) && String(student?.attendance_type || '').toLowerCase() === 'online' && !student?.has_voted_online && (
                  <button
                    type="button"
                    onClick={() => {
                      if (student?.nim) {
                        loadVotingBooth(student.nim);
                      }
                    }}
                    disabled={loadingBooth}
                    className="w-full py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                  >
                    {loadingBooth ? <Loader2 size={14} className="animate-spin" /> : <Vote size={14} />}
                    <span>Masuk ke Bilik Suara Digital Sekarang</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* AUTO-FILLED STUDENT NAME */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5 flex items-center justify-between">
              <span>Nama Lengkap Mahasiswa</span>
              <span className="text-[10px] font-normal text-gray-400">Otomatis dari Sistem</span>
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <User size={16} />
              </div>
              <input
                type="text"
                value={student ? student.name : ''}
                readOnly
                placeholder={isSearching ? 'Mencari data mahasiswa...' : 'Terisi otomatis setelah NIM dimasukkan'}
                className="w-full bg-gray-100/80 border border-gray-200 text-[#111827] font-semibold rounded-xl pl-10 pr-3.5 py-2.5 text-sm cursor-not-allowed select-none placeholder:font-normal placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* AUTO-FILLED CLASS */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5 flex items-center justify-between">
              <span>Angkatan</span>
              <span className="text-[10px] font-normal text-gray-400">Otomatis dari Sistem</span>
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <GraduationCap size={16} />
              </div>
              <input
                type="text"
                value={student ? student.class_name : ''}
                readOnly
                placeholder="Terisi otomatis sesuai angkatan"
                className="w-full bg-gray-100/80 border border-gray-200 text-[#111827] font-semibold rounded-xl pl-10 pr-3.5 py-2.5 text-sm cursor-not-allowed select-none placeholder:font-normal placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* STATUS KEHADIRAN */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              Status Presensi
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Hadir', 'Izin', 'Sakit'] as const).map((opt) => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => setStatus(opt)}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all text-center cursor-pointer ${
                    status === opt
                      ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-xs'
                      : 'bg-[#F8F9FA] hover:bg-gray-100 text-[#4B5563] border-gray-200'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* KETERANGAN JIKA IZIN/SAKIT */}
          {status !== 'Hadir' && (
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-1.5">
                Alasan / Catatan {status} <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={`Tuliskan alasan ${status.toLowerCase()} Anda...`}
                rows={2}
                required
                className="w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl px-3.5 py-2 text-xs text-[#111827] outline-hidden transition-all"
              />
            </div>
          )}

          {/* SUBMIT ERROR / ANTI-TITIP ABSEN ALERT */}
          {submitError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold block mb-0.5">Pemberitahuan Presensi:</span>
                {submitError}
              </div>
            </div>
          )}

          {/* SUBMIT BUTTON */}
          {alreadyCheckedIn && String(student?.attendance_type || '').toLowerCase() === 'online' && !student?.has_voted_online ? (
            <button
              type="button"
              onClick={() => {
                if (student?.nim) {
                  loadVotingBooth(student.nim);
                }
              }}
              disabled={loadingBooth}
              className="w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white shadow-md transition-all cursor-pointer active:scale-[0.99]"
            >
              {loadingBooth ? <Loader2 size={18} className="animate-spin" /> : <Vote size={18} />}
              <span>Anda Sudah Presensi • Masuk ke Bilik Suara Digital (E-Voting) →</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!student || isSubmitting || !!alreadyCheckedIn || (timeLock?.enabled && !timeLock.isOpen)}
              className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all ${
                !student || alreadyCheckedIn || (timeLock?.enabled && !timeLock.isOpen)
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : student?.attendance_type === 'online'
                  ? 'bg-purple-600 hover:bg-purple-700 text-white active:scale-[0.99] cursor-pointer'
                  : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white active:scale-[0.99] cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Mencatat Presensi...</span>
                </>
              ) : timeLock?.enabled && !timeLock.isOpen ? (
                <>
                  <Clock size={18} />
                  <span>Presensi Sedang Ditutup</span>
                </>
              ) : alreadyCheckedIn ? (
                <>
                  <Check size={18} />
                  <span>Presensi Hari Ini Selesai</span>
                </>
              ) : student?.attendance_type === 'online' ? (
                <>
                  <Vote size={18} />
                  <span>Presensi & Buka Bilik Suara Digital</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>Kirim Presensi Sekarang</span>
                </>
              )}
            </button>
          )}
        </form>
      ) : (
        /* ========================================================
           TAB KANAN: FORMULIR PRESENSI DOSEN / PEMBINA
           ======================================================== */
        <form onSubmit={handleSubmitDosen} className="space-y-5">
          <div className="border-b border-black/5 pb-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-[#2563EB] font-semibold text-xs uppercase tracking-wider">
                <CalendarDays size={14} />
                <span>{formatDate(new Date())}</span>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                currentDay > 1
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-blue-100 text-blue-800 border border-blue-300'
              }`}>
                Hari ke-{currentDay}
              </span>
            </div>
            <h2 className="text-xl font-bold text-[#111827]">
              Formulir Presensi Dosen
            </h2>
            <p className="text-xs text-[#6B7280]">
              Pilih nama Anda pada dropdown di bawah ini untuk mencatat kehadiran resmi.
            </p>
          </div>

          {/* TIME LOCK BANNER IF CLOSED */}
          {timeLock?.enabled && !timeLock.isOpen && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold block mb-0.5">Sesi Presensi Belum / Sudah Ditutup:</span>
                {timeLock.message}
              </div>
            </div>
          )}

          {/* DROPDOWN NAMA DOSEN */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5 flex items-center justify-between">
              <span>Pilih Nama Dosen <span className="text-rose-500">*</span></span>
              <span className="text-[10px] font-bold text-[#2563EB]">Daftar dari Admin</span>
            </label>

            {lecturers.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                Belum ada nama dosen di sistem. Admin dapat menambahkannya di panel <b>Kustomisasi Tampilan</b>.
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#2563EB]">
                  <UserCheck size={18} />
                </div>
                <select
                  value={selectedLecturer}
                  onChange={(e) => setSelectedLecturer(e.target.value)}
                  required
                  className={`w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl pl-10 pr-10 py-3 text-sm outline-hidden transition-all appearance-none cursor-pointer ${
                    !selectedLecturer ? 'text-gray-400 font-normal' : 'text-[#111827] font-bold'
                  }`}
                >
                  <option value="" disabled className="text-gray-400 font-normal">
                    -- Klik untuk pilih nama dosen --
                  </option>
                  {lecturers.map((doc, idx) => (
                    <option key={idx} value={doc} className="text-[#111827] font-semibold py-1">
                      {doc}
                    </option>
                  ))}
                </select>
                <ChevronDown size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {/* PERAN / JABATAN DOSEN */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              Peran / Jabatan
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <BookOpen size={16} />
              </div>
              <input
                type="text"
                value={lecturerRole}
                onChange={(e) => setLecturerRole(e.target.value)}
                placeholder="Contoh: Dosen / Pembina HIMASI / Saksi Pemira"
                className="w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-[#111827] outline-hidden transition-all"
              />
            </div>
          </div>

          {/* NIP / NIDN (OPSIONAL) */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              NIP / NIDN (Opsional)
            </label>
            <input
              type="text"
              value={lecturerNip}
              onChange={(e) => setLecturerNip(e.target.value)}
              placeholder="Contoh: 198501012010121001"
              className="w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#111827] outline-hidden transition-all"
            />
          </div>

          {/* STATUS KEHADIRAN DOSEN */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              Status Presensi Dosen
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Hadir', 'Izin', 'Sakit'] as const).map((opt) => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => setStatus(opt)}
                  className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all text-center cursor-pointer ${
                    status === opt
                      ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-xs'
                      : 'bg-[#F8F9FA] hover:bg-gray-100 text-[#4B5563] border-gray-200'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* KETERANGAN JIKA ADA */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              Catatan / Agenda Sesi (Opsional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan perkuliahan / kehadiran..."
              rows={2}
              className="w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl px-3.5 py-2 text-xs text-[#111827] outline-hidden transition-all"
            />
          </div>

          {/* SUBMIT BUTTON DOSEN */}
          <button
            type="submit"
            disabled={!selectedLecturer || isSubmitting || (timeLock?.enabled && !timeLock.isOpen)}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all ${
              !selectedLecturer || (timeLock?.enabled && !timeLock.isOpen)
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white active:scale-[0.99] cursor-pointer'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Mencatat Presensi Dosen...</span>
              </>
            ) : timeLock?.enabled && !timeLock.isOpen ? (
              <>
                <Clock size={18} />
                <span>Presensi Sedang Ditutup</span>
              </>
            ) : (
              <>
                <Send size={16} />
                <span>Kirim Presensi Dosen Sekarang</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* ========================================================
          MODAL LIHAT VISI & MISI PASLON
          ======================================================== */}
      {viewVisiMisi && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between border-b border-black/5 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="w-10 h-10 rounded-xl bg-[#2563EB] text-white font-mono font-black text-base flex items-center justify-center shadow-xs">
                  {viewVisiMisi.number}
                </span>
                <div>
                  <h3 className="font-bold text-base text-[#111827]">
                    Visi & Misi Paslon {viewVisiMisi.number}
                  </h3>
                  <p className="text-xs text-gray-500 font-medium line-clamp-1">
                    {viewVisiMisi.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewVisiMisi(null)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {viewVisiMisi.photo_url && (
              <div className="w-full max-h-80 sm:max-h-96 rounded-2xl overflow-hidden bg-slate-900/5 border border-black/5 flex items-center justify-center p-1 shadow-inner">
                <img
                  src={viewVisiMisi.photo_url}
                  alt={viewVisiMisi.name}
                  className="w-auto h-auto max-h-80 sm:max-h-96 max-w-full object-contain mx-auto rounded-xl"
                />
              </div>
            )}

            {viewVisiMisi.ketua && viewVisiMisi.wakil_ketua && (
              <div className="grid grid-cols-2 gap-2 text-xs bg-blue-50/60 border border-blue-200/80 p-3 rounded-xl">
                <div>
                  <span className="text-gray-500 block text-[10px] uppercase font-bold">Calon Ketua</span>
                  <span className="font-bold text-blue-900">{viewVisiMisi.ketua}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-[10px] uppercase font-bold">Calon Wakil Ketua</span>
                  <span className="font-bold text-blue-900">{viewVisiMisi.wakil_ketua}</span>
                </div>
              </div>
            )}

            {/* VISI */}
            {viewVisiMisi.visi && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                  <Sparkles size={14} />
                  <span>Visi</span>
                </h4>
                <p className="text-xs text-gray-700 leading-relaxed bg-gray-50 p-3 rounded-xl border border-gray-200">
                  {viewVisiMisi.visi}
                </p>
              </div>
            )}

            {/* MISI */}
            {viewVisiMisi.misi && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                  <CheckCheck size={14} />
                  <span>Misi</span>
                </h4>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs text-gray-700 space-y-2">
                  {Array.isArray(viewVisiMisi.misi) ? (
                    viewVisiMisi.misi.map((m: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{m}</span>
                      </div>
                    ))
                  ) : (
                    <p className="leading-relaxed">{viewVisiMisi.misi}</p>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setSelectedCandidate(viewVisiMisi);
                setViewVisiMisi(null);
              }}
              className="w-full py-2.5 px-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check size={15} />
              <span>Pilih Paslon Ini untuk Dicoblos</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL KONFIRMASI PILIHAN SUARA E-VOTING
          ======================================================== */}
      {confirmVoteModal && selectedCandidate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
              <Vote size={26} />
            </div>

            <div className="text-center">
              <h3 className="font-bold text-base text-[#111827]">
                Konfirmasi Pilihan Suara
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Apakah Anda yakin ingin memberikan suara kepada:
              </p>
            </div>

            {/* Pilihan Preview */}
            <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-center space-y-1">
              <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wider block">
                {selectedCandidate.is_golput ? 'Opsi Golput' : `Pasangan Calon Nomor ${selectedCandidate.number}`}
              </span>
              <p className="font-extrabold text-sm text-[#111827]">
                {selectedCandidate.name}
              </p>
            </div>

            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
              ⚠️ Pilihan Anda bersifat <b>RAHASIA</b> dan <b>TIDAK DAPAT DIUBAH</b> setelah dikirim.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmVoteModal(false)}
                disabled={isSubmittingVote}
                className="flex-1 py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs cursor-pointer transition-all"
              >
                Ganti Pilihan
              </button>
              <button
                type="button"
                onClick={handleConfirmVote}
                disabled={isSubmittingVote}
                className="flex-1 py-2.5 px-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition-all"
              >
                {isSubmittingVote ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Mengirim...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>Ya, Coblos Sekarang</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

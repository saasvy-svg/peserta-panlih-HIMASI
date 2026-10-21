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
  BookOpen
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { createClient } from '@/utils/supabase/client';

interface AttendanceFormProps {
  lecturers?: string[];
}

export default function AttendanceForm({ lecturers = [] }: AttendanceFormProps) {
  // Tab Navigation: 'peserta' (Kiri) atau 'dosen' (Kanan)
  const [activeTab, setActiveTab] = useState<'peserta' | 'dosen'>('peserta');

  // ===============================
  // STATE MAHASISWA / PESERTA
  // ===============================
  const [nim, setNim] = useState('');
  const [student, setStudent] = useState<{ id: string; nim: string; name: string; class_name: string } | null>(null);
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
  } | null>(null);

  // Fetch active day on initial mount
  useEffect(() => {
    fetch('/api/students/lookup')
      .then((r) => r.json())
      .then((d) => {
        if (d.activeDay) setCurrentDay(d.activeDay);
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
                },
              });
            }
          });
        } catch (e) {}
        setSuccessReceipt({
          role: 'peserta',
          nim: student.nim || nim.trim(),
          name: student.name,
          class_name: student.class_name,
          time: result.data?.check_in_time || new Date().toLocaleTimeString('id-ID'),
          date: formatDate(new Date()),
          status,
          activeDay: result.activeDay || currentDay,
        });
        setAlreadyCheckedIn({
          time: result.data?.check_in_time || new Date().toLocaleTimeString('id-ID'),
          status,
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

  const handleResetForm = () => {
    setSuccessReceipt(null);
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
      {!successReceipt && (
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

      {/* SUCCESS CONFIRMATION RECEIPT */}
      {successReceipt ? (
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
              Cukup masukkan NIM Anda, angkatan akan otomatis disinkronkan.
            </p>
          </div>

          {/* NIM INPUT */}
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              Nomor Induk Mahasiswa (NIM) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={nim}
                onChange={(e) => setNim(e.target.value)}
                placeholder="Contoh: 21102045"
                className="w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl px-3.5 py-2.5 text-sm font-semibold tracking-wider text-[#111827] outline-hidden transition-all pr-10"
                required
                autoFocus
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {isSearching ? (
                  <Loader2 size={18} className="animate-spin text-[#2563EB]" />
                ) : student ? (
                  <CheckCircle2 size={18} className="text-emerald-500" />
                ) : (
                  <Search size={18} />
                )}
              </div>
            </div>

            {/* SEARCH FEEDBACK */}
            {searchError && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">
                <AlertCircle size={14} className="shrink-0" />
                <span>{searchError}</span>
              </div>
            )}

            {student && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                <span>NIM terverifikasi dengan data master perkuliahan.</span>
              </div>
            )}

            {alreadyCheckedIn && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                <Clock size={15} className="shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <span className="font-bold">Sudah Presensi Hari Ini:</span> Anda telah tercatat hadir pada pk <b>{alreadyCheckedIn.time} WIB</b> ({alreadyCheckedIn.status}). Tidak perlu absen ulang.
                </div>
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
          <button
            type="submit"
            disabled={!student || isSubmitting || !!alreadyCheckedIn}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all ${
              !student || alreadyCheckedIn
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white active:scale-[0.99] cursor-pointer'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Mencatat Presensi...</span>
              </>
            ) : alreadyCheckedIn ? (
              <>
                <Check size={18} />
                <span>Presensi Hari Ini Selesai</span>
              </>
            ) : (
              <>
                <Send size={16} />
                <span>Kirim Presensi Sekarang</span>
              </>
            )}
          </button>
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
            disabled={!selectedLecturer || isSubmitting}
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all ${
              !selectedLecturer
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white active:scale-[0.99] cursor-pointer'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Mencatat Presensi Dosen...</span>
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
    </div>
  );
}

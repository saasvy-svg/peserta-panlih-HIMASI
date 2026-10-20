'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ShieldCheck, Lock, Mail, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message || 'Email atau password salah');
      } else {
        toast.success('Login Berhasil! Mengalihkan ke Dashboard Admin...');
        window.location.href = 'https://absensi-panlih-himasi.vercel.app/admin';
      }
    } catch (err: any) {
      toast.error('Gagal terhubung ke layanan otentikasi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col justify-center items-center px-4 py-12">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-2 text-xs font-semibold text-[#4B5563] hover:text-[#2563EB] bg-white border border-black/5 px-3 py-1.5 rounded-xl shadow-2xs transition-all"
      >
        <ArrowLeft size={14} />
        <span>Kembali ke Halaman Presensi</span>
      </Link>

      <div className="w-full max-w-md bg-white rounded-2xl border border-black/5 shadow-sm p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-50 text-[#2563EB] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <ShieldCheck size={28} />
          </div>
          <h2 className="text-2xl font-bold text-[#111827]">
            Admin Portal HIMASI
          </h2>
          <p className="text-xs text-[#6B7280] mt-1">
            Masuk untuk mengakses dashboard administrator
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              Email Administrator
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <Mail size={16} />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Masukkan email admin..."
                required
                className="w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#111827] outline-hidden transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1.5">
              Kata Sandi
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <Lock size={16} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-[#F8F9FA] focus:bg-white border border-gray-200 focus:border-[#2563EB] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#111827] outline-hidden transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold py-2.5 px-4 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Memproses...</span>
              </>
            ) : (
              <span>Masuk ke Dashboard Admin</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

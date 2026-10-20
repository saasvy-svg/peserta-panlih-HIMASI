import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Sistem Absensi Mahasiswa & Monitoring',
  description: 'Portal presensi mahasiswa dan dashboard monitoring admin terintegrasi',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-[#F8F9FA] text-[#111827]">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}

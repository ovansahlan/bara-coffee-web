import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bara Coffee — Portal Kru, Kasir Outlet & Dashboard Owner',
  description:
    'Aplikasi input omset, kas kecil kumulatif, check balance shift, absensi selfie, kasbon, payroll, dan dashboard pemantauan owner multi-outlet untuk Bara Coffee.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Bara Coffee',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F5F8FC',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased min-h-screen overflow-x-hidden bg-[var(--background)] text-[var(--foreground)]">
        {children}
      </body>
    </html>
  );
}

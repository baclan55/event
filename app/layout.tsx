import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import '@/app/globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { HashRedirect } from '@/components/HashRedirect';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' });
const mono = IBM_Plex_Mono({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '700'], variable: '--font-mono' });
export const metadata: Metadata = { title: 'Events Denver', description: 'Портал ивент-отдела' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className={`${inter.variable} ${mono.variable}`}><body><AuthProvider><HashRedirect />{children}</AuthProvider></body></html>;
}

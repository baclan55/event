import type { Metadata } from 'next';
import '@/app/globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { HashRedirect } from '@/components/HashRedirect';

export const metadata: Metadata = {
  title: 'Events Denver',
  description: 'Портал ивент-отдела',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Inter:wght@400;600;700;800&display=swap"
        />
      </head>
      <body>
        <AuthProvider>
          <HashRedirect />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

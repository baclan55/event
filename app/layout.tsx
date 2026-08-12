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
      <body>
        <AuthProvider>
          <HashRedirect />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

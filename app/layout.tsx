import type { Metadata } from 'next';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'Events Denver',
  description: 'Портал ивент-отдела',
};

/** Кабинет и сайт — без AuthProvider: иначе QUIC/HTTP3 валит JS и React сносит SSR. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var h=location.hash.replace(/^#\\/?/,"");var m={home:"/",apply:"/apply",dashboard:"/app/dashboard",profile:"/app/profile",faq:"/app/faq",roster:"/app/roster",rules:"/app/rules",regulations:"/app/regulations",firstSteps:"/app/first-steps",vacations:"/app/vacations",reprimands:"/app/reprimands",applications:"/app/applications",candidates:"/app/candidates",owner:"/app/owner",blocked:"/app/blocked",pending:"/app/pending"};if(m[h])location.replace(m[h]);})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}

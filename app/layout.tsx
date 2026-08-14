import type { Metadata, Viewport } from 'next';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'Events Denver',
  description: 'Портал ивент-отдела',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** Кабинет и сайт — без AuthProvider: иначе QUIC/HTTP3 валит JS и React сносит SSR. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <head>
        <link rel="stylesheet" href="/css/site-1.css?v=56" />
        <link rel="stylesheet" href="/css/site-2.css?v=56" />
        <link rel="stylesheet" href="/css/site-3.css?v=56" />
        <link rel="stylesheet" href="/css/site-4.css?v=56" />
        <link rel="stylesheet" href="/css/site-5.css?v=56" />
        <link rel="stylesheet" href="/css/site-6.css?v=56" />
        <link rel="stylesheet" href="/css/site-7.css?v=56" />
        <link rel="stylesheet" href="/css/site-8.css?v=56" />
        <link rel="stylesheet" href="/css/site-extra.css?v=58" />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var h=location.hash.replace(/^#\\/?/,"");var m={home:"/",apply:"/apply",dashboard:"/app/dashboard",profile:"/app/profile",faq:"/app/faq",roster:"/app/roster",rules:"/app/rules",regulations:"/app/regulations",firstSteps:"/app/first-steps",vacations:"/app/vacations",events:"/app/events",reprimands:"/app/reprimands",applications:"/app/applications","application-history":"/app/application-history",candidates:"/app/candidates",roles:"/app/roles",owner:"/app/roles",blacklist:"/app/blacklist",achievements:"/app/achievements",gmp:"/app/gmp",payouts:"/app/payouts","profile-moderation":"/app/profile-moderation",statistics:"/app/statistics",blocked:"/app/blocked",pending:"/app/pending"};if(m[h])location.replace(m[h]);})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}

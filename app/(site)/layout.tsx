import { headers } from 'next/headers';
import { SiteHeader } from '@/components/SiteHeader';

export const dynamic = 'force-dynamic';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') || '/';
  return (
    <div className="site">
      <div className="bg-decor" />
      <SiteHeader pathname={pathname} />
      <main className="site-main">{children}</main>
      <footer className="site-footer">Events Denver · Department Portal</footer>
    </div>
  );
}

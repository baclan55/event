import { SiteHeader } from '@/components/SiteHeader';

// Публичные страницы — без динамических серверных данных (сессия только на клиенте).
export const dynamic = 'force-static';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <div className="site"><div className="bg-decor" /><SiteHeader /><main className="site-main">{children}</main><footer className="site-footer">Events Denver · Department Portal</footer></div>;
}

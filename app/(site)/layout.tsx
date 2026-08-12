import { SiteHeader } from '@/components/SiteHeader';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <div className="site"><div className="bg-decor" /><SiteHeader /><main className="site-main">{children}</main><footer className="site-footer">Events Denver · Department Portal</footer></div>;
}

import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function FaqPage() {
  await requirePortalUser();
  const blocks = await loadContent('faq');
  return <ContentView title="FAQ" blocks={blocks} />;
}

import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function RegulationsPage() {
  await requirePortalUser();
  const blocks = await loadContent('regulations');
  return <ContentView title="Регламент" blocks={blocks} />;
}

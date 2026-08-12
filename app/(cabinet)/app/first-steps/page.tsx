import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function FirstStepsPage() {
  await requirePortalUser();
  const blocks = await loadContent('first_steps');
  return <ContentView title="Первые шаги" blocks={blocks} />;
}

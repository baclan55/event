import { loadApplicationHistory, requirePortalUser } from '@/lib/cabinetData';
import { ApplicationsInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function ApplicationHistoryPage() {
  await requirePortalUser();
  const rows = await loadApplicationHistory();
  return <ApplicationsInteractive initialRows={rows} history />;
}

import { loadApplications, requirePortalUser } from '@/lib/cabinetData';
import { ApplicationsView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  await requirePortalUser();
  const rows = await loadApplications();
  return <ApplicationsView rows={rows} />;
}

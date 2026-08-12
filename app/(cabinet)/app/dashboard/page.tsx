import { loadDashboard, requirePortalUser } from '@/lib/cabinetData';
import { DashboardView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requirePortalUser();
  const data = await loadDashboard();
  return <DashboardView members={data.members} target={data.target} />;
}

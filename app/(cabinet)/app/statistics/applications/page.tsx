import { StatisticsInteractive } from '@/components/cabinet/interactive/statistics';
import { requireStatsPage } from '@/lib/statisticsAccess';

export const dynamic = 'force-dynamic';

export default async function StatisticsApplicationsPage() {
  const { allowed } = await requireStatsPage('applications');
  return <StatisticsInteractive section="applications" allowed={allowed} />;
}

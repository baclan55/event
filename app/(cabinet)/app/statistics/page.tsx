import { StatisticsInteractive } from '@/components/cabinet/interactive/statistics';
import { requireStatsPage } from '@/lib/statisticsAccess';

export const dynamic = 'force-dynamic';

export default async function StatisticsPage() {
  const { allowed } = await requireStatsPage('overview');
  return <StatisticsInteractive section="overview" allowed={allowed} />;
}

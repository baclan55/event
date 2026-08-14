import { StatisticsInteractive } from '@/components/cabinet/interactive/statistics';
import { requireStatsPage } from '@/lib/statisticsAccess';

export const dynamic = 'force-dynamic';

export default async function StatisticsReprimandsPage() {
  const { allowed } = await requireStatsPage('reprimands');
  return <StatisticsInteractive section="reprimands" allowed={allowed} />;
}

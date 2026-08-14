import { StatisticsInteractive } from '@/components/cabinet/interactive/statistics';
import { requireStatsPage } from '@/lib/statisticsAccess';

export const dynamic = 'force-dynamic';

export default async function StatisticsGmpPage() {
  const { allowed } = await requireStatsPage('gmp');
  return <StatisticsInteractive section="gmp" allowed={allowed} />;
}

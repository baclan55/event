import { StatisticsInteractive } from '@/components/cabinet/interactive/statistics';
import { requireStatsPage } from '@/lib/statisticsAccess';

export const dynamic = 'force-dynamic';

export default async function StatisticsEventsPage() {
  const { allowed } = await requireStatsPage('events');
  return <StatisticsInteractive section="events" allowed={allowed} />;
}

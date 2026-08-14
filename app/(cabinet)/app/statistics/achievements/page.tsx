import { StatisticsInteractive } from '@/components/cabinet/interactive/statistics';
import { requireStatsPage } from '@/lib/statisticsAccess';

export const dynamic = 'force-dynamic';

export default async function StatisticsAchievementsPage() {
  const { allowed } = await requireStatsPage('achievements');
  return <StatisticsInteractive section="achievements" allowed={allowed} />;
}

import { StatisticsInteractive } from '@/components/cabinet/interactive/statistics';
import { requireStatsPage } from '@/lib/statisticsAccess';

export const dynamic = 'force-dynamic';

export default async function StatisticsUsersPage() {
  const { allowed } = await requireStatsPage('users');
  return <StatisticsInteractive section="users" allowed={allowed} />;
}

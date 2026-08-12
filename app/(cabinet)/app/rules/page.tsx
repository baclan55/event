import { loadRules, requirePortalUser } from '@/lib/cabinetData';
import { RulesView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  await requirePortalUser();
  const rules = await loadRules();
  return <RulesView rules={rules} />;
}

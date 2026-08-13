import { loadRules, requirePortalUser } from '@/lib/cabinetData';
import { RulesInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const user = await requirePortalUser();
  const rules = await loadRules();
  return (
    <RulesInteractive
      initialRules={rules}
      canEdit={userHasPermission(roleCtxFromPublic(user), 'edit_content', 'edit')}
    />
  );
}

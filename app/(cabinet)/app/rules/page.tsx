import { loadRules, requirePortalUser } from '@/lib/cabinetData';
import { RulesInteractive } from '@/components/cabinet/InteractiveCore';
import { EDIT_ROLES, userHasRoleIn } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const user = await requirePortalUser();
  const rules = await loadRules();
  return <RulesInteractive initialRules={rules} canEdit={userHasRoleIn({ is_owner: user.isOwner, roleNames: user.roles }, EDIT_ROLES)} />;
}

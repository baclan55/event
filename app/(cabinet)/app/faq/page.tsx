import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentInteractive } from '@/components/cabinet/InteractiveCore';
import { EDIT_ROLES, userHasRoleIn } from '@/lib/roleAccess';
import { tierForPriority } from '@/lib/tier';

export const dynamic = 'force-dynamic';

export default async function FaqPage() {
  const user = await requirePortalUser();
  const blocks = await loadContent('faq', user);
  return <ContentInteractive section="faq" title="FAQ" initialBlocks={blocks} canEdit={userHasRoleIn({ is_owner: user.isOwner, roleNames: user.roles }, EDIT_ROLES)} splitByAudience canViewAdministrator={user.isOwner || tierForPriority(user.rolePriority) === 'admin'} />;
}

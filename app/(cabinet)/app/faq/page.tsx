import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentInteractive } from '@/components/cabinet/InteractiveCore';
import { userHasPermission } from '@/lib/roleAccess';
import { tierForPriority } from '@/lib/tier';

export const dynamic = 'force-dynamic';

export default async function FaqPage() {
  const user = await requirePortalUser();
  const blocks = await loadContent('faq', user);
  const roleUser = {
    is_owner: user.isOwner,
    roleNames: user.roles,
    permissions: user.permissions,
  };
  return (
    <ContentInteractive
      section="faq"
      title="FAQ"
      initialBlocks={blocks}
      canEdit={userHasPermission(roleUser, 'edit_content')}
      splitByAudience
      canViewAdministrator={user.isOwner || tierForPriority(user.rolePriority) === 'admin'}
    />
  );
}

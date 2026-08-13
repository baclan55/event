import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';
import { tierForPriority } from '@/lib/tier';

export const dynamic = 'force-dynamic';

export default async function RegulationsPage() {
  const user = await requirePortalUser();
  const blocks = await loadContent('regulations', user);
  const roleUser = roleCtxFromPublic(user);
  return (
    <ContentInteractive
      section="regulations"
      title="Регламент"
      initialBlocks={blocks}
      canEdit={userHasPermission(roleUser, 'edit_content', 'edit')}
      splitByAudience
      canViewAdministrator={user.isOwner || user.isAdministrator || tierForPriority(user.rolePriority) === 'admin'}
    />
  );
}

import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentInteractive } from '@/components/cabinet/InteractiveCore';
import { userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function FirstStepsPage() {
  const user = await requirePortalUser();
  const blocks = await loadContent('first_steps', user);
  return (
    <ContentInteractive
      section="first_steps"
      title="Первые шаги"
      initialBlocks={blocks}
      canEdit={userHasPermission(
        { is_owner: user.isOwner, roleNames: user.roles, permissions: user.permissions },
        'edit_content',
      )}
    />
  );
}

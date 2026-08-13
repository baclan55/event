import { loadRoster, requirePortalUser } from '@/lib/cabinetData';
import { RosterInteractive } from '@/components/cabinet/InteractiveCore';
import { userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const user = await requirePortalUser();
  const data = await loadRoster();
  const roleUser = {
    is_owner: user.isOwner,
    roleNames: user.roles,
    permissions: user.permissions,
  };
  return (
    <RosterInteractive
      initialMembers={data.members}
      roles={data.roles}
      target={data.target}
      canEdit={userHasPermission(roleUser, 'edit_content')}
      canViewProfiles
      canGrantOwner={userHasPermission(roleUser, 'grant_owner')}
      actorRolePriority={user.rolePriority}
      actorIsOwner={user.isOwner}
      actorId={user.id}
    />
  );
}

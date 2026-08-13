import { loadRoster, requirePortalUser } from '@/lib/cabinetData';
import { RosterInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const user = await requirePortalUser();
  const data = await loadRoster();
  const roleUser = roleCtxFromPublic(user);
  return (
    <RosterInteractive
      initialMembers={data.members}
      roles={data.roles}
      target={data.target}
      canEdit={userHasPermission(roleUser, 'edit_content', 'edit')}
      canViewProfiles
      canGrantOwner={userHasPermission(roleUser, 'grant_owner', 'edit')}
      actorRolePriority={user.rolePriority}
      actorIsOwner={user.isOwner}
      actorId={user.id}
    />
  );
}

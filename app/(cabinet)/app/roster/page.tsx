import { loadRoster, requirePortalUser } from '@/lib/cabinetData';
import { RosterInteractive } from '@/components/cabinet/InteractiveCore';
import { EDIT_ROLES, REPRIMANDS_ROLES, userHasRoleIn } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const user = await requirePortalUser();
  const data = await loadRoster();
  const roleUser = { is_owner: user.isOwner, roleNames: user.roles };
  return (
    <RosterInteractive
      initialMembers={data.members}
      roles={data.roles}
      target={data.target}
      canEdit={userHasRoleIn(roleUser, EDIT_ROLES)}
      canViewProfiles={userHasRoleIn(roleUser, REPRIMANDS_ROLES)}
    />
  );
}

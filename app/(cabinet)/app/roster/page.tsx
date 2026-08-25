import { loadRoster, requirePortalUser } from '@/lib/cabinetData';
import { RosterInteractive } from '@/components/cabinet/InteractiveCore';
import {
  roleCtxFromPublic,
  userHasContentSectionCap,
  userHasPermission,
  userHasProfileOwnViewCap,
  userHasProfileViewCap,
} from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  const user = await requirePortalUser();
  const data = await loadRoster();
  const roleUser = roleCtxFromPublic(user);
  const canViewWeeklyMp = userHasProfileViewCap(roleUser, 'weekly_mp');
  const canViewOwnWeeklyMp = userHasProfileOwnViewCap(roleUser, 'weekly_mp');
  // Не только прячем бейдж на клиенте, но и не отдаём число тем, кому оно не положено.
  const members = data.members.map((member) => {
    const allowed = (member.id as number) === user.id ? canViewOwnWeeklyMp : canViewWeeklyMp;
    return allowed ? member : { ...member, weekly_events: null, weekly_target: null };
  });
  return (
    <RosterInteractive
      initialMembers={members}
      roles={data.roles}
      target={data.target}
      canEdit={userHasContentSectionCap(roleUser, 'roster')}
      canViewProfiles
      canGrantOwner={userHasPermission(roleUser, 'grant_owner', 'edit')}
      actorRolePriority={user.rolePriority}
      actorIsOwner={user.isOwner}
      actorId={user.id}
      canViewWeeklyMp={canViewWeeklyMp}
      canViewOwnWeeklyMp={canViewOwnWeeklyMp}
    />
  );
}

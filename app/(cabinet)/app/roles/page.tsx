import { requirePortalUser } from '@/lib/cabinetData';
import { RolesInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const user = await requirePortalUser();
  const roleCtx = roleCtxFromPublic(user);
  if (!userHasPermission(roleCtx, 'manage_roles')) redirect('/app/dashboard');
  return <RolesInteractive canGrantOwner={userHasPermission(roleCtx, 'grant_owner', 'edit')} />;
}

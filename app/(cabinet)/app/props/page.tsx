import { loadProps, requirePortalUser } from '@/lib/cabinetData';
import { PropsInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function PropsPage() {
  const user = await requirePortalUser();
  const props = await loadProps();
  return (
    <PropsInteractive
      initialProps={props}
      canEdit={userHasPermission(roleCtxFromPublic(user), 'manage_props', 'edit')}
    />
  );
}

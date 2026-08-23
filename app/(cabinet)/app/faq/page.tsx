import { loadContent, requirePortalUser } from '@/lib/cabinetData';
import { ContentInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasContentAudienceCap } from '@/lib/roleAccess';
import { tierForPriority } from '@/lib/tier';

export const dynamic = 'force-dynamic';

export default async function FaqPage() {
  const user = await requirePortalUser();
  const blocks = await loadContent('faq', user);
  const roleUser = roleCtxFromPublic(user);
  return (
    <ContentInteractive
      section="faq"
      title="FAQ"
      initialBlocks={blocks}
      canEditHelper={userHasContentAudienceCap(roleUser, 'faq', 'helper')}
      canEditAdministrator={userHasContentAudienceCap(roleUser, 'faq', 'administrator')}
      splitByAudience
      canViewAdministrator={user.isOwner || user.isAdministrator || tierForPriority(user.rolePriority) === 'admin'}
    />
  );
}

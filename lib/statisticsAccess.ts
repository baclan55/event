import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser } from '@/lib/auth';
import {
  roleCtxFromPublic,
  STATS_CAP_PATHS,
  STATS_CAPS,
  userHasStatsCap,
  type StatsCap,
} from '@/lib/roleAccess';

export function statsAllowed(user: NonNullable<ReturnType<typeof publicUser>>): StatsCap[] {
  const ctx = roleCtxFromPublic(user);
  return STATS_CAPS.filter((cap) => userHasStatsCap(ctx, cap));
}

export async function requireStatsPage(cap: StatsCap) {
  const user = publicUser(await getCurrentUser());
  if (!user) redirect('/');
  const ctx = roleCtxFromPublic(user);
  const allowed = statsAllowed(user);
  if (!userHasStatsCap(ctx, cap)) {
    const fallback = allowed[0];
    redirect(fallback ? STATS_CAP_PATHS[fallback] : '/app/dashboard');
  }
  return { user, allowed };
}

import { NextResponse, type NextRequest } from 'next/server';
import { jsonError, publicUser } from '@/lib/auth';
import { requiredPerm } from '@/lib/api/helpers';
import {
  loadStatisticsSection,
  type StatsSection,
} from '@/lib/statisticsData';
import { parseStatsPeriod } from '@/lib/statisticsRange';
import {
  roleCtxFromPublic,
  userHasStatsCap,
  type StatsCap,
} from '@/lib/roleAccess';

const SECTIONS = new Set<StatsSection>([
  'overview',
  'events',
  'users',
  'achievements',
  'gmp',
  'applications',
  'reprimands',
]);

type Context = { params: Promise<{ section: string }> };

export async function GET(request: NextRequest, context: Context) {
  const user = await requiredPerm('view_statistics');
  if (user instanceof NextResponse) return user;

  const { section: raw } = await context.params;
  const section = raw as StatsSection;
  if (!SECTIONS.has(section)) return jsonError('Неизвестный раздел статистики.', 404);

  const cap = section as StatsCap;
  const pub = publicUser(user);
  if (!pub || !userHasStatsCap(roleCtxFromPublic(pub), cap)) {
    return jsonError('Недостаточно прав для этого раздела статистики.', 403);
  }

  const sp = request.nextUrl.searchParams;
  const period = parseStatsPeriod(sp.get('period'));
  const from = sp.get('from');
  const to = sp.get('to');

  const data = await loadStatisticsSection(section, { period, from, to });
  return NextResponse.json(data);
}

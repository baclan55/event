import type { NextRequest } from 'next/server';
import { jsonError } from '@/lib/auth';
import { handleApplications } from './api/applications';
import { handleContent } from './api/content';
import { readBody } from './api/helpers';
import { handlePortalExtra } from './api/portalExtra';
import { handleReprimands } from './api/reprimands';
import { handleRoles } from './api/roles';
import { handleRoster } from './api/roster';
import { handleSystem } from './api/system';
import type { ApiContext, ApiHandler } from './api/types';
import { handleVacations } from './api/vacations';

const handlers: ApiHandler[] = [
  handleSystem,
  handleContent,
  handleRoster,
  handleRoles,
  handlePortalExtra,
  handleReprimands,
  handleApplications,
  handleVacations,
];

export async function handle(
  key: string,
  request: NextRequest,
  context: ApiContext,
): Promise<Response> {
  const params = await context.params;
  const input = {
    key,
    request,
    params,
    method: request.method,
    body: await readBody(request),
  };

  try {
    for (const handler of handlers) {
      const response = await handler(input);
      if (response) return response;
    }
    return jsonError('Маршрут ещё не реализован.', 501);
  } catch (error) {
    console.error(`[api:${key}]`, error);
    return jsonError('Внутренняя ошибка сервера.', 500);
  }
}

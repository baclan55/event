import { Hono } from 'hono';
import { createDb } from './db.js';
import { attachUser } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import contentRoutes from './routes/content.js';
import rulesRoutes from './routes/rules.js';
import rosterRoutes from './routes/roster.js';
import reprimandsRoutes from './routes/reprimands.js';
import applicationsRoutes from './routes/applications.js';
import ownerRoutes from './routes/owner.js';
import mediaRoutes from './routes/media.js';

const app = new Hono();

// Статика (public/) отдаётся напрямую Cloudflare через assets-биндинг,
// минуя этот Worker — сюда долетают только /api/* и /media/*, плюс любые
// прочие несовпавшие пути (см. app.notFound ниже).

app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DATABASE_URL));
  await next();
});
app.use('/api/*', attachUser);

app.get('/api/config', (c) => c.json({
  appTitle: c.env.APP_TITLE || 'Event Department',
  appSubtitle: c.env.APP_SUBTITLE || 'Внутренний портал',
  weeklyEventsTarget: parseInt(c.env.WEEKLY_EVENTS_TARGET, 10) || 5,
  discordEnabled: Boolean(c.env.DISCORD_CLIENT_ID && c.env.DISCORD_CLIENT_SECRET),
}));

app.route('/api/auth', authRoutes);
app.route('/api/content', contentRoutes);
app.route('/api/rules', rulesRoutes);
app.route('/api/roster', rosterRoutes);
app.route('/api/reprimands', reprimandsRoutes);
app.route('/api/applications', applicationsRoutes);
app.route('/api/owner', ownerRoutes);
app.route('/media', mediaRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Такого API-маршрута не существует.' }, 404);
  }
  // Фронтенд использует hash-роутинг (#/roster и т.п.), так что реальных
  // серверных путей, кроме "/", не бывает — но на всякий случай отдаём
  // index.html для любого нераспознанного пути, как раньше делал Express.
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

app.onError((err, c) => {
  console.error('[error]', err?.message || err);
  return c.json({ error: 'Внутренняя ошибка сервера.' }, 500);
});

export default app;

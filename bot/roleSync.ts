// @ts-nocheck
/**
 * Синхронизация ролей: Discord-роль сотрудника → роль на сайте.
 *
 * Раз в DISCORD_ROLE_SYNC_INTERVAL_MS (по умолчанию 5 минут) бот проходит
 * всех сотрудников с привязанным discord_id, запрашивает их текущие роли на
 * сервере Discord через REST «получить участника гильдии» (GET
 * /guilds/{guild.id}/members/{user.id}) и приводит роли на сайте
 * (user_roles) в соответствие с картой ROLE_ID_MAP ниже.
 *
 * Этот REST-запрос по одному участнику НЕ требует привилегированного intent
 * GUILD_MEMBERS и не требует новых прав/переприглашения бота на сервер —
 * см. README (раздел «Синхронизация ролей Discord → сайт»). Intent нужен
 * только для необязательного мгновенного отклика на guildMemberUpdate,
 * который включается отдельно через DISCORD_ROLE_SYNC_LIVE.
 *
 * Роль "Technical Administrator" в карту сознательно НЕ входит — она
 * выдаётся только вручную на сайте (Панель владельца / Состав) и этим
 * синком никогда не добавляется и не снимается.
 */

/** Discord role ID → имя роли на сайте (см. ROLES в scripts/seed.ts). */
const ROLE_ID_MAP = {
  '1437378111523127296': 'Mini Event Helper',
  '1437378109224652840': 'Event Helper',
  '1437378107362508862': 'Senior Event Helper',
  '1437378102253588562': 'Dep.Chief Event Helper',
  '1437377718722498711': 'Chief Event Helper',
  '1437428438108606525': 'Event Administrator',
  '1468163722534191115': 'Curator Event',
  '1480934391764090920': 'Dep.Chief Event',
  '1437377229691818075': 'Chief Event',
};

/** Имена ролей, которыми управляет синк (Technical Administrator сюда не входит). */
const AUTO_SYNCED_ROLE_NAMES = new Set(Object.values(ROLE_ID_MAP));

function resolveSyncIntervalMs() {
  const raw = parseInt(process.env.DISCORD_ROLE_SYNC_INTERVAL_MS, 10);
  if (!Number.isFinite(raw)) return 5 * 60_000;
  return Math.max(60_000, raw);
}

function resolveGuildId() {
  return (process.env.DISCORD_GUILD_ID || '').trim();
}

function isLiveSyncEnabled() {
  return String(process.env.DISCORD_ROLE_SYNC_LIVE || '').trim() === '1';
}

/** id/название сайтовых ролей из ROLE_ID_MAP — одним запросом. */
async function loadAutoRoleIds(pool) {
  const names = [...AUTO_SYNCED_ROLE_NAMES];
  const { rows } = await pool.query(
    'SELECT id, name FROM roles WHERE name = ANY($1::text[])',
    [names],
  );
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) {
    console.warn(
      `[role-sync] На сайте не найдены роли: ${missing.join(', ')}. ` +
      'Примените `npm run db:seed`, чтобы создать недостающие роли.',
    );
  }
  return byName;
}

async function isBlacklisted(pool, { userId, discordId }) {
  const { rows } = await pool.query(
    `SELECT id FROM blacklist WHERE user_id=$1 OR (discord_id=$2 AND discord_id<>'') LIMIT 1`,
    [userId, discordId || ''],
  );
  return !!rows[0];
}

/** Полная замена «авто-ролей» пользователя с сохранением ручных (напр. Technical Administrator). */
async function applyRoleIds(pool, { userId, discordId, keepRoleIds, nextAutoRoleIds }) {
  const finalIds = [...new Set([...keepRoleIds, ...nextAutoRoleIds])];

  if (nextAutoRoleIds.length && (await isBlacklisted(pool, { userId, discordId }))) {
    console.warn(`[role-sync] Пропуск user #${userId} — в чёрном списке.`);
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (finalIds.length) {
      await client.query(
        'DELETE FROM user_roles WHERE user_id=$1 AND NOT (role_id = ANY($2::int[]))',
        [userId, finalIds],
      );
      for (const roleId of finalIds) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES ($1,$2,now())
           ON CONFLICT DO NOTHING`,
          [userId, roleId],
        );
      }
    } else {
      await client.query('DELETE FROM user_roles WHERE user_id=$1', [userId]);
    }

    // user_role_history: закрыть интервалы ролей, которых больше нет, открыть новые.
    const open = await client.query(
      'SELECT id, role_id FROM user_role_history WHERE user_id=$1 AND ended_at IS NULL',
      [userId],
    );
    const openByRole = new Map(open.rows.map((r) => [r.role_id, r.id]));
    const finalSet = new Set(finalIds);
    for (const row of open.rows) {
      if (!finalSet.has(row.role_id)) {
        await client.query(
          'UPDATE user_role_history SET ended_at=now() WHERE id=$1 AND ended_at IS NULL',
          [row.id],
        );
      }
    }
    for (const roleId of finalIds) {
      if (!openByRole.has(roleId)) {
        await client.query(
          `INSERT INTO user_role_history (user_id, role_id, started_at, ended_at)
           VALUES ($1,$2,now(),NULL)`,
          [userId, roleId],
        );
      }
    }

    // Лучшая (по priority) роль пользователя → users.role_id (как recomputeBestRole в lib/roles.ts).
    const best = await client.query(
      `SELECT r.id FROM user_roles ur JOIN roles r ON r.id=ur.role_id
       WHERE ur.user_id=$1 ORDER BY r.priority ASC LIMIT 1`,
      [userId],
    );
    await client.query('UPDATE users SET role_id=$1 WHERE id=$2', [best.rows[0]?.id ?? null, userId]);

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Сверяет текущие роли пользователя на сайте со списком Discord role ID
 * и, если требуется, обновляет user_roles. discordRoleIds — массив ID ролей
 * (строки) участника на Discord-сервере ИЛИ null (участник не найден на
 * сервере — считается, что авто-ролей у него больше нет).
 */
async function syncOneMember(pool, { userId, discordId, discordRoleIds, roleNameToId }) {
  const current = await pool.query(
    `SELECT r.id, r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1`,
    [userId],
  );
  const keepRoleIds = current.rows
    .filter((r) => !AUTO_SYNCED_ROLE_NAMES.has(r.name))
    .map((r) => r.id);
  const currentAutoNames = current.rows
    .filter((r) => AUTO_SYNCED_ROLE_NAMES.has(r.name))
    .map((r) => r.name)
    .sort();

  const discordSet = new Set(discordRoleIds || []);
  const nextAutoNames = [];
  const nextAutoRoleIds = [];
  for (const [discordRoleId, roleName] of Object.entries(ROLE_ID_MAP)) {
    if (!discordSet.has(discordRoleId)) continue;
    const id = roleNameToId.get(roleName);
    if (!id) continue; // роль ещё не создана на сайте — пропускаем, а не падаем
    nextAutoNames.push(roleName);
    nextAutoRoleIds.push(id);
  }
  nextAutoNames.sort();

  if (nextAutoNames.join('|') === currentAutoNames.join('|')) {
    return { changed: false };
  }

  await applyRoleIds(pool, { userId, discordId, keepRoleIds, nextAutoRoleIds });
  return { changed: true, before: currentAutoNames, after: nextAutoNames };
}

/** Находит пользователя по discord_id и синкает его роли (для live-обновлений). */
async function syncMemberByDiscordId(pool, discordId, discordRoleIds, roleNameToId) {
  const map = roleNameToId || (await loadAutoRoleIds(pool));
  const { rows } = await pool.query('SELECT id FROM users WHERE discord_id=$1', [discordId]);
  if (!rows[0]) return { changed: false, skipped: 'no-account' };
  return syncOneMember(pool, { userId: rows[0].id, discordId, discordRoleIds, roleNameToId: map });
}

/**
 * Полный проход по всем сотрудникам с привязанным Discord.
 * fetchMemberRoleIds(guildId, discordId) должен вернуть массив ID ролей
 * участника (строки) или null, если участника нет на сервере.
 */
async function runRoleSyncPass(pool, fetchMemberRoleIds) {
  const guildId = resolveGuildId();
  if (!guildId) {
    console.warn(
      '[role-sync] DISCORD_GUILD_ID не задан — синхронизация ролей Discord → сайт пропущена.',
    );
    return;
  }

  const roleNameToId = await loadAutoRoleIds(pool);
  const { rows: users } = await pool.query(
    `SELECT id, discord_id FROM users WHERE discord_id IS NOT NULL AND discord_id <> ''`,
  );

  let checked = 0;
  let updated = 0;
  for (const u of users) {
    checked += 1;
    let discordRoleIds = null;
    try {
      discordRoleIds = await fetchMemberRoleIds(guildId, u.discord_id);
    } catch (err) {
      console.error(
        `[role-sync] Не удалось получить роли Discord для user #${u.id} (${u.discord_id}):`,
        err.message || err,
      );
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }

    try {
      const result = await syncOneMember(pool, {
        userId: u.id,
        discordId: u.discord_id,
        discordRoleIds: discordRoleIds || [],
        roleNameToId,
      });
      if (result.changed) {
        updated += 1;
        console.log(
          `[role-sync] user #${u.id}: [${result.before.join(', ') || '—'}] → ` +
          `[${result.after.join(', ') || '—'}]`,
        );
      }
    } catch (err) {
      console.error(`[role-sync] Ошибка обновления ролей user #${u.id}:`, err.message || err);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (checked) {
    console.log(`[role-sync] Проверено сотрудников: ${checked}, обновлено: ${updated}.`);
  }
}

export {
  ROLE_ID_MAP,
  AUTO_SYNCED_ROLE_NAMES,
  resolveSyncIntervalMs,
  resolveGuildId,
  isLiveSyncEnabled,
  runRoleSyncPass,
  syncOneMember,
  syncMemberByDiscordId,
};

// Заполняет базу начальными данными: иерархия ролей, назначение владельца
// по Discord ID и заготовки текстов для FAQ / Регламента / Первых шагов,
// чтобы страницы не были пустыми сразу после установки.
// Запуск: npm run db:seed  (безопасно запускать повторно — не создаёт дублей)
require('dotenv').config();
const pool = require('./pool');

// Иерархия ролей — от самой высокой (priority 1) до самой низкой.
const ROLES = [
  'Chief Event',
  'Dep.Chief Event',
  'Technical Administrator',
  'Curator Event',
  'Event Administrator',
  'Chief Event Helper',
  'Dep.Chief Event Helper',
  'Senior Event Helper',
  'Event Helper',
  'Mini Event Helper',
];

const DEFAULT_CONTENT = [
  {
    section: 'faq',
    audience: 'helper',
    body:
      'Последовательность проведения мероприятия для Event Helper:\n\n' +
      '1. Придите на точку сбора за 10 минут до начала.\n' +
      '2. Проверьте список участников и раздайте роли.\n' +
      '3. Озвучьте правила мероприятия перед началом.\n' +
      '4. Следите за соблюдением регламента во время ивента.\n' +
      '5. По завершении — соберите отзывы и отправьте отчёт куратору.\n\n' +
      'Этот текст можно отредактировать в режиме администратора.',
  },
  {
    section: 'faq',
    audience: 'administrator',
    body:
      'Последовательность проведения мероприятия для Event Administrator:\n\n' +
      '1. Утвердите сценарий мероприятия минимум за сутки.\n' +
      '2. Назначьте ответственных Event Helper.\n' +
      '3. Проконтролируйте готовность локации и реквизита.\n' +
      '4. Присутствуйте на мероприятии либо назначьте замену.\n' +
      '5. Примите отчёт и внесите мероприятие в статистику отдела.\n\n' +
      'Этот текст можно отредактировать в режиме администратора.',
  },
  {
    section: 'regulations',
    audience: 'helper',
    body:
      'Регламент работы Event Helper.\n\nЗдесь будет размещён текст регламента ' +
      'для этой роли. Нажмите «Редактировать», чтобы вставить свой текст и картинку.',
  },
  {
    section: 'regulations',
    audience: 'administrator',
    body:
      'Регламент работы Event Administrator.\n\nЗдесь будет размещён текст регламента ' +
      'для этой роли. Нажмите «Редактировать», чтобы вставить свой текст и картинку.',
  },
  {
    section: 'first_steps',
    audience: 'general',
    body:
      'Первые шаги нового сотрудника Event-отдела.\n\nЗдесь будет размещена инструкция ' +
      'для новичков: с чего начать, к кому обращаться, что изучить в первую очередь. ' +
      'Нажмите «Редактировать», чтобы вставить свой текст и картинку.',
  },
];

const DEFAULT_RULES = [
  {
    title: 'Использование звука во время мероприятий',
    body:
      'Прежде чем начать, ведущий обязан предупредить участников о моментах ' +
      'с громким звуком или анимациями. Суть правила — забота о комфорте участников ' +
      'и предотвращение случайных жалоб.',
  },
  {
    title: 'Взаимодействие с реквизитом',
    body:
      'Реквизит выдаётся только зарегистрированным участникам мероприятия и должен быть ' +
      'возвращён по завершении. Суть правила — сохранность имущества отдела.',
  },
];

async function ensureRoles(client) {
  for (let i = 0; i < ROLES.length; i++) {
    await client.query(
      `INSERT INTO roles (name, priority) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET priority = EXCLUDED.priority`,
      [ROLES[i], i + 1]
    );
  }
  console.log(`[seed] Роли готовы (${ROLES.length}).`);
}

// Вход теперь только через Discord, поэтому владелец назначается по его
// Discord ID (переменная DISCORD_OWNER_ID), а не логином/паролем.
// Если пользователь с таким discord_id ещё не входил на сайт — назначать
// пока нечего, он получит права владельца автоматически при первом входе
// через Discord (см. src/routes/auth.js). Эта функция полезна, если
// DISCORD_OWNER_ID добавили уже после того, как человек когда-то входил.
async function ensureOwner(client) {
  const discordId = process.env.DISCORD_OWNER_ID;
  if (!discordId) {
    console.log('[seed] DISCORD_OWNER_ID не задан — пропускаю назначение владельца (см. README.md).');
    return;
  }

  const { rows } = await client.query(
    'SELECT id, nickname, is_owner FROM users WHERE discord_id = $1',
    [discordId]
  );
  if (!rows.length) {
    console.log(
      `[seed] Пользователь с Discord ID "${discordId}" ещё не входил через Discord — ` +
      'он автоматически получит права владельца при первом входе, ничего делать не нужно.'
    );
    return;
  }
  if (rows[0].is_owner) {
    console.log(`[seed] "${rows[0].nickname}" уже владелец — пропускаю.`);
    return;
  }

  await client.query('UPDATE users SET is_owner = TRUE, is_admin = TRUE WHERE id = $1', [rows[0].id]);
  console.log(`[seed] "${rows[0].nickname}" назначен(а) владельцем.`);
}

async function ensureContent(client) {
  for (const block of DEFAULT_CONTENT) {
    await client.query(
      `INSERT INTO content_blocks (section, audience, body)
       VALUES ($1, $2, $3)
       ON CONFLICT (section, audience) DO NOTHING`,
      [block.section, block.audience, block.body]
    );
  }
  console.log('[seed] Заготовки FAQ/Регламента/Первых шагов готовы.');
}

async function ensureRules(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM rules');
  if (rows[0].c > 0) {
    console.log('[seed] Правила МП уже есть — пропускаю.');
    return;
  }
  for (let i = 0; i < DEFAULT_RULES.length; i++) {
    const r = DEFAULT_RULES[i];
    await client.query(
      `INSERT INTO rules (position, title, body) VALUES ($1, $2, $3)`,
      [i, r.title, r.body]
    );
  }
  console.log(`[seed] Добавлены примеры правил (${DEFAULT_RULES.length}).`);
}

async function seed() {
  const client = await pool.connect();
  try {
    await ensureRoles(client);
    await ensureOwner(client);
    await ensureContent(client);
    await ensureRules(client);
    console.log('[seed] Готово.');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('[seed] Ошибка:', err);
  process.exit(1);
});

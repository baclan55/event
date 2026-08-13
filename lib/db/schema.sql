-- ============================================================================
-- Event Department Portal — схема базы данных (PostgreSQL)
-- Применяется через: npm run db:migrate
-- Скрипт идемпотентен — использует IF NOT EXISTS везде, где это возможно,
-- поэтому его безопасно запускать повторно.
-- ============================================================================

-- Иерархия ролей (от высшей к низшей — определяется полем priority:
-- меньший priority = выше в списке = главнее).
CREATE TABLE IF NOT EXISTS roles (
  id         SERIAL PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  priority   INTEGER NOT NULL
);
-- Набор доступов роли (JSONB: ключи из lib/roleAccess PERMISSIONS).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Универсальное хранилище картинок (аватары, иллюстрации к разделам и правилам).
-- Храним прямо в базе (bytea), чтобы не зависеть от диска Render, который
-- не сохраняется между деплоями/перезапусками контейнера.
CREATE TABLE IF NOT EXISTS images (
  id         SERIAL PRIMARY KEY,
  mime_type  TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Пользователи (сотрудники). login/password_hash — вход по паролю,
-- discord_id — вход через Discord. Одновременно эта таблица — источник
-- данных для страницы "Состав".
-- status: 'member' — обычный сотрудник, 'candidate' — кандидат, которого
-- одобрили по заявке, но он ещё не прошёл обзвон (см. applications ниже).
-- Пока кандидат — у него нет роли (role_id) и он не входит в "С ролями".
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  login            TEXT UNIQUE,
  password_hash    TEXT,
  discord_id       TEXT UNIQUE,
  discord_username TEXT,
  nickname         TEXT NOT NULL,
  avatar_image_id  INTEGER REFERENCES images(id) ON DELETE SET NULL,
  role_id          INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  is_owner         BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  weekly_events    INTEGER NOT NULL DEFAULT 0,
  note             TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'member';
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Блокировка учётной записи — выставляется автоматически системой выговоров
-- (см. src/utils/reprimandRules.js), когда у сотрудника набирается
-- максимум баллов для его тира. Заблокированный аккаунт НЕ удаляется и не
-- теряет данные — вся история (выговоры и т.п.) сохраняется как есть,
-- блокируется только доступ в личный кабинет (см. requireAuth и т.п. в
-- src/middleware/auth.js). Снимается вручную (POST
-- /api/reprimands/users/:id/unblock) либо автоматически, если баллы
-- пересчитываются ниже порога (актуально для баллов администраторов,
-- которые сгорают через ADMIN_POINT_DECAY_DAYS дней).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON users(is_blocked);

-- Аватар через Cloudinary (опционально, см. src/utils/cloudinary.js). Если
-- задан avatar_url — используется он (отдаётся напрямую с CDN Cloudinary),
-- иначе фронтенд показывает старый avatar_image_id (картинка из таблицы
-- images в этой же базе). avatar_public_id хранится, чтобы можно было
-- удалить прежний файл в Cloudinary при загрузке нового аватара.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_public_id TEXT;

-- Текстовые разделы с переключателем "Event Helper / Event Administrator":
-- используется для FAQ и Регламента. section: 'faq' | 'regulations'.
-- audience: 'helper' | 'administrator'.
CREATE TABLE IF NOT EXISTS content_blocks (
  id          SERIAL PRIMARY KEY,
  section     TEXT NOT NULL,
  audience    TEXT NOT NULL DEFAULT 'general',
  body        TEXT NOT NULL DEFAULT '',
  image_id    INTEGER REFERENCES images(id) ON DELETE SET NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (section, audience)
);

-- Перенос старого общего блока FAQ/регламента во вкладку Event Helper.
-- Если helper-блок уже существует, сохраняем его и удаляем только legacy-дубль.
INSERT INTO content_blocks (section, audience, body, image_id, updated_by, updated_at)
SELECT section, 'helper', body, image_id, updated_by, updated_at
FROM content_blocks
WHERE section IN ('faq', 'regulations') AND audience = 'general'
ON CONFLICT (section, audience) DO NOTHING;
DELETE FROM content_blocks
WHERE section IN ('faq', 'regulations') AND audience = 'general';

-- Правила МП — список правил, каждое со своим текстом/картинкой.
CREATE TABLE IF NOT EXISTS rules (
  id         SERIAL PRIMARY KEY,
  position   INTEGER NOT NULL DEFAULT 0,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  image_id   INTEGER REFERENCES images(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Система выговоров. Разделена на два тира по роли сотрудника (см.
-- src/utils/tier.js и src/utils/reprimandRules.js):
--  — у хелперов type = 'verbal' (устный = 1 балл) или 'strict' (строгий =
--    2 балла); при достижении 4 баллов аккаунт блокируется автоматически
--    (см. users.is_blocked выше). Как только у сотрудника набирается 2
--    непогашенных устных, они автоматически объединяются в 1 строгий —
--    устные при этом остаются в истории (converted=TRUE), просто больше не
--    учитываются в баллах отдельно;
--  — у администраторов type всегда 'point' (балл, максимум 3, тоже ведёт к
--    блокировке при достижении) — каждый балл автоматически перестаёт
--    учитываться через 10 дней после выдачи (запись не удаляется).
CREATE TABLE IF NOT EXISTS reprimands (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  issued_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reprimands ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'verbal';
CREATE INDEX IF NOT EXISTS idx_reprimands_type ON reprimands(type);

-- converted=TRUE у устного выговора хелпера — объединён вместе с ещё одним
-- устным в автоматический строгий (см. merged_into), но остаётся в истории.
-- auto_generated=TRUE у строгого — создан автоматически таким объединением
-- (ТОЛЬКО у хелперов; у администраторов не используется).
-- merged_into — на какой именно строгий выговор были объединены 2 устных;
-- ON DELETE SET NULL — если этот строгий потом удалят (отменят объединение
-- вручную), устные автоматически отвязываются и код возвращает им
-- converted=FALSE, снова делая их активными (см. DELETE в
-- src/routes/reprimands.js).
ALTER TABLE reprimands ADD COLUMN IF NOT EXISTS converted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reprimands ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reprimands ADD COLUMN IF NOT EXISTS merged_into INTEGER REFERENCES reprimands(id) ON DELETE SET NULL;

-- Заявки на роль Event Helper (публичная форма на главной странице, без входа).
-- contact/message оставлены для обратной совместимости со старыми записями,
-- новые заявки используют отдельные поля ниже.
-- status: 'pending' -> 'approved' (создаёт/помечает кандидата в users,
-- candidate_user_id) -> 'call_passed' (кандидат прошёл обзвон, получает роль
-- Mini Event Helper) или 'call_failed' (не прошёл обзвон, кандидат снимается).
-- Также возможен статус 'rejected' на любом этапе рассмотрения.
CREATE TABLE IF NOT EXISTS applications (
  id             SERIAL PRIMARY KEY,
  applicant_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applicant_name TEXT NOT NULL,
  contact        TEXT NOT NULL DEFAULT '',
  message        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS candidate_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Поля формы заявки (см. src/routes/applications.js). ADD COLUMN IF NOT EXISTS
-- делает это безопасным при повторном запуске и на уже существующей базе.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS discord          TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS nickname_static  TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS age              TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS avg_online       TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS time_period      TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS experience       TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ideas            TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS motivation       TEXT NOT NULL DEFAULT '';

-- Открыт ли сейчас приём заявок на Event Helper — одна строка (id всегда 1,
-- по тому же принципу, что и weekly_reset_state ниже). Переключается из
-- раздела «Заявки» (см. src/routes/applications.js -> PUT /status), читается
-- публичной формой подачи заявки без входа (GET /status) — см.
-- public/js/site.js -> Site.renderApply.
CREATE TABLE IF NOT EXISTS applications_settings (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  is_open    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT applications_settings_single_row CHECK (id = 1)
);
ALTER TABLE applications_settings
  ADD COLUMN IF NOT EXISTS closed_message TEXT NOT NULL
  DEFAULT 'Набор закрыт — следите за новостями о новом наборе.';
INSERT INTO applications_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Таблица сессий для connect-pg-simple (тем же способом её создаёт сама
-- библиотека, но мы объявляем явно, чтобы миграция была самодостаточной).
CREATE TABLE IF NOT EXISTS "session" (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON    NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
ALTER TABLE "session" DROP CONSTRAINT IF EXISTS session_pkey;
ALTER TABLE "session" ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_session_expire ON "session" (expire);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_reprimands_user ON reprimands(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_position ON rules(position);

-- У сотрудника теперь может быть НЕСКОЛЬКО ролей одновременно (например,
-- роль в RP-иерархии + техническая Technical Administrator). Это реальный
-- список ролей пользователя; users.role_id остаётся кэшем "основной" (той,
-- что выше по приоритету, см. roles.priority) роли из этого набора —
-- пересчитывается при каждом изменении набора (см. src/db/roles.js) и
-- по-прежнему используется для сортировки/группировки в «Составе» и
-- определения тира (helper/admin, см. src/utils/tier.js). Проверки доступа
-- к разделам (см. src/utils/roleAccess.js) сверяются со ВСЕМ набором.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

-- Самовосстанавливающийся бэкафилл: переносит users.role_id в user_roles,
-- если там ещё нет соответствующей записи. При первом деплое этой фичи на
-- существующую базу переносит все ранее назначенные одиночные роли, чтобы
-- никто не остался без роли. В дальнейшем безвреден и по сути не делает
-- ничего (role_id всегда синхронизирован с user_roles приложением), но
-- служит подстраховкой на случай рассинхронизации. ON CONFLICT DO NOTHING
-- не создаёт дублей и не трогает тех, у кого уже явно назначено несколько
-- ролей.
INSERT INTO user_roles (user_id, role_id)
SELECT id, role_id FROM users WHERE role_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Отпуска сотрудников (раздел "Отпуска" личного кабинета). Единый тип
-- отпуска — без деления на плановый/внеплановый, сотрудник просто указывает
-- период дат и необязательную причину. Заявка проходит проверку у
-- руководства (см. VACATIONS_REVIEW_ROLES в src/utils/roleAccess.js —
-- Chief Event Helper, Chief Event, Dep.Chief Event).
-- status: 'pending' -> 'approved' | 'rejected' (выставляет руководство);
-- 'cancelled' может выставить сам автор заявки, пока она ещё не
-- рассмотрена, либо руководство в любой момент (см. src/routes/vacations.js).
CREATE TABLE IF NOT EXISTS vacations (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  CONSTRAINT vacations_dates_check CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_vacations_user ON vacations(user_id);
CREATE INDEX IF NOT EXISTS idx_vacations_status ON vacations(status);
CREATE INDEX IF NOT EXISTS idx_vacations_dates ON vacations(start_date, end_date);

-- Неизменяемый журнал административных действий. details хранит только
-- технический контекст операции, без сессионных токенов и секретов.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- Леджер начислений бота учёта посещаемости: кому (discord_id) за какое
-- сообщение (message_id) уже начислен +1 к weekly_events. Это и есть
-- защита от повторного начисления — на уровне ОТДЕЛЬНОГО участника, а не
-- всего сообщения целиком. Поэтому сообщение можно безопасно обрабатывать
-- повторно (при каждом редактировании, при перезапуске бота, при ручном
-- backfill) сколько угодно раз: тем, кто уже в этой таблице для данного
-- message_id, +1 не начислится снова, а тем, кто появился в списке
-- участников позже (список пополняется, пока сбор закрывают), начислится
-- при следующей же обработке. Раньше защита была по ЦЕЛОМУ сообщению
-- (обработали один раз — и всё, даже если участников в тексте потом стало
-- больше) — из-за этого при срабатывании маркера "закрыт" раньше времени
-- (например, только с администратором) остальные, кто вписывался в список
-- позже, никогда не засчитывались. См. историю изменений в README.
CREATE TABLE IF NOT EXISTS event_bot_credits (
  message_id  TEXT NOT NULL,
  discord_id  TEXT NOT NULL,
  credited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, discord_id)
);
CREATE INDEX IF NOT EXISTS idx_event_bot_credits_message ON event_bot_credits(message_id);

-- Состояние еженедельного сброса счётчика "МП в неделю" (users.weekly_events).
-- Одна-единственная строка (id всегда 1) хранит момент последнего сброса.
-- Нужна, чтобы после перезапуска сервера (или пробуждения после простоя —
-- актуально для бесплатного тарифа Render, где сервис засыпает без трафика)
-- не сбросить счётчик повторно в течение уже начавшейся недели и не
-- пропустить сброс, если в момент границы недели (понедельник 00:00)
-- сервис был выключен — при следующем старте/проверке сброс просто
-- выполнится с небольшим опозданием. См. src/utils/weeklyReset.js.
CREATE TABLE IF NOT EXISTS weekly_reset_state (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  last_reset_at TIMESTAMPTZ,
  CONSTRAINT weekly_reset_state_single_row CHECK (id = 1)
);

-- Сводка по каждому обработанному сообщению-сбору — теперь чисто
-- информационная (для логов/отладки), а не защита от повторной обработки
-- (эту роль теперь выполняет event_bot_credits выше). При каждой
-- обработке строка обновляется (UPSERT): credited_count накапливается
-- (сколько всего человек когда-либо получили +1 за это сообщение),
-- processed_at — время последней обработки.
CREATE TABLE IF NOT EXISTS event_bot_processed_messages (
  message_id        TEXT PRIMARY KEY,
  event_label       TEXT,
  participant_count INTEGER NOT NULL DEFAULT 0,
  credited_count    INTEGER NOT NULL DEFAULT 0,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Сборы МП из Discord-канала (парсинг сообщений бота-источника).
-- status: open — ещё есть кнопки; completed — кнопки сняты, засчитано;
-- abandoned — 24ч с кнопками / сообщение удалено, в статистику не идёт.
CREATE TABLE IF NOT EXISTS discord_gather_events (
  message_id         TEXT PRIMARY KEY,
  channel_id         TEXT NOT NULL,
  source_bot_id      TEXT,
  event_key          TEXT,
  title              TEXT NOT NULL DEFAULT '',
  message_created_at TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'completed', 'abandoned')),
  has_buttons        BOOLEAN NOT NULL DEFAULT TRUE,
  completed_at       TIMESTAMPTZ,
  abandoned_at       TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discord_gather_events_status
  ON discord_gather_events(status, message_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discord_gather_events_created
  ON discord_gather_events(message_created_at DESC);

CREATE TABLE IF NOT EXISTS discord_gather_participants (
  message_id TEXT NOT NULL REFERENCES discord_gather_events(message_id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  PRIMARY KEY (message_id, discord_id)
);
CREATE INDEX IF NOT EXISTS idx_discord_gather_participants_discord
  ON discord_gather_participants(discord_id);

-- Задачи для бота (кнопка «Пересобрать МП» на сайте).
CREATE TABLE IF NOT EXISTS event_bot_jobs (
  id           SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL DEFAULT 'resync',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'done', 'failed')),
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  result       JSONB,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_bot_jobs_pending
  ON event_bot_jobs(status, created_at)
  WHERE status IN ('pending', 'running');

-- ---------------------------------------------------------------------------
-- Классификация роли (не доступ к функциям) + блоки главной.
-- ---------------------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_event_helper BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_administrator BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS dashboard_blocks JSONB NOT NULL DEFAULT '{"stats":true,"top_admin":true,"top_helper":true}'::jsonb;

-- Стартовая классификация по известным именам (только если ещё не размечали вручную).
UPDATE roles SET is_administrator = TRUE
WHERE name IN (
  'Chief Event', 'Dep.Chief Event', 'Technical Administrator',
  'Curator Event', 'Event Administrator'
) AND is_event_helper = FALSE AND is_administrator = FALSE;

UPDATE roles SET is_event_helper = TRUE
WHERE name IN (
  'Chief Event Helper', 'Dep.Chief Event Helper', 'Senior Event Helper',
  'Event Helper', 'Mini Event Helper'
) AND is_event_helper = FALSE AND is_administrator = FALSE;

-- Игровой профиль сотрудника
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS static_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_static_id ON users(static_id) WHERE static_id IS NOT NULL;

-- Заявка: имя/фамилия/static id
ALTER TABLE applications ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS static_id TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS reject_reason TEXT NOT NULL DEFAULT '';

-- Модерация смены игровых данных (после первого заполнения)
CREATE TABLE IF NOT EXISTS profile_change_requests (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name  TEXT,
  last_name   TEXT,
  static_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_profile_change_pending ON profile_change_requests(status, created_at DESC);

-- Чёрный список (существующие и/или внешние идентификаторы)
CREATE TABLE IF NOT EXISTS blacklist (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  discord_id  TEXT,
  static_id   TEXT,
  reason      TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blacklist_has_identity CHECK (
    user_id IS NOT NULL OR (discord_id IS NOT NULL AND discord_id <> '') OR (static_id IS NOT NULL AND static_id <> '')
  )
);
CREATE INDEX IF NOT EXISTS idx_blacklist_discord ON blacklist(discord_id) WHERE discord_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_static ON blacklist(static_id) WHERE static_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_user ON blacklist(user_id) WHERE user_id IS NOT NULL;

-- Достижения
CREATE TABLE IF NOT EXISTS achievements (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  icon           TEXT NOT NULL DEFAULT '',
  trigger_type   TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_grade      INTEGER NOT NULL DEFAULT 1,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Иконки по степеням: ["url1","url2",...] — индекс 0 = 1-я степень.
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS grade_icons JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Скрытые: в профиле во вкладке «Скрытое», пока не получены.
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  grade          INTEGER NOT NULL DEFAULT 1,
  awarded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);

-- ГМП (большие мероприятия)
CREATE TABLE IF NOT EXISTS gmp_events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  starts_at   TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'open', 'closed')),
  written_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gmp_events_starts ON gmp_events(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmp_events_status ON gmp_events(status);
CREATE INDEX IF NOT EXISTS idx_gmp_events_written_by ON gmp_events(written_by);

CREATE TABLE IF NOT EXISTS gmp_staff (
  event_id  INTEGER NOT NULL REFERENCES gmp_events(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'staff'
              CHECK (role IN ('staff', 'organizer')),
  credited  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gmp_staff_user ON gmp_staff(user_id);

CREATE TABLE IF NOT EXISTS gmp_checkpoints (
  id        SERIAL PRIMARY KEY,
  event_id  INTEGER NOT NULL REFERENCES gmp_events(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  name      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gmp_checkpoints_event ON gmp_checkpoints(event_id, position);

CREATE TABLE IF NOT EXISTS gmp_reward_places (
  event_id         INTEGER NOT NULL REFERENCES gmp_events(id) ON DELETE CASCADE,
  place            INTEGER NOT NULL CHECK (place >= 1),
  dollars          INTEGER NOT NULL DEFAULT 0,
  mc               INTEGER NOT NULL DEFAULT 0,
  battle_pass_xp   INTEGER NOT NULL DEFAULT 0,
  static_id        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, place)
);
ALTER TABLE gmp_reward_places ADD COLUMN IF NOT EXISTS battle_pass_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gmp_reward_places ADD COLUMN IF NOT EXISTS static_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS gmp_players (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES gmp_events(id) ON DELETE CASCADE,
  static_id   TEXT NOT NULL,
  finished_at TIMESTAMPTZ,
  place       INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, static_id)
);
ALTER TABLE gmp_players ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE gmp_players ADD COLUMN IF NOT EXISTS block_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE gmp_players ADD COLUMN IF NOT EXISTS blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE gmp_players ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_gmp_players_event ON gmp_players(event_id);
CREATE INDEX IF NOT EXISTS idx_gmp_players_blocked ON gmp_players(event_id, is_blocked);

CREATE TABLE IF NOT EXISTS gmp_marks (
  player_id     INTEGER NOT NULL REFERENCES gmp_players(id) ON DELETE CASCADE,
  checkpoint_id INTEGER NOT NULL REFERENCES gmp_checkpoints(id) ON DELETE CASCADE,
  marked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (player_id, checkpoint_id)
);
CREATE INDEX IF NOT EXISTS idx_gmp_marks_checkpoint ON gmp_marks(checkpoint_id);

-- ============================================================================
-- Event Department Portal — схема базы данных (PostgreSQL / Neon)
-- Применяется через: npm run db:migrate
-- Скрипт идемпотентен — использует IF NOT EXISTS везде, где это возможно,
-- поэтому его безопасно запускать повторно.
-- ============================================================================

-- Иерархия ролей (от высшей к низшей — определяется полем priority)
CREATE TABLE IF NOT EXISTS roles (
  id         SERIAL PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  priority   INTEGER NOT NULL
);

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
-- src/utils/tier.js): у хелперов type = 'verbal' (устный, максимум 4) или
-- 'strict' (строгий, максимум 2) — не снимаются по времени; у
-- администраторов type всегда 'point' (балл, максимум 3) — каждый балл
-- автоматически перестаёт учитываться через 10 дней после выдачи.
CREATE TABLE IF NOT EXISTS reprimands (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  issued_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reprimands ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'verbal';
CREATE INDEX IF NOT EXISTS idx_reprimands_type ON reprimands(type);

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

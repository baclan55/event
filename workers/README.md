# Event Department — деплой на Cloudflare Workers

Это альтернативный бэкенд для того же портала, что и в корне проекта —
только вместо Express + Render здесь Hono + Cloudflare Workers. Фронтенд
(`public/`) общий для обоих вариантов, ничего в нём под Workers не
адаптировано и не задублировано.

Зачем два бэкенда: Render — обычный Node-сервер, Workers — глобальная
edge-сеть Cloudflare (быстрее в разных регионах, бесплатный тариф
щедрее, но другая модель выполнения — нет долгоживущего процесса).
Оба используют одну и ту же базу Neon и одну и ту же схему
(`src/db/schema.sql` в корне) — переключаться между ними можно без
миграций.

## Чем отличается от Render-версии

- **Сессии** — вместо таблицы `session` (connect-pg-simple) используется
  подписанная cookie (userId + HMAC-SHA256). Без лишней таблицы, без
  похода в базу за самой сессией — только за пользователем. Функционально
  ведёт себя так же: 30 дней жизни, HttpOnly, разлогин чистит cookie.
- **База** — вместо `pg` (TCP) используется `@neondatabase/serverless`
  (HTTP) — Workers не умеют держать обычные TCP-соединения. SQL-запросы
  и их параметры ($1, $2...) не менялись.
- **Загрузка файлов** — вместо multer используется встроенный в Workers
  `request.formData()`. Ограничения те же: только PNG/JPEG/WEBP/GIF,
  до 8 МБ.
- Всё остальное — роли, права, разделы, регистрация без роли по
  умолчанию — работает идентично.

## Установка

```bash
cd workers
npm install
```

## Локальная разработка

```bash
cp .dev.vars.example .dev.vars
# впишите в .dev.vars свой DATABASE_URL (та же база Neon) и SESSION_SECRET
npx wrangler dev
```

Откроется `http://localhost:8787`.

## Настройка базы (один раз)

Схема и сид-данные (владелец, роли) применяются обычными Node-скриптами
из **корня** проекта — они не зависят от того, на чём крутится бэкенд:

```bash
cd ..            # обратно в корень проекта
cp .env.example .env   # если ещё не делали; впишите DATABASE_URL и OWNER_*
npm install
npm run setup    # применит schema.sql и создаст владельца
```

## Продакшн-секреты

Секреты **не** хранятся в `wrangler.toml` (чтобы не утекли в git) —
задаются командой `wrangler secret put`:

```bash
cd workers
npx wrangler secret put DATABASE_URL
npx wrangler secret put SESSION_SECRET
# опционально, если нужен вход через Discord:
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_REDIRECT_URI
```

Для Discord `DISCORD_REDIRECT_URI` должен указывать на боевой домен,
например `https://event-department-portal.<ваш-поддомен>.workers.dev/api/auth/discord/callback`
(или на кастомный домен) — и точно такой же адрес нужно прописать в
настройках приложения на https://discord.com/developers/applications.

Несекретные настройки (`APP_TITLE`, `APP_SUBTITLE`,
`WEEKLY_EVENTS_TARGET`) правятся прямо в `wrangler.toml`, в блоке
`[vars]`.

## Деплой

```bash
cd workers
npx wrangler deploy
```

После первого деплоя Cloudflare выдаст адрес вида
`https://event-department-portal.<ваш-поддомен>.workers.dev`. Свой домен
подключается в дашборде Cloudflare: Workers & Pages → ваш Worker →
Settings → Domains & Routes.

## Проверка после деплоя

- `GET /api/config` должен вернуть JSON с настройками — если получаете
  ошибку 500, скорее всего не задан секрет `DATABASE_URL`.
- Регистрация/вход должны выдавать cookie `session` — если после входа
  каждый раз просит войти заново, проверьте `SESSION_SECRET` (должен
  быть одной и той же строкой между деплоями, иначе все выданные ранее
  cookie перестанут проходить проверку).

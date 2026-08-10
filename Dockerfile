# syntax=docker/dockerfile:1
#
# Events Denver — Event Department Portal
# Node.js + Express приложение, статику и API отдаёт один процесс
# (см. src/server.js). Файлы загружаются в память и пишутся в Postgres,
# поэтому образу не нужен постоянный диск для аплоадов.

ARG NODE_VERSION=20-alpine

# ---------------------------------------------------------------------------
# Стадия 1: устанавливаем только production-зависимости.
# Отдельная стадия нужна, чтобы слой с node_modules кэшировался и
# пересобирался только при изменении package*.json, а не при каждом
# изменении исходников.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Стадия 2: финальный рантайм-образ.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public

# Официальный образ node уже содержит непривилегированного пользователя
# "node" — запускаем процесс от него, а не от root.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Тот же путь, что и healthCheckPath в render.yaml — не требует БД/сессии,
# просто отдаёт JSON-конфиг приложения.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/config" > /dev/null || exit 1

CMD ["node", "src/server.js"]

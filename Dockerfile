# syntax=docker/dockerfile:1
#
# Targets: app | bot | caddy

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV SESSION_SECRET=build-time-session-secret-placeholder-32chars
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV APPLY_SCHEMA_ON_START=0
RUN npm run build

# ----- сайт (Next standalone) -----
FROM node:${NODE_VERSION} AS app
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV APPLY_SCHEMA_ON_START=0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health/live" > /dev/null || exit 1

CMD ["node", "server.js"]

# ----- бот -----
FROM node:${NODE_VERSION} AS bot
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/bot ./bot
COPY --from=builder /app/lib ./lib

CMD ["npx", "tsx", "bot/standalone.ts"]

# ----- Caddy: TLS + раздача статики + proxy на app -----
FROM caddy:2-alpine AS caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/.next/static /srv/_next/static
COPY --from=builder /app/public /srv/public

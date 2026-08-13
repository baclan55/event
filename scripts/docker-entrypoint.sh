#!/bin/sh
set -eu

# Автомиграция перед стартом Next (Portainer / docker compose).
# Отключить: APPLY_SCHEMA_ON_START=0
flag="$(printf '%s' "${APPLY_SCHEMA_ON_START:-1}" | tr '[:upper:]' '[:lower:]')"
if [ "$flag" != "0" ] && [ "$flag" != "false" ] && [ "$flag" != "off" ]; then
  echo "[entrypoint] применяю схему БД…"
  node /app/scripts/migrate.mjs
else
  echo "[entrypoint] APPLY_SCHEMA_ON_START выключен — миграция пропущена"
fi

exec "$@"

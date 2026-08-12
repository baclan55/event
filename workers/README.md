# Workers (legacy)

Экспериментальный Cloudflare Workers-бэкенд. **Основной прод — Next.js + Docker Postgres.**
Эта папка не нужна для текущего деплоя на VDS.

Если всё же запускаете локально (`wrangler dev`), укажите `DATABASE_URL` на тот же
Postgres, что у основного приложения (не облачный Neon).

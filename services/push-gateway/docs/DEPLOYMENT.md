# Deployment

Build with `bun run typecheck:push-gateway && cd services/push-gateway && bun run build`.

Install the service under `/srv/bluepy/current/services/push-gateway`, store SQLite at `/var/lib/bluepy-push-gateway/push.sqlite3`, and load secrets from `/etc/bluepy/push-gateway.env`. Include `NODE_ENV=production`, the active `VAPID_KEY_ID`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`; keep previous private keys in `VAPID_KEYS_JSON` until their subscriptions age out. Do not set `DEV_AUTH_TOKEN` outside local development.

Back up the SQLite database with WAL awareness, for example `sqlite3 /var/lib/bluepy-push-gateway/push.sqlite3 ".backup '/var/backups/bluepy-push-gateway/push-$(date +%F).sqlite3'"`.

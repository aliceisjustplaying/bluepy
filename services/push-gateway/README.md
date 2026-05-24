# Bluepy Push Gateway

Node service for Bluepy Web Push delivery. It owns subscription rows, per-account delivery settings, notification event dedupe, per-device delivery attempts, Jetstream cursor state, and short-lived rich-preview cache. It is not a notification inbox.

## Runtime

Required environment:

- `PUSH_GATEWAY_DB`
- `GATEWAY_PUBLIC_URL`
- `SERVICE_DID`
- `ALLOWED_ORIGINS`
- `LOG_HASH_SECRET`
- `VAPID_KEY_ID`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_KEYS_JSON` for previous key IDs during rotation, optional
- `VAPID_SUBJECT`
- `RICH_PREVIEWS_ENABLED`
- `ADMIN_TOKEN`
- `JETSTREAM_URL`

`GET /metrics` is localhost-only. `POST /admin/test-send` requires `ADMIN_TOKEN`.

## Auth

DID-scoped endpoints require ATProto `com.atproto.server.getServiceAuth` JWTs. The gateway verifies the token signature against the issuer DID document `#atproto` key, checks audience and method scope, and stores a hash of `iss:jti` or the raw token to reject replay.
V1 supports `did:plc` callers.

# Push Gateway Blockers

## Real-device delivery proof

The Node gateway can verify service-auth JWTs, register subscriptions, create delivery attempts, and call Web Push, but the end-to-end proof still requires a real browser/device subscription against the deployed gateway URL. The remaining proof points are admin test-send arrival, Jetstream reply/mention arrival, click-through to the target post/account, disable stopping sends, and dead subscription cleanup.

## Dev hostname DNS

`bluepy-push-gateway-dev.service` is installed and running on Hermes as the `agent` user, listening on `127.0.0.1:8790`. Caddy's live admin config routes `dev.notification-gateway.bluepy.social` to that service and serves `/.well-known/did.json` for `did:web:dev.notification-gateway.bluepy.social`.

As of 2026-05-24, `dev.notification-gateway.bluepy.social` is NXDOMAIN. Caddy cannot issue a public certificate and phone browsers cannot reach the gateway until that hostname resolves to this VPS. Current IPv4 observed from the host: `178.105.171.9`.

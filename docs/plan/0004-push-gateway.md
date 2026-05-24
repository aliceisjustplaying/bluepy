# Plan 0004: Push Gateway

Bluepy will use a Push Gateway for Web Push delivery because ATProto and Bluesky do not provide browser push endpoints for third-party clients. The Push Gateway is delivery infrastructure, not the canonical notification inbox.

The Push Gateway lives in this repo at `services/push-gateway/` and deploys to the VPS.

The gateway is written in TypeScript. Bun is used for package management and repo scripts; Node is the production runtime. V1 uses `@atcute/jetstream` for Jetstream consumption and does not require zstd compression.

V1 is production-only. Development uses a separate local gateway and database; preview and production subscriptions are not mixed.

The private VAPID key lives only on the VPS gateway. Bluepy Worker and client only use the public VAPID key, fetched from the gateway or mirrored as non-secret config.

VPS deployment secrets/config include VAPID private key, HMAC shared secret, SQLite path, allowed origins, and gateway public URL.

## Version scope

Implementation starts with schema, subscription/settings API, client settings UI, and admin test-send. Jetstream reply/mention delivery comes after real devices can register, unregister, and receive a test push. V1 is opened as a PR only after the end-to-end flow works locally or on the VPS.

V1 counts as working when a logged-in Bluepy user enables push, the browser registers with the gateway, admin test-send arrives on device, a Jetstream reply or mention from another account arrives as a rich push, tapping opens the target post in Bluepy, disabling push stops future sends, and dead subscription cleanup is observed or simulated.

### V1

V1 trusts Jetstream create events and does not perform AppView verification before sending. This keeps the first delivery path focused on subscription lifecycle, Jetstream candidate detection, dedupe, and delivery behavior; opening the notification fetches fresh AppView state.

V1 consumes Jetstream with a collection filter for `app.bsky.feed.post`, then filters locally for reply refs and mention facets.

V1 validates `app.bsky.feed.post` records with atcute lexicons before reading reply refs or mention facets. Invalid records are dropped with a metric.

V1 mention candidates come only from rich-text mention facets that include a DID. V1 does not parse `@handle` text into mentions.

V1 reply candidates include the root author, direct parent author, and mentioned DIDs, deduped and excluding the post author. Full prior-participant fanout is out of V1.

V1 derives root and parent authors by parsing DID-form `at://` authorities from `reply.root.uri` and `reply.parent.uri`. Malformed refs or handle-authority refs are skipped.

If the same source post creates both mention and reply candidates for one recipient, V1 sends one push and gives `mention` precedence over `reply`.

V1 only considers recipients who have registered push with Bluepy. The gateway keeps an indexed set of push-enabled recipient DIDs from SQLite and drops all other candidate events before delivery work.

V1 persists its Jetstream cursor in SQLite and resumes from it when possible. Replay uses a short window plus delivery dedupe; if the cursor is too old or rejected, the gateway resumes live and accepts missed push notifications. Push does not backfill the canonical notification inbox.

V1 sends replies and mentions only.

V1 settings are global push enabled, replies enabled, and mentions enabled. V1 does not respect mutes or blocks and does not add quiet hours, batching, keywords, or per-author push rules.

V1 shows a disclaimer in the Bluepy UI when enabling push that previews may include replies or mentions from muted or blocked accounts until V2. There is no separate first-run warning or consent screen.

V1 push settings live in the Push Gateway database, not ATProto preferences. They are Bluepy-private delivery settings needed for server-side send decisions.

Push enablement is explicit. The user clicks enable, the browser permission prompt happens as part of that action, and Bluepy only marks gateway push enabled after the device subscription registers successfully. If permission is denied or registration fails, global push is not enabled.

The V1 UI has one main "Push notifications" toggle. Internally, global enabled is account-level send permission and each browser subscription is a device row. Turning the toggle on registers the current device if needed and enables account push; turning it off disables sends for the account across devices. A separate "remove this device" action can be added later without becoming a second main toggle.

V1 shows replies and mentions as per-type checkboxes below the main push toggle.

Bluepy exposes settings for push, not a gateway-backed notification history. Debug state stays in gateway logs/admin tooling so the gateway does not become a second notification inbox.

V1 uses SQLite on the VPS for subscriptions, settings, delivery ledger, and gateway cursors.

V1 runs as a systemd service on the VPS with SQLite backups, a health endpoint, structured logs, and basic Prometheus metrics. Metrics include Jetstream connection state, events seen, candidates, sent pushes, drops, delivery failures, and dead subscriptions.

Prometheus metrics bind locally in V1.

V1 does not collect detailed open analytics. Detailed observability can be revisited in V2.

V1 gateway API shape: `GET /vapid-public-key`, `GET /settings`, `PUT /settings`, `POST /subscriptions`, and `DELETE /subscriptions/current`.

V1 SQLite tables: `settings`, `subscriptions`, `registration_tokens`, `deliveries`, `jetstream_state`, and `profile_cache`.

For Web Push send failures, `410` and `404` mark the endpoint inactive. Transient failures retry briefly, then drop.

V1 may expose an admin-only test-send endpoint for setup debugging. It must be local-only or admin-authenticated and must never be publicly unauthenticated.

V1 stores one subscription row per browser push endpoint, all under the owning DID. Delivery fanout sends to every active subscription for that DID. Gone or invalid push-service responses mark only that subscription inactive. Global push disable stops sends for the DID without deleting device rows.

Subscription registration is idempotent by push endpoint. Re-registering the same browser upserts keys and metadata while keeping the same logical device row where possible.

V1 dedupes deliveries by `(recipientDid, type, sourceAtUri, sourceCid)`. This suppresses duplicate sends after Jetstream reconnects or replays the same record event.

Delivery dedupe rows are retained for about 7 days. Rich snapshot/debug fields are retained for about 24 hours or less.

Users can disable push at two levels: browser unsubscribe removes the current endpoint, while the Bluepy global push setting disables all sends for the DID but keeps device rows for easy re-enable. Bluepy may also expose a "remove this device" action that deletes the current endpoint.

V1 supports iOS installed-PWA push through normal Web Push capability detection. There is no iOS-specific server path; the UI explains install-required state only when the browser reports no usable `PushManager` or permission path.

V1 subscription management uses the user's existing Bluepy login, not a separate gateway login. The Push Gateway may run on a VPS under a Bluepy-owned subdomain such as `notifications-gateway.bluepy.social`. Bluepy Worker mints a short-lived, gateway-scoped registration token for the logged-in DID; the browser sends that token with its Web Push subscription to the Push Gateway, and the gateway verifies the token before storing the subscription under that DID.

Bluepy Worker signs registration tokens with an HMAC secret shared with the Push Gateway. The token contains `did`, `aud`, `jti`, and `exp`.

Registration tokens are short-lived and single-use. Duplicate registration attempts request a fresh token.

V1 CORS allows Bluepy-owned origins only, using an explicit allowlist for `bluepy.social` and needed `*.bluepy.social` hosts. No wildcard CORS.

Registration stores DID as the subscription owner. It does not store the owner's current handle or display name as identity.

V1 supports multiple logged-in Bluepy accounts in the same browser through the active DID. If more than one account enables push from the same browser, the gateway stores rows keyed by `(did, endpoint)` for per-DID settings and delivery state. Invalid endpoint cleanup may mark all rows with that endpoint inactive. Settings always edit the active account.

V1 may send rich notification snapshots: notification type, actor display name/handle, a short sanitized post-text excerpt, and the target at-URI. Push content is validated at send time and treated as a moment-in-time preview; when opened, the app fetches fresh AppView state and may show updated, hidden, or deleted content.

V1 may fetch and cache the actor profile from the Bluesky AppView for display name and handle with a short TTL. Delivery proceeds with DID fallback if profile lookup fails; profile lookup is not a correctness gate.

V1 text excerpts are aggressively trimmed plain text, about 140 characters after sanitization. V1 does not expand URLs, include embedded-card text, or include media alt text in push payloads.

V1 push payloads contain `notificationId`, `type`, `targetAtUri`, `actorDid`, `actorHandle`, `actorDisplayName`, and `textExcerpt`. They never contain OAuth tokens, refresh tokens, DPoP material, full raw records, or embedded image data. `notificationId` is a gateway delivery id for dedupe/open telemetry, not a canonical inbox id.

The service worker shows the notification from the push payload immediately. It does not fetch before display. Notification clicks open `targetAtUri` directly.

Clicking a V1 push opens the canonical Bluepy at-URI permalink directly. The gateway does not sit in the click path.

If a post is deleted after a rich push is sent, V1 does nothing. When opened, Bluepy fetches fresh state and shows deleted, hidden, or not-found as appropriate.

### V2

V2 verifies candidate notifications against each recipient's Active AppView. This is the long-term model because Bluepy notification rendering is viewer/AppView-scoped, and different users may intentionally use different AppViews.

V2 adds likes and reposts.

V2 revisits mute, block, and moderation-aware verification before sending rich content.

V2 may add more sophisticated per-device, batching, or delivery-policy logic after V1 proves basic fanout and dead-subscription cleanup.

V2 ADRs are deferred until V2 design starts.

### V3

V3 adds the remaining notification types.

## Verification

V1 has unit tests for candidate extraction, dedupe, and registration-token verification; integration tests for the gateway API with temporary SQLite; and a manual real-device test for Web Push delivery.

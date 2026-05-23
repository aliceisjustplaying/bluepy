# ADR-0020: Telemetry via self-hosted Plausible; error tracking via Sentry

**Telemetry.** Page views, route changes, and a small set of named user-action events (post-published, login-success, login-failure, account-switch, feed-pinned) ship to a self-hosted Plausible instance owned by the user. No third-party analytics SDKs. No user IDs, no DIDs, no handle strings, no post URIs in event names — events are aggregate-only.

Implementation: `src/utils/telemetry.ts` exposes `trackPage(path)` and `trackEvent(name, props?)`. Calls are no-ops in `import.meta.env.DEV`. The Plausible script tag is injected from the document head with `data-domain="bluepy.social"` (or dev domain in non-prod builds).

**Error tracking.** Sentry (free tier: 5k errors/mo, source-map upload, Cloudflare Workers + Vite integration mature). Rollbar's free tier is comparable but Sentry's stack-trace + Workers + Vite story is materially better, so Sentry by default. The user owns the org.

Implementation: `src/utils/sentry.ts` initialises with DSN from build-time env; only enabled in `import.meta.env.PROD`. `beforeSend` scrubs: any DID (`did:plc:*`, `did:web:*`), any handle (any string matching `[a-z0-9-]+\.[a-z0-9.-]+`), any access/refresh token field, any record/blob CID, any request-body string. PII never leaves the client.

Error categories that Sentry sees:
- React error boundaries (component render exceptions)
- Unhandled promise rejections from data layer (`window.addEventListener('unhandledrejection')`)
- TanStack Query `onError` for non-handled mutation failures (handled = user-visible toast)
- OAuth token-refresh failures
- Service worker registration failures

Errors that Sentry does NOT see:
- Network errors that the data hook surfaces as `{error}` (these are expected; the UI handles them)
- ATProto rate-limit (429) responses (data hook surfaces; UI shows retry-after)
- 401/403 with valid auth (label-blocked / blocked-by, business-as-usual)
- User-initiated cancellations

**Rejected alternatives:**
- **Hosted Plausible / PostHog / Mixpanel** — paid; user already runs Plausible.
- **No telemetry.** We need to know whether the rebuild ships broken on real devices.
- **Rollbar** — equivalent at the free tier but worse source-map / Vite story.
- **Sentry replay sessions** — privacy ick, not on by default.

**Implications:**
- AFK agent does not invent new telemetry events. Event names are exactly the five above plus `data-fetch-error` (high-cardinality endpoint name, no payload).
- Sentry DSN is build-time env. Worker secrets covered by `~/.secrets/bluepy/source.env`.
- The PR loop's smoke check (`bun run test`) sets `SENTRY_DSN=` empty so test runs never send.

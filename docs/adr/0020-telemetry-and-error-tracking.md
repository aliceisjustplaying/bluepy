# ADR-0020: Telemetry via self-hosted Plausible; error tracking via Sentry

**Telemetry.** Page views, route changes, and a small set of named user-action events (post-published, login-success, login-failure, account-switch, feed-pinned) ship to a self-hosted Plausible instance owned by the user. No third-party analytics SDKs. No user IDs, no DIDs, no handle strings, no post URIs in event names or page paths — events are aggregate-only.

Implementation: `src/utils/telemetry.ts` exposes `trackPage(routeCategory)` and `trackEvent(name, props?)`. Calls are no-ops in `import.meta.env.DEV`. The Plausible script tag is injected from the document head with `data-domain="bluepy.social"` (or dev domain in non-prod builds).

**Page-path redaction is non-negotiable.** ADR-0001 puts literal at-URIs in the browser URL — `bluepy.social/at://did:plc:abc/app.bsky.feed.post/3kxyz`. Passing `window.location.pathname` straight to Plausible would leak per-DID and per-record activity into telemetry. `trackPage` accepts a **route category**, never a raw path:

```ts
type RouteCategory =
  | 'home'
  | 'notifications'
  | 'post-permalink'
  | 'profile'
  | 'feed'
  | 'list'
  | 'search'
  | 'settings'
  | 'oauth-callback'
  | 'not-found';

export function trackPage(category: RouteCategory): void;
```

The router maps the current location to a `RouteCategory` (a pure function in `src/render/route-category.ts`) and calls `trackPage(category)` on route change. If a future code path needs to send the path itself for any reason, it must go through `redactRoutePath(pathname)` which collapses at-URIs to opaque shape descriptors (`/at/:collection/:rkey`) — but this should not be needed for normal telemetry.

**Error tracking.** Sentry (free tier: 5k errors/mo, source-map upload, Cloudflare Workers + Vite integration mature). Rollbar's free tier is comparable but Sentry's stack-trace + Workers + Vite story is materially better, so Sentry by default. The user owns the org.

Implementation: `src/utils/sentry.ts` initialises with DSN from build-time env; only enabled in `import.meta.env.PROD`. `beforeSend` scrubs PII across **every** field that can carry it, not just the request body. The scrubber is applied to:

- `event.request.url` — strip query strings; collapse at-URI paths via `redactRoutePath`
- `event.transaction` — route categories only, never raw paths
- `event.breadcrumbs[].message`, `.data.url`, `.data.to`, `.data.from` — same path/URL scrubbing
- `event.tags`, `event.extra` — DID/handle/CID/token strings dropped
- `event.exception.values[].value`, `.stacktrace.frames[].vars` — DID/handle/CID/token strings replaced with `[redacted-did]` / `[redacted-handle]` / `[redacted-cid]` / `[redacted-token]`
- `event.user` — set to `undefined` always (no per-user telemetry in Sentry)
- Request bodies — same redactor

The redactor patterns:
- DIDs: `did:plc:[a-z0-9]+`, `did:web:[a-z0-9.\-]+`
- Handles: `[a-z0-9-]+\.[a-z0-9.-]+` (also catches `bsky.social` handles and custom-domain handles; the false-positive rate against benign strings is acceptable — telemetry favours over-redaction)
- Access/refresh/DPoP tokens: any JWT-shaped string (`eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+`)
- Record/blob CIDs: `(bafyrei|bafkrei|bafybei|bafkbei)[a-z2-7]{52}`

Error categories that Sentry sees:
- React error boundaries (component render exceptions)
- Unhandled promise rejections from data layer (`window.addEventListener('unhandledrejection')`)
- TanStack Query `onError` for non-handled mutation failures (handled = user-visible toast)
- OAuth token-refresh failures
- Service worker registration failures
- Persistence (IDB quota / schema mismatch) failures

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
- **Passing `window.location.pathname` to `trackPage`.** Leaks at-URI / DID / handle / record activity into telemetry; route-category mapping is the only correct shape.
- **Scrubbing only request bodies.** Stack traces, breadcrumbs, transaction names, and request URLs are full of at-URIs and DIDs; a body-only scrubber is a privacy bug.

**Implications:**
- AFK agent does not invent new telemetry events. Event names are exactly the five above plus `data-fetch-error` (high-cardinality endpoint name, no payload).
- Sentry DSN is build-time env. Worker secrets covered by `~/.secrets/bluepy/source.env`.
- The PR loop's smoke check (`bun run test`) sets `SENTRY_DSN=` empty so test runs never send.
- `src/render/route-category.ts` is a pure function with its own unit test at `tests/unit/route-category.test.ts` — exhaustive enumeration: every route in `src/router.tsx` maps to a `RouteCategory`; unknown paths map to `'not-found'`.
- `redactRoutePath` and the Sentry `beforeSend` scrubber are unit-tested at `tests/unit/sentry-scrub.test.ts` against fixtures containing each PII shape.

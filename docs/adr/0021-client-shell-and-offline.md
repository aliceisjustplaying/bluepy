# ADR-0021: Client shell — eager first paint, no progressive hydration, PWA + web push (flagged off), read-only offline

**First load posture.** Render as far as possible at first paint. Inline critical CSS (Vite handles this via `vite-plugin-html` or equivalent). Preload the OAuth client bundle and the active-DID restoration path. Show the application chrome (shortcut bar, nav) immediately; per-route content slots render with `{isLoading}` states from TanStack Query (ADR-0007). No splash screen, no full-screen spinner.

**No progressive hydration.** No React Suspense for data fetching. No `React.lazy` on first-load-critical routes. TanStack Query hooks return `{data, isLoading, error}`; components render the loading state synchronously and swap content when data resolves. The user explicitly dislikes the "shimmer of partial-hydration jank" that Suspense produces — we avoid it everywhere.

Route-level code splitting is fine (per-page chunks loaded on navigation), but the initial route's chunk is in the entry bundle. `React.lazy` is allowed for genuinely heavy non-critical paths (emoji picker, GIF picker, video player) after first paint.

**PWA.** Workbox-based service worker, inherited from Phanpy and updated for the new data layer. The SW caches the app shell (HTML/CSS/JS/fonts) with `precacheAndRoute` and serves it `stale-while-revalidate`. ATProto API responses are NOT cached by the SW — that's TanStack Query's job (see offline section). Manifest at `public/manifest.json` with full icon set + name "Bluepy" + display: standalone.

**Web push — feature-flagged off in phase (b).** A custom push service is planned (separate Cloudflare Worker at `workers/push/`, separate Durable Object storage keyed by DID, separate firehose-watching worker) but the worker side is out of scope for the rebuild — tracked as plan 0004. The **client-side** push subscription code IS in scope only as a no-op behind a feature flag:

```ts
// src/state/feature-flags.ts
export const featureFlags = {
  push: false,           // default-off; plan 0004 ships the server side
} as const;

// src/data/push.ts
export class FeatureDisabledError extends Error {}
export async function registerPushSubscription(did: string): Promise<PushSubscription> {
  if (!featureFlags.push) throw new FeatureDisabledError('push.enabled = false');
  // ...subscription code here, never reached in phase (b)
}
```

Rationale: phase (b) is already loaded with data layer + state migration + compose + caching + telemetry + moderation. Push notifications add Worker infrastructure (Durable Objects, VAPID key management, subscription lifecycle, firehose integration) that doesn't fit. Shipping the client shell behind a flag means: code paths exist, types compile, no production push code runs, plan 0004 can flip the flag without a phase-(b) reopen.

**Push-shell hard rules** (apply when plan 0004 turns the flag on, restated here so the AFK agent doesn't bake them out):
- No push payload contains OAuth access/refresh/DPoP tokens.
- No notification-click deeplink URL contains an OAuth token.
- Subscription payloads to the push service include the active DID and the VAPID-derived subscription only; nothing else.

**Offline = read-only.** TanStack Query's `persistQueryClient` writes the cache to IndexedDB (via `@tanstack/query-async-storage-persister` + `idb-keyval`). On reload while offline: the persisted cache rehydrates and the user sees the last-known timeline/profile/post state immediately. Background refetches that fail due to network are silent — the UI continues showing cached data with an unobtrusive "offline" indicator.

Persistence policy:
- Persist: `keys.post(*)`, `keys.profileByDid(*)`, `keys.timeline(*)`, `keys.feed(*)`, `keys.thread(*)`, `keys.notifications(*)`, `keys.preferences(*)`. These are read-state.
- Do NOT persist: `keys.search(*)` (ephemeral), `keys.actorResolution(*)` (cheap to rebuild), mutation states, `keys.appVersion`, anything keyed without an active DID.
- Persisted entries are treated as `staleTime: 0` on rehydrate — they show immediately and refetch in the background once network returns.
- Cache size cap: 50 MB (idb-keyval doesn't enforce; we implement an LRU sweep in the persister wrapper).
- Account switch clears the persistence layer for the previous DID? **No** — keep per-DID partitions; rehydrate the new DID's partition. Logout (account removed) drops that DID's partition entirely.

Mutations offline:
- Engagement mutations: `useMutation`'s default network-fail behavior is to throw; the optimistic patch rolls back; the UI shows a toast "you're offline." No queueing.
- Compose offline: blocked at submit time; the draft persists in IndexedDB (see plan 0002) so the user doesn't lose work.

**Rejected alternatives:**
- **Read+write offline (queued mutations).** Conflict resolution, ordering, expired-draft handling — out of scope for the rebuild.
- **No persistence (pure online).** Real users hit flaky mobile networks constantly; the cost of `persistQueryClient` is low.
- **Service-worker-level API response caching.** Duplicates TanStack's cache; two sources of truth for fetched data (the same anti-pattern from ADR-0016).
- **Web push via OneSignal / FCM proxy.** External vendor for something we can ship as a Worker; user explicitly wants own service.
- **Suspense for data loading.** User dislikes the partial-hydration jank.
- **Ship push client + server in phase (b).** Overloads the rebuild; pushes plan 0004 work into a phase already saturated with data/state/compose/cache/telemetry/moderation work.

**Implications:**
- Persistence wrapper lives at `src/data/_internal/persist.ts`. Configured once in `<QueryClientProvider>` setup.
- The push service worker (`workers/push/`) is out of scope for the rebuild plan; tracked as plan 0004 (separate). Client-side push code lives behind `featureFlags.push` as a no-op throwing shell.
- TanStack devtools-in-dev only; off in prod (`enableProdTools: false`).
- Sentry catches SW registration failures; persistence failures (IDB quota, schema mismatch) bubble to Sentry too.

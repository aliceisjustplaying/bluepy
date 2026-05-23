# ADR-0021: Client shell — eager first paint, no progressive hydration, PWA + web push, read-only offline

**First load posture.** Render as far as possible at first paint. Inline critical CSS (Vite handles this via `vite-plugin-html` or equivalent). Preload the OAuth client bundle and the active-DID restoration path. Show the application chrome (shortcut bar, nav) immediately; per-route content slots render with `{isLoading}` states from TanStack Query (ADR-0007). No splash screen, no full-screen spinner.

**No progressive hydration.** No React Suspense for data fetching. No `React.lazy` on first-load-critical routes. TanStack Query hooks return `{data, isLoading, error}`; components render the loading state synchronously and swap content when data resolves. The user explicitly dislikes the "shimmer of partial-hydration jank" that Suspense produces — we avoid it everywhere.

Route-level code splitting is fine (per-page chunks loaded on navigation), but the initial route's chunk is in the entry bundle. `React.lazy` is allowed for genuinely heavy non-critical paths (emoji picker, GIF picker, video player) after first paint.

**PWA.** Workbox-based service worker, inherited from Phanpy and updated for the new data layer. The SW caches the app shell (HTML/CSS/JS/fonts) with `precacheAndRoute` and serves it `stale-while-revalidate`. ATProto API responses are NOT cached by the SW — that's TanStack Query's job (see offline section). Manifest at `public/manifest.json` with full icon set + name "Bluepy" + display: standalone.

**Web push.** Custom push service, not third-party. Lives as a separate Cloudflare Worker (`workers/push/`) with its own Durable Object for subscription storage keyed by DID. Client flow: user opts in → browser generates push subscription via VAPID public key → POST to push service `/subscribe` with subscription + active DID → push service stores. On notification event (delivered via separate ATProto-firehose-watching worker, out of scope for this ADR), push service sends to all subscriptions for that DID. Client SW receives push, displays notification, deeplinks to the relevant post.

**Offline = read-only.** TanStack Query's `persistQueryClient` writes the cache to IndexedDB (via `@tanstack/query-async-storage-persister` + `idb-keyval`). On reload while offline: the persisted cache rehydrates and the user sees the last-known timeline/profile/post state immediately. Background refetches that fail due to network are silent — the UI continues showing cached data with an unobtrusive "offline" indicator.

Persistence policy:
- Persist: `keys.post(*)`, `keys.profile(*)`, `keys.timeline(*)`, `keys.feed(*)`, `keys.thread(*)`, `keys.notifications(*)`, `keys.preferences(*)`. These are read-state.
- Do NOT persist: `keys.search(*)` (ephemeral), mutation states, `keys.appVersion`, anything keyed without an active DID.
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

**Implications:**
- Persistence wrapper lives at `src/data/_internal/persist.ts`. Configured once in `<QueryClientProvider>` setup.
- The push service worker (`workers/push/`) is out of scope for the rebuild plan; tracked as plan 0004 (separate). The client-side push subscription code IS in scope.
- TanStack devtools-in-dev only; off in prod (`enableProdTools: false`).
- Sentry catches SW registration failures; persistence failures (IDB quota, schema mismatch) bubble to Sentry too.

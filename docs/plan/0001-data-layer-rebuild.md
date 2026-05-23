# Plan 0001 — Phase (b): Data-Layer Rebuild

> **Audience**: an AFK coding agent. This document, `CONTEXT.md`, and ADRs 0001-0011 are the spec.
> **Strategy**: big-bang. Land in one branch. No incremental migration. No backwards-compatibility shims.

## Goal

Delete Bluepy's Mastodon-API-shaped adapter (`src/utils/atproto-adapter.ts` and everything that depends on its `v1`/`v2` namespaces, `AdaptedStatus`, `AdaptedAccount`, `AdaptedList`) and replace it with a thin Bluepy data layer built on top of `@atproto/api` + TanStack Query. The new layer surfaces ATProto operations as domain-verb functions + React hooks; types flowing through are `@atproto/api`'s generated lexicon types directly. Valtio (`src/utils/states.ts`) is removed; UI state moves to Zustand. The app's UI behaviour, routing, and visual surface stay identical.

## Out of scope for this plan

- **Compose flow specifics** — covered separately in plan 0002 (TBD). This plan defines the *seam* compose plugs into; the compose details are too rich to bundle here.
- **Component prop-signature cleanup** — Phase (c). This plan updates consumer call sites only to the extent required for them to compile against the new data layer (i.e. replacing `AdaptedStatus` field reads with `AppBskyFeedPost.Record`-shape field reads).
- **Library swap to atcute** — deferred per ADR-0002. Stay on `@atproto/api`.
- **Router migration to TanStack Router** — out of scope.
- **Suspense / SSR / TanStack Start** — explicitly not now.

## Decisions referenced

| Topic | ADR |
| --- | --- |
| At-URI canonical URL form | ADR-0001 |
| `@atproto/api` underneath (atcute deferred) | ADR-0002 |
| Domain verbs + hooks + lexicon types | ADR-0003 |
| Three-client dispatch (`pdsAgent`/`appviewAgent`/`bskyAppviewAgent`) | ADR-0004 |
| Mutations + selective optimistic updates | ADR-0005 |
| Zustand for UI state, Valtio removed | ADR-0006 |
| Hook-level `isLoading`/`error` (no Suspense) | ADR-0007 |
| Paginated hooks return flat shape | ADR-0008 |
| Cache keys via factory; account-scoped | ADR-0009 |
| Session lifecycle | ADR-0010 |
| Facet-text rendering layout | ADR-0011 |

## Deletions

These are removed in this phase. The agent does not migrate or shim them — they go away.

- `src/utils/atproto-adapter.ts` (~3,884 LOC) — entire file.
- `src/utils/api.ts` — atproto client init + account hydration. Replaced by `src/data/clients.ts` + `<SessionProvider>`.
- `src/utils/states.ts` (~587 LOC) — Valtio global UI state. Replaced by Zustand stores under `src/state/`.
- `src/utils/store.ts` ↔ `src/utils/store-utils.ts` — the acknowledged structural cycle. Replaced by `src/state/sessions.ts` (Zustand + persist) for the parts that belong to UI state, and `@atproto/oauth-client-browser` for OAuth (it already owns it; we stop duplicating).
- `src/utils/auth-context.tsx` — replaced by `src/contexts/SessionProvider.tsx`.
- All exports named `AdaptedStatus`, `AdaptedAccount`, `AdaptedList`, `AdaptedNotification`, `AtprotoPost`, `AtprotoActor`, `AtprotoStrongRef`, `AtprotoReplyRefLike`, `AtprotoEmbedExternal`, etc. — the loose `Partial<>` wrappers introduced to bridge the Mastodon shape. Consumers move to `@atproto/api`'s lexicon types.
- The `v1`/`v2` namespace surface and any `api.v1.statuses.*` / `api.v2.accounts.*` call site.

The Phanpy-era `phanpy.tsx` and component shells stay. The names that travel with them inside JSX (e.g. props called `status`) are renamed to `post` in Phase (c), not here — Phase (b) keeps the inside of components compiling, not pretty.

## New file structure

```
src/
  data/
    clients.ts            # Constructs pdsAgent / appviewAgent / bskyAppviewAgent for a session.
    query-client.ts       # TanStack QueryClient + default options (placeholderData: keepPreviousData, retry, gc).
    keys.ts               # Cache-key factory (ADR-0009).
    _internal/
      use-infinite.ts     # Shared helper that wraps useInfiniteQuery into the flat shape (ADR-0008).
    posts.ts              # Post reads + writes + engagement.
    profiles.ts           # Profile reads + edit + follow/mute/block.
    feeds.ts              # Timeline, generator feeds, custom feeds.
    notifications.ts      # Notifications list + mark-read.
    lists.ts              # User lists + list-member management.
    feed-generators.ts    # Discover / save / unsave feed generators.
    search.ts             # Search posts + actors + hashtags.
    bookmarks.ts          # Bookmark add/remove/list.
    errors.ts             # NotAuthenticatedError, AppViewNotSupportedError, others.
  state/
    sessions.ts           # Zustand: activeDid, knownDids, perAccountPrefs (incl. activeAppView).
    compose.ts            # Zustand: compose draft (text, attachments, reply ref, quote ref, language).
    ui.ts                 # Zustand: modal stack, nav scroll, transient toggles, filter selections.
  contexts/
    SessionProvider.tsx   # Reads active session from OAuth client + active-AppView from Zustand,
                          # constructs the three clients, exposes via context.
  render/
    post-text.ts          # Pure function: renderPostText(text, facets) → string. Mentions, links, hashtags.
  utils/
    sanitize-html.ts      # Stays. DOMPurify wrappers (sanitizePostHtml, sanitizeEmbedHtml).
```

## Phase 0 — Scaffolding (do this first, before any per-module work)

The architecture assumes TanStack Query and Zustand. The current `package.json` ships `@atproto/api`, `@atproto/oauth-client-browser`, `idb-keyval`, `masto`, and `valtio`. The new foundational libraries are not present yet. Before any module port, the agent installs and configures them.

**Dependencies:**

```bash
bun add @tanstack/react-query
bun add -d @tanstack/react-query-devtools
bun add zustand
# masto + valtio stay installed until their last import is removed in the deletion pass.
# @atproto/api + @atproto/oauth-client-browser stay.
```

**Playwright config update** (`playwright.config.js` or `.ts`):

- ADR-0019 requires the new suite at `tests/e2e/*.spec.ts`. The current config matches `**/*.spec.js` only — TypeScript specs would never be discovered. Change `testMatch` to include `tests/e2e/**/*.spec.ts` and (during the rebuild) keep the old `tests/atproto-*.spec.js` glob so the existing flow-reference suite can still be run on the `bluesky` branch.
- ADR-0019 says "every flake is a bug, not something to retry." Disable retries for the rebuild suite. If the current config sets `retries: process.env.CI ? 2 : 0`, replace with `retries: 0` for the new `tests/e2e/*.spec.ts` project. Old JS specs may keep their retries until they are removed.

**Provider wiring** (before any consumer migration):

```tsx
// src/main.tsx (or wherever the React root mounts)
const queryClient = createQueryClient();      // src/data/query-client.ts (ADR-0007/0009)

<QueryClientProvider client={queryClient}>
  <SessionProvider>                            // src/contexts/SessionProvider.tsx
    <Router>
      <App />
    </Router>
  </SessionProvider>
</QueryClientProvider>
```

`createQueryClient()` and `<SessionProvider>` are themselves implemented as part of Phase 0; without them, no later data-layer module can run. After this scaffolding lands and typechecks, the agent moves on to the per-module specs below.

**No deletion in Phase 0.** The old adapter, Valtio, store-utils, and Masto-shaped APIs stay live during Phase 0. Phase 0 only **adds** the new substrate. Deletion happens module-by-module as each consumer is ported (and ultimately in the final deletion pass listed below).

## Milestones (the agent commits between each)

Big-bang branch, structured cadence. The agent runs M1 → M11 sequentially. Each milestone ends with a commit `phase-b/M{N}-<short-name>` so you can spot-check or interrupt at any boundary. A single PR opens at the end.

| # | Milestone | Done when |
| --- | --- | --- |
| **M1** | Phase 0 scaffolding | `@tanstack/react-query` + `zustand` installed; `playwright.config` matches `tests/e2e/**/*.spec.ts` with `retries: 0`; `<QueryClientProvider>` + `<SessionProvider>` mounted in `src/main.tsx`; `bun run typecheck` clean. **No** module port yet. |
| **M2** | Pure internals + unit gate | `src/data/keys.ts`, `src/data/_internal/prime.ts` (`primePosts`, `primeProfiles`), `src/data/_internal/patchers.ts` (optimistic patchers), `src/data/_internal/reconcile-shortcuts.ts`, `src/render/post-text.ts`, `src/render/moderation-decision.ts` written. **`bun run test:unit` green for every one** before M3 can start. This is a hard gate (ADR-0019 + grill round 3). |
| **M3** | Session/client layer | `src/data/clients.ts` with `ClientBundle`, `getReadAgent(mode)`, `getWriteAgent()`, `getPdsAgentFor(did)` per ADR-0004; `<SessionProvider>` wired to `@atproto/oauth-client-browser` `restore(did)`; account-switch swaps the active scope; `useViewerScope()` exposes `[viewerDid, appviewDid, labelersHash]`. |
| **M4** | Read-only data hooks | `posts.ts`, `profiles.ts`, `feeds.ts`, `search.ts`, `notifications.ts`, `lists.ts`, `feed-generators.ts`, `bookmarks.ts` read hooks + imperative fns. Primers fire on every list path. Direct-route hooks (`usePostRoute`, `useProfileRoute`, `useThread`) refetch on mount per ADR-0016. |
| **M5** | Preferences + shortcuts + moderation context | `usePreferences()` + per-pref-type mutation hooks (preserve-unknown rule tested); `useShortcutBar()` with pure reconcile + `useEffect` writeback; `useModerationContext()` per ADR-0022. |
| **M6** | UI state migration | `src/state/modals.ts`, `reveals.ts`, `ui-preferences.ts`, `shortcuts.ts` Zustand slices replace the Valtio decomposition. Old `src/utils/states.ts` references are removed from the data and state layers (consumer references still exist; M7 cleans them up). |
| **M7** | Component migration | Every component reads from the new hooks. `AdaptedStatus`/`AdaptedAccount`/`AdaptedList` import sites converted. Every post-render and profile-render goes through `usePostModeration` / `useProfileModeration`. `bun run dev` + browser walkthrough works end-to-end. |
| **M8** | Mutations | Engagement mutations (like/unlike/repost/unrepost/follow/unfollow/mute/unmute/block/unblock/bookmark/unbookmark) optimistic per ADR-0005; broad invalidation for createPost/deletePost. |
| **M9** | Compose (plan 0002 in full) | Multi-account, intent-keyed multi-draft compose lands. Video upload uses the two-token flow (ADR-0022 / plan 0002). DraftKey canonical serializer + attachment ref-counting unit-tested. |
| **M10** | Telemetry + Sentry + read-only offline | Plausible script tag in prod build; Sentry init with `beforeSend` PII scrubber (DIDs, handles, tokens, CIDs); `persistQueryClient` wired to IndexedDB with per-DID partition + 50MB LRU per ADR-0021. PWA manifest + Workbox service worker land here. Push (workers/push/) stays out — plan 0004. |
| **M11** | Deletion pass | `src/utils/atproto-adapter.ts`, `states.ts`, `store.ts`, `store-utils.ts`, `api.ts`, `auth-context.tsx` deleted. `masto` + `valtio` removed from `package.json`. Old `tests/atproto-*.spec.js` deleted. `bun run typecheck && bun run test && bun run build` green. |

**Testing tier — one live e2e suite, no mocked tier.** ADR-0019 requires fresh `tests/e2e/*.spec.ts` walking the real flow against `ATPROTO_TEST_*` credentials. The rebuild does NOT introduce a `msw`-mocked tier. Determinism comes from a dedicated test account with isolated test-feed/test-list rkeys, not from intercepting network. Unit tests (M2) handle the pure-function correctness layer; live e2e handles features.

**If a milestone fails:** the agent stops, surfaces the failure with file:line refs, and waits for human intervention. No skipping ahead.

## Per-module specs

### `src/data/clients.ts`

Exports a factory called by `<SessionProvider>`:

```ts
import { AtpAgent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';

export interface ClientBundle {
  pdsAgent: AtpAgent | null;       // null when logged out
  appviewAgent: AtpAgent;          // pinned to active AppView (per-account pref)
  bskyAppviewAgent: AtpAgent;      // pinned to public.api.bsky.app
}

export function createClients(opts: {
  session: OAuthSession | null;
  activeAppViewService: string;    // e.g. 'https://public.api.bsky.app' or Blacksky's URL
}): ClientBundle;
```

Constructor rules:
- `pdsAgent` is built from the OAuth session via `agent.sessionManager = …` (or whichever wiring `@atproto/api` uses with `@atproto/oauth-client-browser`'s `OAuthSession`). `null` if `session === null`.
- `appviewAgent` is a fresh `AtpAgent` pointed at `activeAppViewService`, unauthenticated by default. Authenticated calls go through `pdsAgent` with `configureProxy(...)` set to the active AppView's DID.
- `bskyAppviewAgent` is a fresh `AtpAgent` pointed at `https://public.api.bsky.app`, unauthenticated.

The dispatch rule for every function in `src/data/*.ts`:

- **Writes / identity-bound reads** → `pdsAgent`. Throw `NotAuthenticatedError` if `pdsAgent === null`.
- **`app.bsky.unspecced.*`, trending, discover-feeds, anything documented as not-portable** → `bskyAppviewAgent`. (Documented via comments at the function site.)
- **Everything else under `app.bsky.*`** → `appviewAgent`.

### `src/data/query-client.ts`

```ts
import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        placeholderData: (prev: unknown) => prev,   // keepPreviousData (ADR-0007)
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
```

There is one `QueryClient` for the whole app (not per-account). Account isolation is via cache-key prefixing (ADR-0009).

### `src/data/keys.ts`

Exactly as ADR-0009. No additions during this phase; keys are added as new endpoints are introduced.

### `src/data/_internal/use-infinite.ts`

Generic helper that wraps `useInfiniteQuery` into the ADR-0008 flat shape:

```ts
export function useInfiniteList<TPage, TItem>(opts: {
  queryKey: readonly unknown[];
  queryFn: (ctx: { pageParam?: string }) => Promise<TPage>;
  getCursor: (page: TPage) => string | undefined;
  flatten: (page: TPage) => TItem[];
}): {
  items: TItem[];
  loadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoading: boolean;
  error: Error | null;
}
```

Every paginated hook in `src/data/*.ts` is a thin wrapper around this.

### `src/data/posts.ts`

Function and hook exports (lexicon types throughout):

```ts
// Reads
export function getPost(did: string, uri: AtUri): Promise<AppBskyFeedDefs.PostView>;
export function getPostThread(did: string, uri: AtUri, depth?: number): Promise<AppBskyFeedDefs.ThreadViewPost>;

export function usePost(uri: AtUri): { data?: AppBskyFeedDefs.PostView; isLoading; error };
export function useThread(uri: AtUri, depth?: number): { data?: AppBskyFeedDefs.ThreadViewPost; isLoading; error };

// Writes (mutations) — ADR-0005
export function useCreatePost(): UseMutationResult<...>;       // wait-and-invalidate; broad invalidation
export function useDeletePost(): UseMutationResult<...>;       // wait-and-invalidate; broad invalidation
export function useLikePost(): UseMutationResult<...>;         // OPTIMISTIC
export function useUnlikePost(): UseMutationResult<...>;       // OPTIMISTIC
export function useRepostPost(): UseMutationResult<...>;       // OPTIMISTIC
export function useUnrepostPost(): UseMutationResult<...>;     // OPTIMISTIC
export function useBookmarkPost(): UseMutationResult<...>;     // OPTIMISTIC
export function useUnbookmarkPost(): UseMutationResult<...>;   // OPTIMISTIC
```

### `src/data/profiles.ts`

```ts
export function getProfile(did: string, actor: string): Promise<AppBskyActorDefs.ProfileViewDetailed>;
export function useProfile(actor: string): { data; isLoading; error };

export function useEditProfile(): UseMutationResult<...>;       // wait-and-invalidate
export function useFollowAccount(): UseMutationResult<...>;     // OPTIMISTIC
export function useUnfollowAccount(): UseMutationResult<...>;   // OPTIMISTIC
export function useMuteAccount(): UseMutationResult<...>;       // OPTIMISTIC
export function useUnmuteAccount(): UseMutationResult<...>;     // OPTIMISTIC
export function useBlockAccount(): UseMutationResult<...>;      // OPTIMISTIC
export function useUnblockAccount(): UseMutationResult<...>;    // OPTIMISTIC
```

### `src/data/feeds.ts`

```ts
export function useTimelineFeed(): { items: PostView[]; loadMore; hasMore; isLoadingMore; isLoading; error };
export function useProfileFeed(actor: string, filter?: 'posts' | 'posts-and-replies' | 'media'): {...};
export function useGeneratorFeed(generator: AtUri): {...};
export function useTrendingTopics(): {...};  // uses bskyAppviewAgent
```

### `src/data/notifications.ts`, `lists.ts`, `feed-generators.ts`, `search.ts`, `bookmarks.ts`

Each follows the same pattern: imperative functions + read hooks via `useInfiniteList` or `useQuery` + mutation hooks for the writes that belong to that domain. Each file is its own complete spec — the agent looks at the lexicon for the relevant `app.bsky.<domain>.*` endpoints and ports them under the convention.

### `src/data/errors.ts`

```ts
export class NotAuthenticatedError extends Error { … }
export class AppViewNotSupportedError extends Error { … }  // raised when bskyAppviewAgent also fails
```

These are throwable inside `queryFn` / `mutationFn`. TanStack Query surfaces them via `error`.

### `src/state/sessions.ts`

```ts
interface SessionsState {
  activeDid: string | null;
  knownDids: string[];
  perAccountPrefs: Record<string, { activeAppView: { service: string; proxyDid: string } }>;
  // actions
  setActive(did: string): void;
  addKnown(did: string, prefs: SessionsState['perAccountPrefs'][string]): void;
  removeKnown(did: string): void;
  setActiveAppView(did: string, cfg: { service: string; proxyDid: string }): void;
}
```

Uses Zustand's `persist` middleware against `localStorage`. The persisted shape is exactly the four fields above. On boot, each `knownDids` entry is reconciled with `@atproto/oauth-client-browser` via `oauthClient.restore(did)`; failed restores are removed.

### `src/state/compose.ts`

Holds the active compose draft. Schema:

```ts
interface ComposeState {
  text: string;
  attachments: ComposeAttachment[];  // images, video, animations — see plan 0002
  replyTo?: AtprotoStrongRef;        // the parent post being replied to
  quote?: AtprotoStrongRef;
  language?: string;
  contentWarning?: string;
  // actions
  setText(text: string): void;
  addAttachment(att: ComposeAttachment): void;
  removeAttachment(id: string): void;
  setReply(ref?: AtprotoStrongRef): void;
  setQuote(ref?: AtprotoStrongRef): void;
  reset(): void;
}
```

Detailed compose mechanics (facet detection, blob upload, embed building) live in plan 0002.

### `src/state/ui.ts`

Holds modal stack, transient toggles, scroll/nav state. Schema TBD per concrete UI inventory; the agent inventories what `src/utils/states.ts` exposes today and maps each export into the appropriate Zustand slice.

### `src/contexts/SessionProvider.tsx`

```tsx
export function SessionProvider({ children }: { children: ReactNode }) {
  const activeDid = useSessionsStore(s => s.activeDid);
  const activeAppViewCfg = useSessionsStore(s =>
    activeDid ? s.perAccountPrefs[activeDid]?.activeAppView : null
  );
  const session = useOAuthSession(activeDid);  // hook that reads from @atproto/oauth-client-browser

  const clients = useMemo(
    () => createClients({ session, activeAppViewService: activeAppViewCfg?.service ?? BSKY_APPVIEW_URL }),
    [session, activeAppViewCfg?.service],
  );

  return <ClientsContext.Provider value={clients}>{children}</ClientsContext.Provider>;
}

export function useClients(): ClientBundle { … }
export function useActiveDid(): string | null { … }
```

### `src/render/post-text.ts`

```ts
export function renderPostText(text: string, facets?: AppBskyRichtextFacet.Main[]): string;
```

Pure; no React; no DOM. Iterates facets in byte-offset order, escapes interpolated text, wraps mention/link/hashtag segments with the appropriate `<a>`. Mentions link to the at-URI permalink form (ADR-0001).

## Provider tree

```tsx
<QueryClientProvider client={queryClient}>
  <SessionProvider>
    <Router>
      <App />
    </Router>
  </SessionProvider>
</QueryClientProvider>
```

`<App />` and below consume hooks from `src/data/*.ts`, which read `useClients()` + `useActiveDid()` internally. Components don't manipulate clients directly.

## Consumer migration

For each of the 60+ existing call sites that use `api.v1.*` / `api.v2.*` / `AdaptedStatus` / Valtio `useSnapshot`:

- Replace `api.v1.statuses.fetch(id)` → `usePost(uri)` and read `data?.record.text` (not `data?.content`).
- Replace `api.v1.accounts.fetch(id)` → `useProfile(actor)` and read `data?.displayName` (not `data?.acct`).
- Replace Valtio `useSnapshot(states.modals.something)` → `useUIStore(s => s.modals.something)`.
- Replace `useSnapshot(states.composeDraft)` → `useComposeStore(s => s.text)` (etc.).

A find/replace lookup table is appended at the end of this plan and grown as the agent encounters new patterns.

## Acceptance criteria

Phase (b) is "done" when **all** of these are true:

1. `src/utils/atproto-adapter.ts` does not exist.
2. `src/utils/states.ts`, `store.ts`, `store-utils.ts`, `api.ts`, `auth-context.tsx` do not exist.
3. No file imports the symbols `AdaptedStatus`, `AdaptedAccount`, `AdaptedList`, `AdaptedNotification`.
4. `bun run typecheck` passes with zero errors. **No `as any` anywhere in code created or modified by this phase** — strictly enforced. New files under `src/data/`, `src/state/`, `src/contexts/`, `src/render/` must be entirely `as any`-free; consumer files updated as part of the port must have any pre-existing `as any` casts that touch the data-layer seam either removed or replaced with a typed assertion (e.g. a discriminated-union narrowing, a lexicon-type guard). Pre-existing `as any` casts in files untouched by this phase are not in scope.
5. `bunx oxlint .` passes; `bunx oxfmt --check .` passes.
6. `bun run test` passes the existing suite. Behavioural tests for timeline, status page, compose smoke, notifications, mute/block round-trip, like/repost optimistic round-trip, log-out-while-feed-cached are added in `tests/data-layer/`.
7. `bun run build` succeeds. (Bundle-size delta is *not* a phase-(b) gate — revisit after the rebuild lands.)
8. Logged-in walk-through against `bun run dev` (HTTPS-exposed): timeline loads, status page loads via at-URI permalink, compose post lands, like/unlike toggles optimistically, notifications list and mark-read, log-out + log-in works, account-switch swaps feeds without leaking the other account's cache.

## Things to confirm before the agent runs

These are the questions still open. Filled in by additional grilling passes:

- [ ] Compose flow details — plan 0002 (next grilling pass).
- [ ] Specific list of operations that need `bskyAppviewAgent` (ADR-0004 says it's empirical; populate it as the agent encounters Blacksky/active-AppView gaps).
- [ ] Service-auth handling for video upload (`video.bsky.app` audience).
- [ ] Inventory of `src/utils/states.ts` exports → Zustand slice mapping.

## Find/replace lookup (grows during port)

| Old | New |
| --- | --- |
| `api.v1.statuses.fetch(id)` | `usePost(uri)` |
| `api.v1.accounts.fetch(id)` | `useProfile(actor)` |
| `api.v1.timelines.home.list()` | `useTimelineFeed()` |
| `api.v1.notifications.list()` | `useNotifications()` |
| `useSnapshot(states.composeDraft)` | `useComposeStore(s => …)` |
| `AdaptedStatus` (field reads) | `AppBskyFeedDefs.PostView` (see lexicon for field names) |
| `AdaptedAccount` (field reads) | `AppBskyActorDefs.ProfileViewDetailed` |
| ... | ... |

(Grows as more patterns are encountered.)

---

## Addenda — grilling round 2 (supersedes earlier sections where they conflict)

The original plan referenced ADRs 0001-0011. A second grilling pass added ADRs 0012-0021. This section folds the deltas in.

### Decisions referenced (full)

| Topic | ADR |
| --- | --- |
| At-URI canonical URL form | ADR-0001 |
| `@atproto/api` underneath (atcute deferred) | ADR-0002 |
| Domain verbs + hooks + lexicon types | ADR-0003 |
| Three-client dispatch | ADR-0004 |
| Mutations + selective optimistic | ADR-0005 |
| Zustand for UI state, Valtio removed | ADR-0006 |
| Hook-level `isLoading`/`error` (no Suspense) | ADR-0007 |
| Paginated hooks return flat shape | ADR-0008 |
| Cache keys via factory; account-scoped | ADR-0009 |
| Session lifecycle | ADR-0010 |
| Facet-text rendering layout | ADR-0011 |
| Intent-keyed multi-draft compose | ADR-0012 |
| Upload-on-submit (no deleteBlob) | ADR-0013 |
| All-or-nothing submit + aux records warn-on-fail | ADR-0014 |
| Compose author picker (multi-account) | ADR-0015 |
| **Per-URI canonical post/profile cache + URI-array list queries** | ADR-0016 |
| **Preferences split: server (putPreferences) + device-local** | ADR-0017 |
| **Shortcut bar hybrid (savedFeedsPrefV2 pinned + local Phanpy types)** | ADR-0018 |
| **Testing strategy: fresh e2e + fixture-driven unit core** | ADR-0019 |
| **Telemetry (Plausible self-hosted) + Sentry error tracking** | ADR-0020 |
| **Client shell, PWA, web push, read-only offline** | ADR-0021 |
| **Moderation/labels subsystem (display decisions)** | ADR-0022 |

### Additional files (extend the "New file structure" section)

```
src/
  data/
    preferences.ts        # ADR-0017. usePreferences() (TanStack against app.bsky.actor.getPreferences) + per-pref-type mutation hooks.
    shortcuts.ts          # ADR-0018. useShortcutBar() composes local Zustand order with pinned savedFeedsPrefV2 entries.
    _internal/
      prime.ts            # primePosts(qc, response), primeProfiles(qc, response). ADR-0016. Exhaustively tested per ADR-0019.
      reconcile-shortcuts.ts  # pure reconciliation function for ADR-0018.
      persist.ts          # persistQueryClient wrapper, per-DID partition, LRU sweep, ADR-0021.
  state/
    ui-preferences.ts     # Zustand persist for Phanpy UI fields (ADR-0017): autoRefresh, cloakMode, noAnimations, etc.
    shortcuts.ts          # Zustand: localOrder ShortcutEntry[] (ADR-0018).
    modals.ts             # Zustand: every show* flag as one typed slice; replaces the 17 Valtio modal flags + index-signature squatters.
    reveals.ts            # Zustand: spoilers, spoilersMedia, revealedQuotes, revealedMutedPosts (ADR-0006).
  contexts/
    ServiceWorkerBridge.tsx  # Owns navigator.serviceWorker 'message' subscription, exposes {lastRoute, clear()}. Replaces routeNotification Valtio slice.
  utils/
    telemetry.ts          # trackPage(path), trackEvent(name, props?); Plausible script in <head>. ADR-0020.
    sentry.ts             # Sentry init w/ scrubbing beforeSend. PII never leaves the client. ADR-0020.
tests/
  e2e/*.spec.ts           # Fresh Playwright suite (ADR-0019). Existing tests/atproto-*.spec.js kept on bluesky branch as flow reference only — none ported.
  unit/                   # primers, keys, patchers, reconcile, post-text (ADR-0019).
  fixtures/atproto/       # Real ATProto API response captures.
workers/
  push/                   # Own web push service (Cloudflare Worker + DO). ADR-0021. Tracked in plan 0004 (separate).
```

### State inventory dispositions (closes the "Inventory of states.ts exports → Zustand slice mapping" open item)

The full Valtio `proxy<StateProxy>` at `src/utils/states.ts:150` decomposes as follows:

| Valtio field | Destination |
| --- | --- |
| `statuses`, `accounts`, `statusQuotes`, `statusReply`, `statusThreadNumber` | TanStack canonical caches (ADR-0016). Quotes/reply/threadNumber are derived at render time, no separate storage. |
| `notifications`, `notificationsLast`, `notificationsLastFetchTime`, `notificationsShowNew` | TanStack: `useNotifications`, `useUnreadCount` against `app.bsky.notification.getUnreadCount`; `useUpdateSeen` against `updateSeen`. No client-side seen marker. |
| `appVersion` | `useQuery(['appVersion'])`, `staleTime: 1h`. |
| `routeNotification` | `<ServiceWorkerBridge>` React Context. |
| `prevLocation`, `currentLocation` | React Router `useLocation()` + `location.state.from`. `currentLocation` was write-only dead code — deleted. |
| `reloadStatusPage`, `reloadGenericAccounts` | Replaced by `qc.invalidateQueries(...)` at the call sites. Counter fields deleted. |
| `showCompose`, `showSettings`, `showAccount`, `showAccounts`, `showDrafts`, `showMediaModal`, `showShortcutsSettings`, `showKeyboardShortcutsHelp`, `showGenericAccounts`, `showMediaAlt`, `showEmbedModal`, `showFeedbackModal`, `showReportModal`, `showQrCodeModal`, `showQrScannerModal`, `showImportExportAccounts`, `showSearchCommand`, `showOpenLink` | `src/state/modals.ts` Zustand slice as a typed discriminated union; no index-signature squatting. |
| `composerState` | `src/state/compose.ts` (plan 0002). |
| `spoilers`, `spoilersMedia`, `revealedQuotes`, `revealedMutedPosts` | `src/state/reveals.ts`. |
| `shortcuts` (Phanpy bar config) | `src/state/shortcuts.ts` + `src/data/shortcuts.ts` per ADR-0018. |
| `settings` (13 fields) | `src/state/ui-preferences.ts` device-local Zustand `persist` per ADR-0017. |
| `home`, `homeNew`, `homeLast`, `homeLastFetchTime`, `notificationsNew`, `scrollPositions` (proxy slice) | Dead code — deleted, not carried. |

Module-level singletons outside the proxy (`api.ts` clients, `store-utils.ts` mems, `pmem` caches across `src/utils/*` and components, OAuth singletons, profile fallbacks, labeler cache, `window.__*` globals, BENCH_RESULTS): all replaced by their corresponding `src/data/*.ts` `useQuery` hooks. `window.__*` globals deleted (dev-only telemetry can stay behind `import.meta.env.DEV`).

### Acceptance criteria (supersedes section 326-336 where conflicting)

The agent treats ADR-0019 as the authoritative "done" bar. The criteria there are exhaustive. Specifically:

1. `src/utils/atproto-adapter.ts`, `states.ts`, `store.ts`, `store-utils.ts`, `api.ts`, `auth-context.tsx` do not exist.
2. No file imports `AdaptedStatus`, `AdaptedAccount`, `AdaptedList`, `AdaptedNotification`, any `Atproto*` Phanpy alias.
3. `bun run typecheck` passes. **Zero `as any` in code created/modified by this phase** (ADR-0019).
4. `bunx oxlint .` passes; `bunx oxfmt --check .` passes.
5. `bun run test` passes the **new** Playwright suite at `tests/e2e/*.spec.ts` (ADR-0019). The existing `tests/atproto-*.spec.js` files are kept as reference but are not part of the gate — the agent removes them at the end of the rebuild.
6. `bun run test:unit` passes the new unit suite (`tests/unit/*.test.ts`) — primers, keys, patchers, reconcile, post-text. Fixture-driven, no snapshots, no input fabrication.
7. `bun run build` succeeds.
8. Sentry DSN injection works in prod build; Plausible script tag present in prod build; both no-ops in dev.
9. Read-only offline persistence (ADR-0021): `persistQueryClient` initialised against IndexedDB with per-DID partitioning + 50MB LRU; persisted query keys cover post/profile/timeline/feed/thread/notifications/preferences; search and mutations are NOT persisted. PWA manifest + Workbox service worker present. Logged-in browser walkthrough offline (after one-time cache fill) renders cached timeline + post permalinks without network.
10. The 11 milestone commits are present on the branch in order (`phase-b/M1-*` … `phase-b/M11-*`).

### Round-3 must-fix deltas (review pass, supersedes earlier sections)

Folded in from the architecture-critique review pass:

- **4-category dispatch.** ADR-0004 rewritten: `public-active-appview` / `authenticated-active-appview-via-pds` / `public-bluesky-appview` / `pds-direct`. Default for a logged-in user is the PDS-proxied path, not the public AppView — viewer/moderation/label state must round-trip through the PDS so it carries account-sensitive context.
- **Viewer-scope cache keys.** ADR-0009 + ADR-0016 rewritten: every key starts with `(viewerDid, appviewDid, labelersHash)`, not just `viewerDid`. Switching Active AppView or labelers naturally partitions the cache.
- **Direct-route refetch.** ADR-0016: per-URI canonical entries keep `staleTime: Infinity` for list-driven priming, but direct-route hooks (`usePostRoute`, `useThread`, `useProfileRoute`) use `refetchOnMount: 'always'` with a finite 60s `staleTime`. Permalink opens revalidate.
- **Embed-variant primer spec.** ADR-0016: primer enumerates `viewRecord` / `viewNotFound` / `viewBlocked` / `viewDetached` / non-post-record variants / unknown `$type`. Fixture corpus must cover all rows.
- **Preserve-unknown preference writes.** ADR-0017: `putPreferences` writes must round-trip every entry whose `$type` the hook does not own. Unit test at `tests/unit/preferences/preserve-unknown.test.ts` is part of the done-bar.
- **Pure shortcut reconciliation + `useEffect` writeback.** ADR-0018: `reconcileShortcutBar` is pure and returns `{ items, nextOrder, changed }`; the hook persists via `useEffect`, never inside `useMemo`.
- **Moderation/labels layer.** ADR-0022 added: `src/data/moderation.ts` + `src/render/moderation-decision.ts`. Mandatory in phase (b), not deferred. Every post/profile render path goes through it.
- **Video upload audience.** Plan 0002 updated: two separate service-auth tokens. `getUploadLimits` uses `aud: did:web:video.bsky.app`; `uploadBlob` uses `aud: did:web:<author-PDS-hostname>` (verified against `~/src/a/social-app/src/lib/media/video/upload.shared.ts`).

### Remaining open items (was section "Things to confirm before the agent runs")

- ~~Compose flow details~~ — plan 0002 done.
- ~~Inventory of states.ts exports~~ — resolved above.
- Specific list of operations that need `bskyAppviewAgent` (ADR-0004 says empirical; the agent populates this list as it encounters them).
- Service-auth handling for video upload (`video.bsky.app` audience) — traced from `~/social-app`'s `useVideoUploadStatus` and `app.bsky.video.*` lexicon; covered briefly in plan 0002, agent verifies during rebuild.
- Threadgate/postgate lexicon stability — defer until needed (per user).
- Web push service worker code (`workers/push/`) — tracked separately, not in this plan.

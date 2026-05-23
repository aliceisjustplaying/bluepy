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

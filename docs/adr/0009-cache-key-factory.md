# ADR-0009: Cache keys come from a single factory in `src/data/keys.ts`

Every TanStack Query `queryKey` and every `invalidateQueries` call in Bluepy reads its key from `src/data/keys.ts`. No inline string keys.

**Two scope tuples.** Not every cache key needs the full viewer scope. Preferences are private account state and have no AppView/labeler dependency; AppView-rendered reads (posts, profiles, feeds, threads, search, notifications) carry viewer state that varies by AppView and labeler subscription.

```ts
type AccountScope = readonly [
  viewerDid: string,                   // active account DID; not 'public' (preferences require auth)
];

type ViewerScope = readonly [
  viewerDid: string | 'public',        // active account DID, or 'public' for logged-out
  appviewKey: string,                  // `${appviewDid}|${origin}` — DID + origin together (see below)
  labelersHash: string,                // stable hash of the sorted accepted-labeler DID set (baseline ∪ subscribed, per ADR-0004/ADR-0022)
];

export const keys = {
  // AccountScope keys — private account state, independent of AppView/labeler
  preferences:    (a: AccountScope) => [...a, 'preferences'] as const,
  uiPreferences:  (a: AccountScope) => [...a, 'uiPreferences'] as const,

  // ViewerScope keys — AppView-rendered views, vary by AppView + labeler set
  // Canonical per-URI entries (ADR-0016) — hold full bodies within the viewer scope
  post:           (s: ViewerScope, uri: AtUri) => [...s, 'post', uri] as const,
  profileByDid:   (s: ViewerScope, did: string) => [...s, 'profileByDid', did] as const,

  // Handle → DID resolution (separate from profile body; prevents stale-handle duplication)
  actorResolution: (s: ViewerScope, handle: string) => [...s, 'actorResolution', handle] as const,

  // List keys — hold URI/DID arrays + list-local metadata, NOT bodies
  timeline:       (s: ViewerScope) => [...s, 'timeline'] as const,
  feed:           (s: ViewerScope, generator: AtUri, opts?: FeedOpts) => [...s, 'feed', generator, opts] as const,
  thread:         (s: ViewerScope, uri: AtUri) => [...s, 'thread', uri] as const,
  profileFeed:    (s: ViewerScope, did: string, filter?: FeedFilter) => [...s, 'profileFeed', did, filter] as const,
  notifications:  (s: ViewerScope, filter?: NotifFilter) => [...s, 'notifications', filter] as const,
  search:         (s: ViewerScope, query: string, type: 'posts'|'actors') => [...s, 'search', type, query] as const,
  bookmarks:      (s: ViewerScope) => [...s, 'bookmarks'] as const,
  follows:        (s: ViewerScope, subjectDid: string) => [...s, 'follows', subjectDid] as const,
  followers:      (s: ViewerScope, subjectDid: string) => [...s, 'followers', subjectDid] as const,
  // ...
};
```

Two helpers expose scopes; components do not call them directly — data-layer hooks do, and pass the result to the factory internally:

```ts
export function useAccountScope(): AccountScope | null;  // null when logged out
export function useViewerScope(): ViewerScope;
```

**Why preferences use `AccountScope`, not `ViewerScope`.** `labelersHash` is derived from `labelersPref`, and `labelersPref` lives in the preferences response. Scoping preferences by a tuple that depends on preferences would create boot-time circularity and produce duplicate preference caches every time the labeler set changes. Preferences are also private account state (the official `app.bsky.actor.getPreferences` is auth-required and per-account, not AppView-rendered), so `appviewKey` / `labelersHash` carry no signal for them. The same reasoning applies to `uiPreferences`.

**Why `appviewKey = ${did}|${origin}`, not just `appviewDid`.** A single AppView DID can in principle be served through multiple origins (dev preview deploys, alternate hostnames, regional endpoints). A plain DID-only scope can accidentally share cache between two endpoints that resolve the same DID but answer differently. Including the origin in the key makes preview/dev AppView testing cleanly partitioned without changing how account/labeler partitioning works.

**Canonical-within-viewer-scope.** `keys.post` and `keys.profileByDid` are the only keys that hold full bodies. Every other view key holds references (URIs / DIDs) plus list-local metadata; the body for each reference is read via `usePost`/`useProfileByDid` against the canonical key. "Canonical" means canonical *within the current viewer scope* — the same `at://…` URI under a different active AppView or a different labeler subscription set is a different cache entry, because the AppView's rendering of `PostView` (viewer state, label filtering, embed availability, count interpretation) is part of the response.

**Profiles are canonical by DID, not by handle.** Handles can be re-pointed; the same human's profile body should not duplicate under "alice.bsky.social" and "did:plc:alice" entries and should not stale when she rotates her handle. `keys.actorResolution(s, handle)` is a thin handle→DID cache that `useProfile(actor)` consults first; once resolved, the body lives at `keys.profileByDid(s, did)`. Mention/permalink rendering produces DID-based URIs (ADR-0011) so the resolution step is normally a one-time cache prime.

**Account/AppView/labeler switches.** Switching active DID changes both scope tuples; switching active AppView or labeler subscriptions changes only `ViewerScope`. Entries under the old scope remain in cache (good for quick switch-back) and are GCed by TanStack's default policy. No manual invalidation is required — the key partition delivers the right behaviour automatically.

Rejected alternatives: inline tuples (drift / typos between query and invalidate sites), per-domain factories (no single source of truth for the schema), DID-only prefix (silently shared cache across Active AppView and labeler changes; produces wrong-labeler or wrong-viewer-state renders after a swap), single `ViewerScope` for everything (creates the preference/labeler circularity above), keying profile bodies by handle (stale-handle duplication; profile body needlessly invalidates on handle change).

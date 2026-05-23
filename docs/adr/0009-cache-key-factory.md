# ADR-0009: Cache keys come from a single factory in `src/data/keys.ts`

Every TanStack Query `queryKey` and every `invalidateQueries` call in Bluepy reads its key from `src/data/keys.ts`. No inline string keys. Every key is prefixed with a **viewer scope** — `(viewerDid, appviewDid, labelersHash)` — so that an Active-AppView change or a labeler-subscription change naturally partitions the cache instead of relying on manual invalidation.

```ts
type ViewerScope = readonly [
  viewerDid: string | 'public',        // active account DID, or 'public' for logged-out
  appviewDid: string,                  // active AppView's DID (e.g. did:web:api.bsky.app)
  labelersHash: string,                // stable hash of the sorted subscribed-labeler DID list (from labelersPref)
];

export const keys = {
  // canonical per-URI entries (ADR-0016) — hold full post/profile bodies within the viewer scope
  post:           (s: ViewerScope, uri: AtUri) => [...s, 'post', uri] as const,
  profile:        (s: ViewerScope, didOrHandle: string) => [...s, 'profile', didOrHandle] as const,

  // list keys — hold URI arrays + list-local metadata (boost reason, reply tree, grouping), NOT post bodies
  timeline:       (s: ViewerScope) => [...s, 'timeline'] as const,
  feed:           (s: ViewerScope, generator: AtUri, opts?: FeedOpts) => [...s, 'feed', generator, opts] as const,
  thread:         (s: ViewerScope, uri: AtUri) => [...s, 'thread', uri] as const,
  profileFeed:    (s: ViewerScope, subject: string, filter?: FeedFilter) => [...s, 'profileFeed', subject, filter] as const,
  notifications:  (s: ViewerScope, filter?: NotifFilter) => [...s, 'notifications', filter] as const,
  search:         (s: ViewerScope, query: string, type: 'posts'|'actors') => [...s, 'search', type, query] as const,
  bookmarks:      (s: ViewerScope) => [...s, 'bookmarks'] as const,
  follows:        (s: ViewerScope, subject: string) => [...s, 'follows', subject] as const,
  followers:      (s: ViewerScope, subject: string) => [...s, 'followers', subject] as const,
  preferences:    (s: ViewerScope) => [...s, 'preferences'] as const,
  // ...
};
```

The scope is read from session context by a small helper `useViewerScope(): ViewerScope` that components do not call directly — data-layer hooks do, and pass the result to the factory internally.

**Canonical-within-viewer-scope.** `keys.post` and `keys.profile` are the only keys that hold full bodies. Every other key holds references (URIs / DIDs / handles) plus list-local metadata; the body for each reference is read separately via `usePost`/`useProfile` against the canonical key. "Canonical" means canonical *within the current viewer scope* — the same `at://…` URI under a different active AppView or a different labeler subscription set is a different cache entry, because the AppView's rendering of `PostView` (viewer state, label filtering, embed availability, count interpretation) is part of the response. Mutations therefore patch canonical keys only, never list keys, but they patch within the current scope.

**Account/AppView/labeler switches.** Switching active DID, active AppView, or labeler subscriptions changes the viewer scope tuple; entries under the old scope remain in cache (good for quick switch-back) and are GCed by TanStack's default policy. No manual invalidation is required for these switches — the key partition delivers the right behaviour automatically.

Rejected alternatives: inline tuples (drift / typos between query and invalidate sites), per-domain factories (no single source of truth for the schema), and DID-only prefix (the previous shape — silently shared cache across Active AppView changes, which produces wrong-labeler or wrong-viewer-state renders after a swap).

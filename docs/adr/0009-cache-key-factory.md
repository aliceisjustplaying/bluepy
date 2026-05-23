# ADR-0009: Cache keys come from a single factory in `src/data/keys.ts`

Every TanStack Query `queryKey` and every `invalidateQueries` call in Bluepy reads its key from `src/data/keys.ts`. No inline string keys. The factory exposes pure functions (DID passed explicitly by the caller):

```ts
export const keys = {
  post:           (did: string, uri: AtUri) => [did, 'post', uri] as const,
  thread:         (did: string, uri: AtUri) => [did, 'thread', uri] as const,
  profile:        (did: string, handle: string) => [did, 'profile', handle] as const,
  feed:           (did: string, generator: AtUri, opts?: FeedOpts) => [did, 'feed', generator, opts] as const,
  timeline:       (did: string) => [did, 'timeline'] as const,
  notifications:  (did: string, filter?: NotifFilter) => [did, 'notifications', filter] as const,
  search:         (did: string, query: string, type: 'posts'|'actors') => [did, 'search', type, query] as const,
  bookmarks:      (did: string) => [did, 'bookmarks'] as const,
  // ...
};
```

Cache keys are account-scoped — every key starts with the active DID. The hook reads the active DID from session context and passes it in. This makes data per-account: switching accounts surfaces the previously-active account's cached data without refetch, and concurrent multi-account is well-defined.

Rejected alternatives: inline tuples (drift / typos between query and invalidate sites) and per-domain factories (no single source of truth for the schema).

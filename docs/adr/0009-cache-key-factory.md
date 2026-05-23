# ADR-0009: Cache keys come from a single factory in `src/data/keys.ts`

Every TanStack Query `queryKey` and every `invalidateQueries` call in Bluepy reads its key from `src/data/keys.ts`. No inline string keys. The factory exposes pure functions (DID passed explicitly by the caller):

```ts
export const keys = {
  // canonical per-URI entries (ADR-0016) — hold full post/profile bodies
  post:           (did: string, uri: AtUri) => [did, 'post', uri] as const,
  profile:        (did: string, didOrHandle: string) => [did, 'profile', didOrHandle] as const,

  // list keys — hold URI arrays + list-local metadata (boost reason, reply tree, grouping), NOT post bodies
  timeline:       (did: string) => [did, 'timeline'] as const,
  feed:           (did: string, generator: AtUri, opts?: FeedOpts) => [did, 'feed', generator, opts] as const,
  thread:         (did: string, uri: AtUri) => [did, 'thread', uri] as const,
  profileFeed:    (did: string, subject: string, filter?: FeedFilter) => [did, 'profileFeed', subject, filter] as const,
  notifications:  (did: string, filter?: NotifFilter) => [did, 'notifications', filter] as const,
  search:         (did: string, query: string, type: 'posts'|'actors') => [did, 'search', type, query] as const,
  bookmarks:      (did: string) => [did, 'bookmarks'] as const,
  follows:        (did: string, subject: string) => [did, 'follows', subject] as const,
  followers:      (did: string, subject: string) => [did, 'followers', subject] as const,
  // ...
};
```

Cache keys are account-scoped — every key starts with the active DID. The hook reads the active DID from session context and passes it in. This makes data per-account: switching accounts surfaces the previously-active account's cached data without refetch, and concurrent multi-account is well-defined.

**Canonical vs list distinction.** `keys.post` and `keys.profile` are the only keys that hold full bodies. Every other key holds references (URIs / DIDs / handles) plus list-local metadata; the body for each reference is read separately via `usePost`/`useProfile` against the canonical key. Mutations therefore patch canonical keys only, never list keys.

Rejected alternatives: inline tuples (drift / typos between query and invalidate sites) and per-domain factories (no single source of truth for the schema).

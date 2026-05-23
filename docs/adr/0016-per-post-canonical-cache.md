# ADR-0016: Posts and profiles live in a per-URI canonical TanStack cache; list queries return references

Every fetched post lives at `keys.post(did, uri)` and every fetched profile at `keys.profile(did, didOrHandle)`. List queries (`useTimeline`, `useThread`, `useProfileFeed`, `useSearchPosts`, `useFeedPosts`, `useNotifications`) return arrays of URI references plus list-local metadata — boost reason, reply tree shape, notification grouping — not full post bodies.

The list `queryFn` runs `primePosts(qc, response)` (and `primeProfiles` where applicable) which walks the response and writes every post it sees — main post, reply parent, reply root, quoted record, repost target — to its canonical key via `qc.setQueryData(keys.post(did, uri), post)`. Embedded records are reshaped on the way in: a parent post's `embed.record` field stores only `{$type, uri, cid}`; the embedded post body lives at its own canonical key, read by the embed renderer via `usePost(embed.record.uri)`.

Rendering is two-pass. `<TimelineList>` reads `data.pages.flatMap(p => p.uris)` and renders `<PostCard uri={uri} reason={reason} />` per item; `PostCard` calls `usePost(uri)` to read the canonical entry. Same shape for profiles via `useProfile(handle)`.

Mutations write once. `likePost(uri)` patches `keys.post(did, uri)` via `setQueryData`; every subscribing component — timeline, thread, profile feed, quote embed, search result — re-renders without per-query fan-out. This is the central reason for the shape: mutation code stays one-line as features grow.

Per-URI queries use `staleTime: Infinity`. Freshness is delivered by list-query refetches re-priming the canonical cache. `gcTime` evicts unused entries via TanStack's default GC; no custom GC layer.

**Rejected alternatives:**
- **Targeted `setQueryData` per query on each mutation** (no normalization, the social-app approach). Mutations accumulate per-query patch logic; missing a query produces silent staleness. Recurring papercut as endpoint count grows.
- **Zustand `Map<uri, Post>` overlay alongside TanStack.** Two state systems, two GC policies, fan-out on every fetch site, background refetches clobber optimistic state, no TanStack devtools coverage.
- **Per-query, no cross-update.** UX regression vs. current Phanpy Valtio behavior — liking a post in timeline wouldn't reflect in the thread view until refetch.

**Implications:**
- ADR-0005 optimistic patches target `keys.post(did, uri)` / `keys.profile(did, did)` exclusively. No list-query patching on mutation.
- ADR-0009 list keys (`keys.timeline`, `keys.feed`, `keys.thread`, `keys.profileFeed`, `keys.search`, `keys.notifications`) hold URI arrays + list-local metadata, not post bodies.
- `primePosts` and `primeProfiles` live in `src/data/_internal/prime.ts`. Missed paths in primers produce cache-miss network calls (one network round-trip per uncovered post), so primers are exhaustively unit-tested with fixture responses that exercise: regular post, reply (parent + root), quote embed, nested quote, repost, video embed, image embed, external embed.
- Profile-view rendering (`<ProfileHeader>`, `<AccountChip>`) reads `useProfile(handle)`; list endpoints like follows/followers return profile-DID arrays primed into canonical cache the same way.

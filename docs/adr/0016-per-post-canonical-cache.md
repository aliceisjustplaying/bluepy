# ADR-0016: Posts and profiles live in a per-URI/DID canonical TanStack cache scoped to the viewer; list queries return references

Every fetched post lives at `keys.post(scope, uri)` and every fetched profile body at `keys.profileByDid(scope, did)`, where `scope: ViewerScope = [viewerDid, appviewKey, labelersHash]` (ADR-0009). Handle → DID resolution is a separate cache entry at `keys.actorResolution(scope, handle)` so profile bodies don't duplicate under both handle and DID and don't stale on handle changes. List queries (`useTimeline`, `useThread`, `useProfileFeed`, `useSearchPosts`, `useFeedPosts`, `useNotifications`) return arrays of URI/DID references plus list-local metadata — boost reason, reply tree shape, notification grouping — not full bodies.

The list `queryFn` runs `primePosts(qc, scope, response)` (and `primeProfiles` where applicable) which walks the response and writes every post/profile it sees — main post, reply parent, reply root, quoted record, repost target — to its canonical key via `qc.setQueryData(keys.post(scope, uri), post)` / `qc.setQueryData(keys.profileByDid(scope, did), profile)`. Embedded records are reshaped on the way in: a parent post's `embed.record` field is normalised, with the embedded post body extracted and re-stored at its own canonical key. The parent retains only a typed reference. The embed renderer reads the embedded body via `usePost(embed.record.uri)`.

**Embed variant handling — primer contract.** ATProto's record-embed union has multiple variants. The primer must preserve each one explicitly:

| Variant `$type` | Primer behaviour |
| --- | --- |
| `app.bsky.embed.record#viewRecord` | Prime the embedded post body at its canonical key; replace the parent's `embed.record` with a typed reference `{$type: 'app.bsky.embed.record#viewRef', uri, cid}` |
| `app.bsky.embed.record#viewNotFound` | Preserve unchanged (renderer shows "not found" placeholder) |
| `app.bsky.embed.record#viewBlocked` | Preserve unchanged including the author DID + viewer-blocked flag (renderer shows "blocked" placeholder) |
| `app.bsky.embed.record#viewDetached` | Preserve unchanged (renderer shows "detached" placeholder) |
| `app.bsky.embed.record#viewRecord` wrapping a non-post record (`app.bsky.feed.generator`, `app.bsky.graph.list`, `app.bsky.graph.starterpack`, `app.bsky.labeler.service`, etc.) | Preserve unchanged; do not coerce to a post primer path |
| Unknown `$type` | Preserve unchanged with the original `$type` intact |

The primer never silently drops a variant. Fixture corpus must include one representative of each row in the table; unit tests assert the post-primer cache state and the unchanged-pass-through cases.

Rendering is two-pass. `<TimelineList>` reads `data.pages.flatMap(p => p.uris)` and renders `<PostCard uri={uri} reason={reason} />` per item; `PostCard` calls `usePost(uri)` to read the canonical entry. Same shape for profiles — `useProfile(actor)` resolves `actor` (handle or DID) via `keys.actorResolution(scope, handle)` if needed, then reads `keys.profileByDid(scope, did)`.

Mutations write once. `likePost(uri)` patches `keys.post(scope, uri)` via `setQueryData`; every subscribing component — timeline, thread, profile feed, quote embed, search result — re-renders without per-query fan-out. This is the central reason for the shape: mutation code stays one-line as features grow.

**Cross-scope same-viewer patching for engagement mutations.** Account/AppView/labeler switches leave old viewer-scope entries in cache. A user who likes a post under one scope and then navigates to a different cached scope (different AppView, different labeler set) would see stale viewer state on the same post under the same `viewerDid`. To prevent this:

```
For engagement mutations (like, repost, follow, mute, block, bookmark):
  1. Patch the canonical key in the current scope (immediate optimistic feedback).
  2. Then find every cached canonical key matching [viewerDid, *, *, 'post', uri]
     or [viewerDid, *, *, 'profileByDid', did] — i.e. same active account,
     any appviewKey, any labelersHash.
  3. Patch each one OR invalidate it (implementation choice; patch is preferred for instant cross-scope correctness, invalidate is acceptable if patch is awkward).
```

This is a same-viewer correctness fix only; entries under a *different* `viewerDid` are not touched (they belong to a different account and that account's viewer state is its own). The patch logic lives in `src/data/_internal/cross-scope-patch.ts`.

**Staleness policy.**

- **Per-URI/DID canonical entries** use `staleTime: Infinity`. List-query refetches re-prime them via `primePosts`/`primeProfiles`. This is what makes the optimistic-fan-out + minimal-mutation-code property work; making canonical entries refetch on their own would race with list refetches and clobber viewer state.
- **Direct-route hooks** (`usePostRoute(uri)`, `useProfileRoute(actor)`, `useThread(uri)`) refetch on mount (`refetchOnMount: 'always'`) **and** set a finite `staleTime` (60s default). When a user opens a permalink from cache, viewer state, counts, label changes, and deletion status are revalidated; the request hits `getPostThread` / `getPosts` / `getProfile` and the response re-primes the canonical entries on the way in. Without this, opening a permalink could show indefinitely stale counts and viewer state.

`gcTime` evicts unused entries via TanStack's default GC; no custom GC layer.

**Rejected alternatives:**
- **Targeted `setQueryData` per query on each mutation** (no normalization, the social-app approach). Mutations accumulate per-query patch logic; missing a query produces silent staleness. Recurring papercut as endpoint count grows.
- **Zustand `Map<uri, Post>` overlay alongside TanStack.** Two state systems, two GC policies, fan-out on every fetch site, background refetches clobber optimistic state, no TanStack devtools coverage.
- **Per-query, no cross-update.** UX regression vs. current Phanpy Valtio behavior — liking a post in timeline wouldn't reflect in the thread view until refetch.
- **Globally canonical (no viewer scope in key).** Wrong-AppView / wrong-labeler renders after Active AppView swap or labeler-subscription change; required manual invalidation that's easy to miss.
- **Patch only the current scope, leave other cached scopes alone.** Same-viewer stale engagement across cached scopes — user likes a post under one labeler set, switches labelers, sees the unlike state on the same post under the previous account.
- **Key profile bodies by handle (or by handle-or-DID with duplication).** Stale-handle bugs (re-pointed handle keeps showing the old body); duplicated cache entries (same body under both handle and DID); profile body unnecessarily invalidated on handle change.

**Implications:**
- ADR-0005 optimistic patches target `keys.post(scope, uri)` / `keys.profileByDid(scope, did)` exclusively within the current viewer scope, then cross-scope-patch as above. No list-query patching on mutation.
- ADR-0009 list keys (`keys.timeline`, `keys.feed`, `keys.thread`, `keys.profileFeed`, `keys.search`, `keys.notifications`) hold URI/DID arrays + list-local metadata, not bodies; all are prefixed with viewer scope.
- `primePosts` and `primeProfiles` live in `src/data/_internal/prime.ts`. Missed paths in primers produce cache-miss network calls (one network round-trip per uncovered post), so primers are exhaustively unit-tested with fixture responses that exercise: regular post, reply (parent + root), quote embed (each variant in the table above), nested quote, repost, video embed, image embed, external embed.
- Profile-view rendering (`<ProfileHeader>`, `<AccountChip>`) reads `useProfile(actor)`; list endpoints like follows/followers return profile-DID arrays primed into canonical cache the same way.

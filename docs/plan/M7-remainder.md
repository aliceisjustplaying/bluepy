# M7 Remainder — Component Migration

> **Audience**: AFK agent or human picking up the `rewrite` branch.
> **Contract**: plan/0001 M7 done-bar — every *read* surface uses the new data hooks; post/profile renders go through moderation gates; `bun run dev` + logged-in browser walkthrough works end-to-end.
> **Last updated**: 2026-05-23 (session handoff).

## Scope decisions (binding)

| Feature | M7? | Notes |
| --- | --- | --- |
| **Catch-up** (`/catchup`) | **Yes — must ship** | Flagship Bluepy feature. Full read-path migration; keep aggregation UX, IndexedDB history, keyboard nav, booster grouping. |
| **Year in Posts** (`/year-in-posts`) | **No — drop** | Do not migrate. Leave on legacy `api()` until M11 deletion or remove route if blocking. No e2e, no hook work. |
| **Account-info reads** (profile header, follower/following lists) | **Yes** | Wire `useProfile`, `useFollowers`, `useFollows`, `ProfileModerationGate`. Writes stay M8. |
| **Compose, related-actions, settings, notification rows, modals** | **No (M8/M9)** | May still call `api()` for mutations; not M7 blockers if read feeds work. |

## Done so far

### Shared feed / post components

| Component | Role |
| --- | --- |
| `post-uri-feed.tsx` | Generic infinite post list (`deck-container`, `FeedStatusLink` + `data-href`) |
| `timeline-feed.tsx` | `useTimelineFeed` wrapper |
| `post-by-uri.tsx` | `usePost` + `usePostModeration` → legacy `Status` shell |
| `moderation-gate.tsx` | Post moderation UI |
| `profile-feed.tsx` | Profile posts via `PostUriFeed` |
| `profile-moderation-gate.tsx` | Profile moderation UI |
| `list-feed.tsx` | Custom lists + generator feeds |
| `notifications-feed.tsx` | `useNotifications` + `PostByUri` |
| `post-thread-page.tsx` | `useThread` + `PostByUri` for AT post detail |
| `profile-by-did.tsx` | Search/profile actor rows |
| `search-data-results.tsx` | `useSearchPosts` / `useSearchActors` |

### Pages migrated off legacy `Timeline` + `api()` for reads

- `home`, `following`, `following2`
- `notifications`, `mentions`, `bookmarks`, `favourites`
- `hashtag`, `list`, `trending`
- `account-statuses`, `search` (posts/accounts when `atproto && type !== 'hashtags'`)
- `status` — AT URI posts delegate to `PostThreadPage` (after all hooks)

### Infra fixes landed with M7

- `SessionProvider` — app-password DIDs no longer dropped on OAuth-restore failure
- `legacy-session.ts` — `configureLabelers([])` for app-password agents
- `legacy-states-bridge.ts` — Valtio ↔ Zustand sync during migration
- `post-view-map.ts` — `postViewToDisplayStatus` (still depends on adapter; M11 target)

### Verification (current green)

```
bun run typecheck   ✓
bun run test:unit   ✓ (121)
bun run test:e2e    ✓ (14/14 in tests/e2e/)
```

E2e contract: `tests/e2e/m7-feeds.spec.ts` + `tests/e2e/timeline.spec.ts` via `bun run test:e2e`. Legacy `tests/atproto-*.spec.js` are not the M7 gate.

---

## Remaining work (ordered)

### 1. Catch-up — priority

**File**: `src/pages/catchup.tsx` (~2.7k LOC)

**Current state**

- Fetches home timeline via `api()` → `getMastoV1Resource(masto, 'timelines').home.list()` async iterator
- Stores sessions in IndexedDB (`src/utils/db.ts` → `db.catchup`)
- Custom render path: `PostLine`, `PostPeek`, `PostStats` — **not** shared `Status`, but types are `mastodon.v1.Status` / `CatchupPost`
- Aggregation: booster grouping (`__BOOSTERS`), thread tagging (`_thread`), author counts, time bins, filters via `isFiltered`, quote/reblog peek via `statusPeek`
- Uses `getPreferences`, `getCurrentAccountNS`, `getCurrentAccountID` from legacy store/utils

**Migration strategy (minimal UX change)**

1. **Fetch layer** — replace masto home iterator with paginated timeline reads:
   - Prefer a dedicated helper in `src/data/feeds.ts` (or `_internal/`) that pages `app.bsky.feed.getTimeline` until `catchupPageHasItemsInRange` says stop (reuse `src/utils/catchup-fetch.ts`).
   - Return `AppBskyFeedDefs.FeedViewPost[]` or AT URIs + minimal metadata for aggregation (author DID, createdAt, reply ref, repost/quote refs).
   - Keep the 1s pause between pages if rate-limit behaviour depends on it; document if removed.

2. **Aggregation layer** — refactor `CatchupPost` to an internal summary type keyed by AT URI:
   - `{ uri, authorDid, createdAt, replyParentUri?, repostOfUri?, quoteUri?, boosters: Set<did>, _thread?, _filtered? }`
   - Do **not** round-trip through full `AdaptedStatus` / masto shape unless a sub-view still requires it.

3. **Render layer** — two acceptable paths (pick one, stay consistent):
   - **A (preferred for moderation parity)**: `PostLine` holds URI; expand/peek/detail uses `PostByUri` or a compact `PostPeekByUri` wrapper with `size="compact"` / catchup-specific CSS.
   - **B**: Keep custom peek markup but source display fields from `usePost(uri)` inside `PostPeek` (heavier, many parallel queries — batch carefully).

4. **Persistence** — IndexedDB records should store URI lists + aggregation metadata, not full masto statuses. Write a one-time read migration for existing `db.catchup` entries if schema changes (or namespace bump).

5. **Remove** `api()`, `getMastoV1Resource`, `masto` types from catchup page once fetch + render paths are URI-based.

6. **Moderation** — apply `usePostModeration` wherever post body/media is shown (peek expand at minimum).

**E2e (required before M7 close)**

Add to `tests/e2e/m7-feeds.spec.ts` (or `catchup.spec.ts`):

- Navigate `/catchup`, assert start UI visible
- Trigger a short catch-up window (preset button or query param if supported)
- Wait for `app.bsky.feed.getTimeline` XRPC
- Assert aggregated author list or post lines render
- Optional: reload saved catch-up from IndexedDB (`?id=…`) if stable in CI

**Unit tests to extend**

- `tests/catchup-fetch.test.ts`, `tests/catchup-sort.test.ts` — keep green
- Add tests for URI → aggregation mapping if extracted from the page

---

### 2. Account-info reads

**File**: `src/components/account-info.tsx` (~1.3k LOC)

**Current state**

- Profile load, follower/following modals, familiar followers via `api()` / masto `$select` shims
- Still uses `states` (Valtio) for modals in places
- `RelatedActions` for follow/block/mute — **writes stay M8**; reads must not block on masto client

**Migration tasks**

1. Replace profile fetch with `useProfile(actor)` / `useProfileRoute(handle)` — map `ProfileView` to existing `AccountInfoShape` at the boundary (or narrow props gradually).
2. Follower/following lists → `useFollowers(did)` / `useFollows(did)` with existing infinite/modal UX.
3. Wrap header in `ProfileModerationGate` when viewing another user's profile.
4. Keep `RelatedActions` on `api()` for now unless M8 lands first — document the seam.

**E2e gap**

- Profile header fields (avatar, counts, bio) already partially covered by `account-statuses` feed test
- Add explicit follower/following modal open + list render if modals move to new hooks

---

### 3. Year in Posts — explicitly out

**File**: `src/pages/year-in-posts.tsx`

- **Do not migrate** for M7.
- May remain on legacy stack through M10.
- If YIP blocks typecheck or creates import cycles during catchup work, isolate behind existing route guard — do not invest in YIP hooks.

---

### 4. Residual `api()` on read paths (lower priority)

These still import `api()` but are **not** M7 blockers unless they break logged-in feed/profile flows:

| Area | Examples | Milestone |
| --- | --- | --- |
| Post actions / menus | `related-actions`, `status-*`, `notification.tsx` | M8 mutations |
| Compose | `compose.tsx`, `compose-button`, drafts | M9 (plan 0002) |
| Settings / accounts | `settings.tsx`, `accounts.tsx` | M8/M10 |
| Search chrome | `search-form`, `recent-searches` (may only need prefs) | M7 optional |
| Legacy timeline shell | `timeline.tsx`, `timeline2.tsx` | Delete when last consumer gone |

---

## M7 done-bar checklist

Before marking M7 complete and moving to M8:

- [ ] Catch-up: fetch via `@atproto/api` / data hooks; no `getMastoV1Resource` in `catchup.tsx`
- [ ] Catch-up: post display uses URI-based pipeline with moderation
- [ ] Catch-up: IndexedDB save/load works with new schema
- [ ] Catch-up: e2e test in `tests/e2e/`
- [ ] Account-info: profile reads via `useProfile*` hooks
- [ ] Account-info: follower/following lists via `useFollowers` / `useFollows`
- [ ] Account-info: `ProfileModerationGate` on other-user profiles
- [ ] YIP explicitly deferred (no migration commits)
- [ ] `bun run typecheck`
- [ ] `bun run test:unit`
- [ ] `bun run test:e2e` (including catchup)
- [ ] `bunx oxlint` on all changed files
- [ ] Logged-in browser walkthrough: home → catchup → profile → post detail
- [ ] Codex review (per CLAUDE.md) — no actionable findings

---

## Explicitly not M7

| Item | Plan milestone |
| --- | --- |
| `useFollowAccount`, mute, block, like, repost, bookmark writes | M8 |
| Compose state + submit (`plan/0002`) | M9 |
| Telemetry, offline shell | M10 |
| Delete `atproto-adapter.ts`, `api.ts`, `states.ts` | M11 |

---

## Reference snippets

Catchup fetch today (replace):

```ts
const timelines = getMastoV1Resource(masto, 'timelines');
const homeIterable = timelines.home.list({ limit: 40 });
// async iterator → CatchupPost[]
```

Target fetch shape:

```ts
// pages until catchupPageHasItemsInRange(page, maxCreatedAt) is false
app.bsky.feed.getTimeline({ limit: 40, cursor })
// → extract uri, author, createdAt, reply/repost/quote refs for aggregation
```

Existing hooks to reuse:

- `useTimelineFeed` — reference for pagination pattern, not drop-in (catchup needs full scan + custom stop condition)
- `usePost` / `PostByUri` — render parity with rest of app
- `useProfile`, `useFollowers`, `useFollows` — account-info reads

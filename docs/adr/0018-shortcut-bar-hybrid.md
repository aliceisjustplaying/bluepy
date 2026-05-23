# ADR-0018: Shortcut bar is a hybrid view over savedFeedsPrefV2 (server) and local Phanpy entries

The Phanpy shortcut bar is the central nav primitive in Bluepy. It holds heterogeneous items, only some of which map to ATProto's server-backed feed concept.

**Item types and storage origin:**
- `feed` (feed-generator URI) — server, from `savedFeedsPrefV2` where `pinned = true`
- `list` (list URI) — server, from `savedFeedsPrefV2` where `pinned = true`
- `timeline` (the default following feed) — server, from `savedFeedsPrefV2` where `pinned = true`
- `notifications`, `mentions`, `bookmarks`, `favourites` (likes), `search`, `hashtag`, `account-statuses`, `trending`, `public` — local Zustand `shortcuts` slice, device-only

**Render hook** `useShortcutBar()` lives in `src/data/shortcuts.ts` and returns a single ordered `ShortcutItem[]` discriminated by `src: 'server' | 'local'`. The hook composes:
- the local Zustand `shortcuts.order: ShortcutEntry[]` (the user's chosen ordering),
- `usePreferences().savedFeeds` filtered to `pinned === true`,
and reconciles them: every pinned server-feed has exactly one matching reference in the local order; orphan refs (server entry removed elsewhere) are dropped; new pinned entries (added on another device) are appended to the end of the local order on next reconcile.

**Mutation routing:**
- Reorder → write local order array only.
- Toggle pin on a feed/list (from feed-discovery UI or shortcut-bar-settings) → `useUpdatePreference('savedFeeds')` flips `pinned`; reconcile picks it up on next render.
- Add a local-only Phanpy entry (e.g. add a search shortcut) → write to local Zustand only.
- Remove a server-feed entry from the shortcut bar → semantic is "unpin", flipping `pinned=false` on the savedFeeds entry, not deleting the entry.

The savedFeeds entry retains its existence (still "saved" but not pinned) so a future "manage feeds" page can expose saved-but-unpinned feeds. That page is out of scope for the initial rebuild — savedFeeds without `pinned=true` are simply invisible until that UI exists.

**Reconciliation contract** (`reconcileShortcutBar`, `src/data/_internal/reconcile-shortcuts.ts`):
- Inputs: `localOrder: ShortcutEntry[]`, `pinnedSavedFeeds: SavedFeed[]`.
- For each pinned saved feed missing from `localOrder`: append a `{src: 'server', kind: 'feed'|'list'|'timeline', id: <savedFeed.id>}` entry.
- For each `localOrder` entry of `src: 'server'` whose `id` is no longer in pinned saved feeds: drop it.
- Local-only entries pass through untouched.
- Local order is rewritten if any change occurred (idempotent on no-op).

**Rejected alternatives:**
- **Server-only** — drops Phanpy-only shortcut types (notifications/mentions/bookmarks/search/etc.) users rely on; violates the "keep Phanpy's UI" mandate.
- **Local-only** — duplicates the pinning UX with savedFeedsPrefV2 (Bluepy and Bluesky disagree on what's pinned). Cross-device feed pinning is a real win we shouldn't give up.
- **Local with one-way auto-sync from server** — write asymmetry (server → local but not back) confuses users when they remove a feed locally and it reappears next session.
- **Squat `app.bsky.actor.defs#x-bluepy-shortcuts` for the order** — see ADR-0017, rejected for same reasons.

**Implications:**
- `localOrder` is the only thing the user reorders; the server side is identity + pinned flag, never order.
- Per-DID isolation: `shortcuts.order` is account-scoped (Zustand `persist` keyed by DID), reconciles against that DID's `savedFeedsPrefV2`.
- Reconciliation runs in `useShortcutBar()` as a `useMemo` over both inputs — pure, no side-effects beyond writing back to Zustand when the local order changes.

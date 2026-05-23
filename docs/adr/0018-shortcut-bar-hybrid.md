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
- Toggle pin on a feed/list (from feed-discovery UI or shortcut-bar-settings) → `useUpdatePreference('savedFeeds')` flips `pinned` via `authenticated-active-appview-via-pds` (ADR-0004); reconcile picks it up on next render.
- Add a local-only Phanpy entry (e.g. add a search shortcut) → write to local Zustand only.
- Remove a server-feed entry from the shortcut bar → semantic is "unpin", flipping `pinned=false` on the savedFeeds entry, not deleting the entry.

The savedFeeds entry retains its existence (still "saved" but not pinned) so a future "manage feeds" page can expose saved-but-unpinned feeds. That page is out of scope for the initial rebuild — savedFeeds without `pinned=true` are simply invisible until that UI exists.

**Reconciliation contract — pure function.** Lives in `src/data/_internal/reconcile-shortcuts.ts`:

```ts
export function reconcileShortcutBar(
  localOrder: ShortcutEntry[],
  pinnedSavedFeeds: SavedFeed[],
): {
  items: ShortcutItem[];      // the bar's render output, in display order
  nextOrder: ShortcutEntry[]; // the order to persist if changed
  changed: boolean;           // true iff nextOrder differs from localOrder
}
```

Rules:
- For each pinned saved feed missing from `localOrder`: append a `{src: 'server', kind: 'feed'|'list'|'timeline', id: <savedFeed.id>}` entry.
- For each `localOrder` entry of `src: 'server'` whose `id` is no longer in pinned saved feeds: drop it.
- Local-only entries pass through untouched.
- `nextOrder === localOrder` (referentially) when nothing changed; `changed` mirrors that.

**Writeback contract in `useShortcutBar()`.** Reconciliation runs in a `useMemo`; persistence runs in a `useEffect`. Writing Zustand state from inside `useMemo` is forbidden — it is a render-phase side effect and breaks under React's concurrent rendering:

```ts
function useShortcutBar(): ShortcutItem[] {
  const localOrder = useShortcutsStore(s => s.order);
  const { savedFeeds } = usePreferences();
  const pinned = useMemo(() => savedFeeds.filter(f => f.pinned), [savedFeeds]);
  const reconciled = useMemo(
    () => reconcileShortcutBar(localOrder, pinned),
    [localOrder, pinned],
  );
  const setOrder = useShortcutsStore(s => s.setOrder);
  useEffect(() => {
    if (reconciled.changed) setOrder(reconciled.nextOrder);
  }, [reconciled.changed, reconciled.nextOrder, setOrder]);
  return reconciled.items;
}
```

The pure function is unit-tested against fixture pairs (`localOrder`, `pinnedSavedFeeds`) with spec-enumerated outputs per ADR-0019. The writeback wrapper is covered by an e2e flow (pin from another device + open Bluepy → bar updates).

**Rejected alternatives:**
- **Server-only** — drops Phanpy-only shortcut types (notifications/mentions/bookmarks/search/etc.) users rely on; violates the "keep Phanpy's UI" mandate.
- **Local-only** — duplicates the pinning UX with savedFeedsPrefV2 (Bluepy and Bluesky disagree on what's pinned). Cross-device feed pinning is a real win we shouldn't give up.
- **Local with one-way auto-sync from server** — write asymmetry (server → local but not back) confuses users when they remove a feed locally and it reappears next session.
- **Squat `app.bsky.actor.defs#x-bluepy-shortcuts` for the order** — see ADR-0017, rejected for same reasons.
- **Writeback inside `useMemo`** — earlier draft of this ADR said "pure, no side-effects beyond writing back to Zustand when the local order changes." That sentence contradicted itself: writing to Zustand *is* a side effect, and a `useMemo` that writes state can cause render-phase updates and infinite loops, especially under strict/concurrent rendering. Replaced with the pure-function + `useEffect` pair above.

**Implications:**
- `localOrder` is the only thing the user reorders; the server side is identity + pinned flag, never order.
- Per-DID isolation: `shortcuts.order` is account-scoped (Zustand `persist` keyed by DID), reconciles against that DID's `savedFeedsPrefV2`.
- `reconcileShortcutBar` is pure and fully covered by unit tests; the `useShortcutBar` hook is thin enough that its e2e exercise is the cross-device pin propagation flow.

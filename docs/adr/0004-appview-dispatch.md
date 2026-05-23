# ADR-0004: Three-client dispatch model with Bluesky-AppView fallback

The new data layer maintains three underlying ATProto agents, and every function in `src/data/*.ts` explicitly picks one:

- **`pdsAgent`** — talks to the logged-in user's PDS. Used for writes (`com.atproto.repo.createRecord`, `putRecord`, `deleteRecord`, `applyWrites`, `uploadBlob`), authenticated mutations, and any operation tied to identity (mutes, blocks, follows, notifications-as-read).
- **`appviewAgent`** — talks to the user's **Active AppView** (per-account configurable; defaults to Bluesky's, but can be Blacksky's or any other). Used for the bulk of `app.bsky.*` reads — timeline, profile, thread, search, list, feed-generator.
- **`bskyAppviewAgent`** — pinned to the official **Bluesky AppView** (`public.api.bsky.app` / `did:web:api.bsky.app#bsky_appview`). Used as an escape hatch for operations that the active AppView does not implement or implements incorrectly (e.g. third-party AppViews like Blacksky don't ship `app.bsky.unspecced.*`, trending, discovery feeds).

Each function in the data layer hard-codes which client it uses, based on what the operation does. The agent porting code does not invent the mapping — there is a single dispatch helper (`src/data/clients.ts`) that exposes the three agents and a documented rule:

- Writes / identity-bound ops → `pdsAgent`
- `app.bsky.unspecced.*`, trending, discovery, anything not part of the Bluesky-AppView-portable surface → `bskyAppviewAgent`
- Everything else under `app.bsky.*` → `appviewAgent`

The list of operations that require `bskyAppviewAgent` is empirical and lives in `src/data/clients.ts` as a documented exceptions list — it can grow as we learn what other AppView implementations miss, without changing the dispatch shape.

Rejected alternatives: (a) single agent with `configureProxy()` toggled per call — the brittle thing the current adapter does; (b) per-call audience parameter — leaks dispatch decisions to call sites that will get them wrong; (c) ignore third-party AppViews and hard-code Bluesky — gives up a real Bluepy differentiator.

# ADR-0004: Three-client dispatch with a 4-category read/write model

The new data layer maintains three underlying ATProto agents and dispatches every call into one of four explicit read/write modes. Every function in `src/data/*.ts` picks its mode at the call site via a named helper — no call site touches a raw agent.

**Agents** (constructed by `src/data/clients.ts` for the active session):

- **`pdsAgent`** — talks to the logged-in user's PDS. `null` when logged out.
- **`appviewAgent`** — talks to the user's **Active AppView** (per-account configurable; defaults to Bluesky's public AppView, can be Blacksky's or any other). Unauthenticated by default.
- **`bskyAppviewAgent`** — pinned to the official Bluesky AppView (`https://public.api.bsky.app`). Unauthenticated.

**Dispatch model** — every function picks one of four `CallMode` values, exposed as helpers in `src/data/clients.ts`:

```ts
type CallMode =
  | 'public-active-appview'                  // logged-out public reads (anonymous timeline, profile, search where viewer state is not required)
  | 'authenticated-active-appview-via-pds'   // logged-in reads where viewer/moderation/label state matters (timeline, thread, profile, feed, search, notifications)
  | 'public-bluesky-appview'                 // app.bsky.unspecced.*, trending, discovery — anything not portable across third-party AppViews
  | 'pds-direct';                            // writes, mutations, identity-bound ops (createRecord, putRecord, deleteRecord, uploadBlob, follows, mutes, blocks, prefs, notifications updateSeen)
```

**Rule table**:

| Operation class | Mode | Client path |
| --- | --- | --- |
| Logged-out public post/profile/feed/search reads | `public-active-appview` | `appviewAgent` directly |
| Logged-in reads where viewer state, labels, moderation, mutes/blocks, or saved-state matter | `authenticated-active-appview-via-pds` | `pdsAgent` with `configureProxy(activeAppViewProxyDid, '#bsky_appview')` set |
| `app.bsky.unspecced.*`, trending, discover, third-party-AppView blind spots | `public-bluesky-appview` | `bskyAppviewAgent` directly |
| Writes, mutations, identity-bound ops, uploads, preference writes | `pds-direct` | `pdsAgent` directly |

**Default for a logged-in user is `authenticated-active-appview-via-pds`, NOT `public-active-appview`.** The fact that an `appviewAgent` exists in the bundle does not mean reads should default to it once a user is authenticated — viewer state (liked? reposted? muted by you? blocked? filtered by your labeler subscriptions? hidden by `hiddenPostsPref`?) is account-sensitive. Choosing `public-active-appview` for a logged-in user is a deliberate optimisation reserved for endpoints whose response shape is verifiably independent of viewer state. The agent never makes that call inline; if a logged-in read should skip the PDS proxy, mark it explicitly in the helper.

`src/data/clients.ts` exposes:

```ts
export function getReadAgent(clients: ClientBundle, mode: CallMode): AtpAgent;
export function getWriteAgent(clients: ClientBundle): AtpAgent;            // throws NotAuthenticatedError if pdsAgent === null
export function getPdsAgentFor(clients: ClientBundle, did: string): AtpAgent;  // per-account write agent for compose author switching (plan 0002)
```

Plus a documented exceptions list (the empirical set of operations that must use `public-bluesky-appview` because third-party AppViews don't implement them — trending topics, suggested follows, popular feeds, the `app.bsky.unspecced.*` namespace). That list grows in code as the agent encounters Blacksky/AppView gaps, not in this ADR.

**Rejected alternatives**: (a) single agent with `configureProxy()` toggled per call — the brittle thing the current adapter does; (b) per-call audience parameter — leaks dispatch decisions to call sites; (c) three-category model (writes / public-appview-reads / unspecced) — the version this ADR replaced; it left "logged-in reads where viewer state matters" ambiguous and tempted call sites into using unauthenticated `appviewAgent` for reads that need viewer/label context.

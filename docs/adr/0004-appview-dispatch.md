# ADR-0004: Three-client dispatch with a 5-mode read/write model

The new data layer maintains three underlying ATProto agents and dispatches every call into one of five explicit read/write modes. Every function in `src/data/*.ts` picks its mode at the call site via a named helper — no call site touches a raw agent.

**Agents** (constructed by `src/data/clients.ts` for the active session):

- **`pdsAgent`** — talks to the logged-in user's PDS. `null` when logged out.
- **`appviewAgent`** — talks to the user's **Active AppView** (per-account configurable; defaults to Bluesky's public AppView, can be Blacksky's or any other). Unauthenticated by default.
- **`bskyAppviewAgent`** — pinned to the official Bluesky AppView (`https://public.api.bsky.app`). Unauthenticated.

**Dispatch model** — every function picks one of five `CallMode` values, exposed as helpers in `src/data/clients.ts`:

```ts
type CallMode =
  | 'public-active-appview'                  // logged-out public reads against Active AppView (anonymous timeline, profile, search)
  | 'authenticated-active-appview-via-pds'   // logged-in reads where viewer/moderation/label state matters
  | 'public-bluesky-appview'                 // logged-out app.bsky.unspecced.*, trending, discovery (Bluesky-only)
  | 'authenticated-bluesky-appview-via-pds'  // logged-in app.bsky.unspecced.* / Bluesky-only where viewer state matters
  | 'pds-repo-direct';                       // raw PDS repo ops: createRecord, putRecord, deleteRecord, applyWrites, uploadBlob
```

**Critical distinction: `pds-repo-direct` is NOT for `app.bsky.*` mutations.** Most authenticated `app.bsky.*` operations — including writes like `app.bsky.actor.putPreferences`, `app.bsky.notification.updateSeen`, `app.bsky.graph.muteActor` — are AppView APIs that must be **proxied through the PDS** using service-proxy headers, NOT called as raw PDS repo ops. Only `com.atproto.repo.*` and `com.atproto.repo.uploadBlob` are raw PDS calls. Getting this wrong is the kind of mistake the agent should not be allowed to make inline; the rule table below is exhaustive.

**Rule table**:

| Operation class | Mode | Client path |
| --- | --- | --- |
| Logged-out public `app.bsky.*` reads (timeline, profile, post, feed, search where viewer state irrelevant) | `public-active-appview` | `publicActiveAppViewAgent` |
| Logged-in `app.bsky.*` reads/writes where viewer state, labels, moderation, mutes/blocks, saved-state, or preferences matter — includes `getPreferences`, `putPreferences`, `updateSeen`, `muteActor`, `unmuteActor`, `muteThread`, etc. | `authenticated-active-appview-via-pds` | `activeAppViewProxyAgent` |
| Logged-out `app.bsky.unspecced.*`, trending, discover, popular feeds, Bluesky-only endpoints | `public-bluesky-appview` | `publicBskyAppViewAgent` |
| Logged-in `app.bsky.unspecced.*` / Bluesky-only endpoints where viewer state matters | `authenticated-bluesky-appview-via-pds` | `bskyAppViewProxyAgent` |
| `com.atproto.repo.createRecord` / `deleteRecord` / `putRecord` / `applyWrites` / `com.atproto.repo.uploadBlob` | `pds-repo-direct` | `pdsRepoAgent` |

**Default for a logged-in user is `authenticated-active-appview-via-pds`.** The fact that an `appviewAgent` exists in the bundle does not mean reads should default to it once a user is authenticated — viewer state (liked? reposted? muted by you? blocked? filtered by your labeler subscriptions? hidden by `hiddenPostsPref`?) is account-sensitive. Choosing `public-active-appview` for a logged-in user is a deliberate optimisation reserved for endpoints whose response shape is verifiably independent of viewer state. The agent never makes that call inline; if a logged-in read should skip the PDS proxy, mark it explicitly in the helper.

**Preconfigured per-mode agents — no shared-agent header mutation.** `src/data/clients.ts` constructs and exposes five preconfigured client handles in the `ClientBundle`. Each handle's proxy and accepted-labeler headers are **fixed at construction time** for that mode and viewer scope. **No call site — `queryFn`, `mutationFn`, or otherwise — may mutate proxy or labeler headers on a shared agent.** Imperative `try { agent.configureProxy(...); ... } finally { agent.configureProxy(undefined) }` patterns are forbidden: they leak the wrong proxy or labeler headers across concurrent requests under React's concurrent rendering and TanStack's parallel fetch behaviour.

```ts
export interface ClientBundle {
  pdsRepoAgent: AtpAgent | null;                       // raw PDS for repo ops (createRecord etc.)
  activeAppViewProxyAgent: AtpAgent | null;            // PDS-proxied with `did:web:<active-appview>#bsky_appview`
  bskyAppViewProxyAgent: AtpAgent | null;              // PDS-proxied with `did:web:api.bsky.app#bsky_appview`
  publicActiveAppViewAgent: AtpAgent;                  // direct to Active AppView, unauthenticated
  publicBskyAppViewAgent: AtpAgent;                    // direct to bsky public AppView, unauthenticated
}

export function getReadAgent(clients: ClientBundle, mode: CallMode): AtpAgent;
export function getWriteAgent(clients: ClientBundle, mode: 'pds-repo-direct' | 'authenticated-active-appview-via-pds' | 'authenticated-bluesky-appview-via-pds'): AtpAgent;
export function getPdsRepoAgentFor(clients: ClientBundle, did: string): AtpAgent;  // per-account write agent for compose author switching (plan 0002)
```

If `@atproto/api` exposes clone/with-proxy helpers in the version in use, the bundle constructs handles via those (immutable). If not, separate `AtpAgent` instances are constructed per mode/scope, sharing only the underlying session token state via a shared session manager — never sharing header state.

**Accepted-labeler header configuration.** For authenticated reads that go through `activeAppViewProxyAgent` or `bskyAppViewProxyAgent`, the agent's `atproto-accept-labelers` header MUST be configured with the same labeler DID set used by `useModerationContext()` (ADR-0022). The header set is:

```
acceptedLabelerDids = baselineAppLabelers ∪ userSubscribedLabelersFrom(labelersPref)
```

`baselineAppLabelers` is the small set of global/default labelers the app always accepts (e.g. Bluesky's moderation service). `userSubscribedLabelersFrom(labelersPref)` reads the active account's subscribed labelers. The header is set at bundle-construction time when the viewer scope is built; changes to `labelersPref` build a new bundle (new viewer scope → new `labelersHash` per ADR-0009 → cache partitions automatically).

`labelersHash = stableHash(sort(acceptedLabelerDids))`. The hash represents the **actual request header that was sent**, not merely the raw `labelersPref` value, so the cache key correctly partitions when baseline labelers change or any other labeler-related logic changes the effective accepted set.

Plus a documented exceptions list (the empirical set of operations that must use `public-bluesky-appview` / `authenticated-bluesky-appview-via-pds` because third-party AppViews don't implement them — trending topics, suggested follows, popular feeds, the `app.bsky.unspecced.*` namespace). That list grows in code as the agent encounters Blacksky/AppView gaps, not in this ADR.

**Rejected alternatives**: (a) single agent with `configureProxy()` toggled per call — the brittle thing the current adapter does; leaks header state across concurrent requests; (b) per-call audience parameter — leaks dispatch decisions to call sites; (c) three-category model (writes / public-appview-reads / unspecced) — left "logged-in reads where viewer state matters" ambiguous and tempted call sites into unauthenticated `appviewAgent`; (d) four-category model with `pds-direct` as a single bucket for all logged-in writes — tempted the agent to treat `app.bsky.actor.putPreferences` and other `app.bsky.*` mutations as raw PDS repo ops, bypassing the AppView proxy path the spec requires.

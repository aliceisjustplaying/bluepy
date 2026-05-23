# ADR-0010: OAuth state lives in `@atproto/oauth-client-browser`; Zustand holds the UI bits

`@atproto/oauth-client-browser` is the single source of truth for OAuth sessions — token storage, DPoP signing, refresh, key rotation. Bluepy does not duplicate or override this.

A Zustand store (`src/state/sessions.ts`, with `persist` middleware) holds only:

- `activeDid: string | null`
- `knownDids: string[]`
- `perAccountPrefs: Record<did, { activeAppView: AppViewConfig, /* ... */ }>`

On boot, for each `knownDids` entry, Bluepy calls `oauthClient.restore(did)`; failures are surfaced and the offending DID is removed from `knownDids`.

A `<SessionProvider>` (top-level, inside `<QueryClientProvider>`) reads the active session from the OAuth client (not Zustand) plus the active-AppView pref from Zustand, and instantiates the three clients (`pdsAgent`, `appviewAgent`, `bskyAppviewAgent`) for the active account, exposing them via React context. Data-layer hooks consume the clients through this context.

**Active AppView is per-account**, not global. Alice can use Blacksky's AppView; Bob can use the official Bluesky one. Switching the active account swaps both the OAuth session and the active-AppView setting in lock-step.

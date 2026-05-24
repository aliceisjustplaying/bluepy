# ADR-0006: UI state lives in Zustand; Valtio is removed

Valtio (`src/utils/states.ts`, ~587 LOC of global UI state, plus 36 import sites across the codebase) is removed during the Phase (b) rewrite. UI state — compose draft (text + attachments + reply ref before submit), modal stack, navigation/scroll state, transient toggles, filter selections — moves to one or a few Zustand stores under `src/state/`.

Zustand was chosen over plain React Context + reducer (more boilerplate, every cross-cutting concern needs a new Provider, re-render scoping requires care) and Jotai (more conceptual overhead, worse fit for "compose draft is one big object"). Zustand has the same mental shape as Valtio (one global store accessed via a hook) but uses immutable updates instead of proxy mutation, which removes a class of subtle accidental-reactivity bugs.

**Boundary**: server data does not live in Zustand. All record reads/writes flow through TanStack Query. Zustand holds only client-only UI state.

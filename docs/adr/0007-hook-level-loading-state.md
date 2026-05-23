# ADR-0007: Loading state is exposed as hook-level `isLoading` / `error`; no Suspense

Every data hook in `src/data/*.ts` exposes `{ data, isLoading, error }` (TanStack Query's standard `useQuery` return shape). Components branch on `isLoading` and `error` locally. The app is not restructured around Suspense boundaries.

Suspense was rejected as a concurrent change to the data-layer rebuild — it would require adding `<Suspense fallback>` + `<ErrorBoundary>` structure to every page and embedded subtree, and that is a separate architectural commitment that does not have to share a release with the data-layer port. If Bluepy adopts Suspense later, it does so as a follow-on phase against the stable hook-level API.

To prevent "spinner soup" when navigating between feeds or profiles, hook defaults set `placeholderData: keepPreviousData` — stale data stays on screen while the new fetch is in flight, with no flash. Mutation pending state surfaces via `useMutation`'s own `isPending`, not a global spinner.

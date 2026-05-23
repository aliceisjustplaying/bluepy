# ADR-0008: Paginated hooks expose a flat shape; `useInfiniteQuery` is an implementation detail

Every paginated hook in `src/data/*.ts` (`useTimelineFeed`, `useProfileFeed`, `useNotifications`, `useSearchPosts`, `useSearchActors`, `useListMembers`, etc.) returns the same shape regardless of underlying endpoint:

```ts
{
  items: T[];           // flattened across all loaded pages
  loadMore: () => void; // calls fetchNextPage()
  hasMore: boolean;     // hasNextPage
  isLoadingMore: boolean;
  isLoading: boolean;
  error: Error | null;
}
```

`useInfiniteQuery`, `data.pages`, `pageParams`, and ATProto cursor strings are implementation details inside the hook. Components do not touch `data.pages`. The `T` varies per hook (`Post`, `Notification`, `ProfileView`, `ListItem`); TypeScript handles this via generics in `src/data/*.ts`.

A shared helper under `src/data/_internal/use-infinite.ts` standardises the wrapping; bespoke hooks only supply the cursor + fetch function + page-to-items projection.

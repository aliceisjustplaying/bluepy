# ADR-0005: Mutations use TanStack Query `useMutation` with selective optimistic updates

Every write in `src/data/*.ts` (`createPost`, `deletePost`, `likePost`, `repostPost`, `followAccount`, `muteAccount`, `blockAccount`, `bookmarkPost`, `markNotificationsRead`, `editProfile`, etc.) is exposed as a TanStack Query `useMutation` hook in the same module that owns the corresponding read hooks.

**Optimistic updates** are used for engagement actions where the cached object change is cheap to model and roll back: `likePost`/`unlikePost`, `repostPost`/`unrepostPost`, `followAccount`/`unfollowAccount`, `bookmarkPost`/`unbookmarkPost`, `muteAccount`/`unmuteAccount`, `blockAccount`/`unblockAccount`. These mutations patch the cached post/profile in `onMutate`, restore in `onError`, and revalidate in `onSettled`. Complex writes (compose, edit-profile, blob-upload-then-attach, mark-notifications-read) are wait-and-invalidate — they show honest pending state and do not pretend.

**Invalidation breadth.** Writes that affect feed visibility (`createPost`, `deletePost`) invalidate broadly (every `['<did>', 'feed', ...]` query and any thread query that could contain the post). Engagement writes invalidate surgically (the specific post or profile cache key).

The agent porting code does not invent which writes get optimistic treatment — the list above is exhaustive; everything else is wait-and-invalidate.

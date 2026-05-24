import {
  useInfiniteQuery,
  type QueryKey,
} from '@tanstack/react-query';

export interface InfiniteListPage<TItem> {
  items: TItem[];
  cursor?: string;
}

export function useInfiniteList<TItem>(opts: {
  queryKey: QueryKey;
  enabled?: boolean;
  queryFn: (ctx: {
    pageParam?: string;
  }) => Promise<InfiniteListPage<TItem>>;
}): {
  items: TItem[];
  loadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const query = useInfiniteQuery({
    queryKey: opts.queryKey,
    enabled: opts.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => opts.queryFn({ pageParam }),
    getNextPageParam: (lastPage) => lastPage.cursor,
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return {
    items,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    hasMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
    refetch: () => {
      void query.refetch();
    },
  };
}

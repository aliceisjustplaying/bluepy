import {
  useInfiniteQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useRef } from 'react';

export interface InfiniteListPage<TItem> {
  items: TItem[];
  cursor?: string;
}

export interface InfiniteListSnapshot<TItem> {
  items: TItem[];
  hasMore: boolean;
}

function flattenItems<TItem>(
  data: { pages: InfiniteListPage<TItem>[] } | undefined,
) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

function snapshotFromData<TItem>(
  data: { pages: InfiniteListPage<TItem>[] } | undefined,
): InfiniteListSnapshot<TItem> {
  return {
    items: flattenItems(data),
    hasMore: Boolean(data?.pages.at(-1)?.cursor),
  };
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
  refetchItems: () => Promise<InfiniteListSnapshot<TItem>>;
  loadMoreItems: () => Promise<InfiniteListSnapshot<TItem>>;
} {
  const qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: opts.queryKey,
    enabled: opts.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => opts.queryFn({ pageParam }),
    getNextPageParam: (lastPage) => lastPage.cursor,
  });
  const queryRef = useRef(query);
  const loadingMoreItemsRef = useRef<
    Promise<InfiniteListSnapshot<TItem>> | undefined
  >(undefined);
  queryRef.current = query;

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
    refetchItems: async () => {
      await qc.resetQueries({ queryKey: opts.queryKey, exact: true });
      const result = await queryRef.current.refetch();
      if (result.error) throw result.error;
      return snapshotFromData(result.data);
    },
    loadMoreItems: async () => {
      const cached = qc.getQueryData<{ pages: InfiniteListPage<TItem>[] }>(
        opts.queryKey,
      );
      if (!cached) {
        const result = await queryRef.current.refetch();
        if (result.error) throw result.error;
        return snapshotFromData(result.data);
      }
      const hasCachedNextPage = Boolean(cached?.pages.at(-1)?.cursor);
      if (!hasCachedNextPage) {
        return snapshotFromData(cached);
      }
      if (loadingMoreItemsRef.current) return loadingMoreItemsRef.current;
      const latestQuery = queryRef.current;
      try {
        const loadPromise = (async () => {
          const result = await latestQuery.fetchNextPage();
          if (result.error) throw result.error;
          return snapshotFromData(result.data);
        })();
        loadingMoreItemsRef.current = loadPromise;
        return await loadPromise;
      } finally {
        loadingMoreItemsRef.current = undefined;
      }
    },
  };
}

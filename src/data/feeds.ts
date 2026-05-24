import {
  type AppBskyFeedDefs,
  type AppBskyUnspeccedDefs,
} from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { blueskyOnlyReadMode, feedReadMode } from './_internal/dispatch';
import { postHasMedia } from './_internal/post-media';
import { primePosts } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type AtUri, type FeedFilter, type ViewerScope } from './keys';
import { useSearchPosts, type SearchPostsOptions } from './search';
import { useViewerScope } from './scope';

export interface FeedSource<TItem> {
  items: readonly TItem[];
  loadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function timelineFeedQueryOptions(
  activeDid: string | null | undefined,
  scope: ViewerScope,
  hasAuthenticatedReadAgent = true,
): {
  queryKey: readonly unknown[];
  enabled: boolean;
} {
  return {
    queryKey: activeDid ? keys.timeline(scope) : (['timeline', 'disabled'] as const),
    enabled: Boolean(activeDid && hasAuthenticatedReadAgent),
  };
}

export interface TimelineFeedItem {
  uri: AtUri;
  reason?: AppBskyFeedDefs.FeedViewPost['reason'];
  reply?: AppBskyFeedDefs.FeedViewPost['reply'];
}

function feedItemFromView(
  item: AppBskyFeedDefs.FeedViewPost,
): TimelineFeedItem {
  return {
    uri: item.post.uri,
    reason: item.reason,
    reply: item.reply,
  };
}

export function useTimelineFeed() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<TimelineFeedItem>({
    ...timelineFeedQueryOptions(
      activeDid,
      scope,
      Boolean(clients.activeAppViewProxyAgent),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.getTimeline({ limit: 30, cursor: pageParam });
      primePosts(qc, scope, res.data);
      return {
        items: res.data.feed.map(feedItemFromView),
        cursor: res.data.cursor,
      };
    },
  });
}

function authorFeedFilter(
  filter?: FeedFilter,
): 'posts_with_replies' | 'posts_and_author_threads' | 'posts_with_media' {
  if (filter === 'media') return 'posts_with_media';
  if (filter === 'posts') return 'posts_and_author_threads';
  return 'posts_with_replies';
}

export function useProfileFeed(actor: string | undefined, filter?: FeedFilter) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();
  const apiFilter = authorFeedFilter(filter);

  return useInfiniteList<TimelineFeedItem>({
    queryKey: actor
      ? keys.profileFeed(scope, actor, filter)
      : ['profileFeed', 'disabled'],
    enabled: Boolean(
      actor && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.getAuthorFeed({
        actor: actor!,
        limit: 30,
        cursor: pageParam,
        filter: apiFilter,
        includePins: apiFilter === 'posts_and_author_threads',
      });
      primePosts(qc, scope, res.data);
      return {
        items: res.data.feed.map(feedItemFromView),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useGeneratorFeed(generator: AtUri | undefined) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<TimelineFeedItem>({
    queryKey: generator ? keys.feed(scope, generator) : ['feed', 'disabled'],
    enabled: Boolean(
      generator && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.getFeed({
        feed: generator!,
        limit: 30,
        cursor: pageParam,
      });
      primePosts(qc, scope, res.data);
      return {
        items: res.data.feed.map(feedItemFromView),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useTrendingTopics(): {
  data?: AppBskyUnspeccedDefs.TrendingTopic[];
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();

  const query = useQuery({
    queryKey: [...scope, 'trendingTopics'] as const,
    enabled: Boolean(activeDid ? clients.bskyAppViewProxyAgent : true),
    staleTime: 60_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, blueskyOnlyReadMode(activeDid));
      const res = await agent.app.bsky.unspecced.getTrendingTopics({
        limit: 25,
        ...(activeDid ? { viewer: activeDid } : {}),
      });
      return res.data.topics;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

const MIN_ACCOUNT_SEARCH_YEAR = 1983;

export function buildAccountMonthSearchQuery(
  acct: string,
  month: string,
): { query: string; options: SearchPostsOptions } | undefined {
  const isValidMonth = /^\d{4}-[01]\d$/.test(month);
  const year = Number(month.split('-')[0]);
  if (!isValidMonth || year < MIN_ACCOUNT_SEARCH_YEAR) {
    return undefined;
  }

  const [_year, _month] = month.split('-');
  const yearNum = parseInt(_year, 10);
  const monthNum = parseInt(_month, 10);
  const nextYear = monthNum === 12 ? yearNum + 1 : yearNum;
  const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
  const afterStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
  const beforeStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return {
    query: `from:${acct}`,
    options: {
      since: afterStr,
      until: beforeStr,
    },
  };
}

function isReasonRepost(
  reason: AppBskyFeedDefs.FeedViewPost['reason'],
): boolean {
  return reason?.$type === 'app.bsky.feed.defs#reasonRepost';
}

export function useAccountStatusesFeed(opts: {
  actor: string | undefined;
  acct: string | undefined;
  filter?: FeedFilter;
  month?: string | null;
  tagged?: string | null;
  excludeBoosts?: boolean;
  media?: boolean;
}): FeedSource<TimelineFeedItem | string> {
  const scope = useViewerScope();
  const qc = useQueryClient();
  const searchQuery = useMemo((): {
    query: string;
    options?: SearchPostsOptions;
  } | undefined => {
    if (opts.month && opts.acct) {
      return buildAccountMonthSearchQuery(opts.acct, opts.month);
    }
    if (opts.tagged && opts.acct) {
      return { query: `from:${opts.acct} #${opts.tagged}` };
    }
    return undefined;
  }, [opts.month, opts.tagged, opts.acct]);

  const profileSource = useProfileFeed(
    searchQuery ? undefined : opts.actor,
    searchQuery ? undefined : opts.filter,
  );
  const searchSource = useSearchPosts(searchQuery?.query, searchQuery?.options);
  const source = searchQuery ? searchSource : profileSource;

  return useMemo(() => {
    if (!opts.excludeBoosts && !opts.media) {
      return source;
    }
    return {
      ...source,
      items: source.items.filter((item) => {
        const normalized =
          typeof item === 'string' ? { uri: item } : item;
        if (opts.excludeBoosts && isReasonRepost(normalized.reason)) {
          return false;
        }
        if (!opts.media) return true;
        return postHasMedia(
          qc.getQueryData<AppBskyFeedDefs.PostView>(
            keys.post(scope, normalized.uri),
          ),
        );
      }),
    };
  }, [qc, scope, source, opts.excludeBoosts, opts.media]);
}

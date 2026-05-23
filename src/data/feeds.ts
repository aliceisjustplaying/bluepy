import type { AppBskyFeedDefs, AppBskyUnspeccedDefs } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { blueskyOnlyReadMode, feedReadMode } from './_internal/dispatch';
import { primePosts } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type AtUri, type FeedFilter, type ViewerScope } from './keys';
import { useViewerScope } from './scope';

export function timelineFeedQueryOptions(
  activeDid: string | null | undefined,
  scope: ViewerScope,
): {
  queryKey: readonly unknown[];
  enabled: boolean;
} {
  return {
    queryKey: activeDid ? keys.timeline(scope) : (['timeline', 'disabled'] as const),
    enabled: Boolean(activeDid),
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
    ...timelineFeedQueryOptions(activeDid, scope),
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
    enabled: Boolean(actor),
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
    enabled: Boolean(generator),
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

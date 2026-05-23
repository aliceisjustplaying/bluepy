import type { AppBskyFeedDefs } from '@atproto/api';
import { useQuery } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { blueskyOnlyReadMode, feedReadMode } from './_internal/dispatch';
import { getReadAgent } from './clients';
import { type AtUri } from './keys';
import { useViewerScope } from './scope';

export function useFeedGenerator(uri: AtUri | undefined): {
  data?: AppBskyFeedDefs.GeneratorView;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();

  const query = useQuery({
    queryKey: uri
      ? ([...scope, 'feedGenerator', uri] as const)
      : ['feedGenerator', 'disabled'],
    enabled: Boolean(uri),
    staleTime: 60_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.getFeedGenerator({ feed: uri! });
      return res.data.view;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useFeedGeneratorsByUri(uris: readonly AtUri[]): {
  data?: AppBskyFeedDefs.GeneratorView[];
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();

  const query = useQuery({
    queryKey: [...scope, 'feedGenerators', ...uris] as const,
    enabled: uris.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.getFeedGenerators({
        feeds: [...uris],
      });
      return res.data.feeds;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useSuggestedFeedGenerators(): {
  data?: AppBskyFeedDefs.GeneratorView[];
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();

  const query = useQuery({
    queryKey: [...scope, 'suggestedFeedGenerators'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, blueskyOnlyReadMode(activeDid));
      const res = await agent.app.bsky.unspecced.getSuggestedFeeds({
        limit: 25,
      });
      return res.data.feeds;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

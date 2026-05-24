import type { AppBskyGraphDefs } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { primePosts } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

export function useList(listUri: AtUri | undefined) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();

  const query = useQuery({
    queryKey: listUri ? [...scope, 'list', listUri] as const : ['list', 'disabled'],
    enabled: Boolean(
      listUri && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    staleTime: 60_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.graph.getList({ list: listUri! });
      return res.data.list;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useListFeed(listUri: AtUri | undefined) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<string>({
    queryKey: listUri ? keys.listFeed(scope, listUri) : ['listFeed', 'disabled'],
    enabled: Boolean(
      listUri && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.getListFeed({
        list: listUri!,
        limit: 30,
        cursor: pageParam,
      });
      primePosts(qc, scope, res.data);
      return {
        items: res.data.feed.map((item) => item.post.uri),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useLists(actor: string | undefined) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();

  return useInfiniteList<AppBskyGraphDefs.ListView>({
    queryKey: actor ? [...scope, 'lists', actor] as const : ['lists', 'disabled'],
    enabled: Boolean(
      actor && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.graph.getLists({
        actor: actor!,
        limit: 30,
        cursor: pageParam,
      });
      return {
        items: res.data.lists,
        cursor: res.data.cursor,
      };
    },
  });
}

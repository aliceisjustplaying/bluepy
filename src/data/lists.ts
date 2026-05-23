import type { AppBskyGraphDefs } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { primeProfiles } from './_internal/prime';
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
    enabled: Boolean(listUri),
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
    queryKey: listUri ? keys.feed(scope, listUri) : ['listFeed', 'disabled'],
    enabled: Boolean(listUri),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.getListFeed({
        list: listUri!,
        limit: 30,
        cursor: pageParam,
      });
      primeProfiles(qc, scope, {
        actors: res.data.feed.map((item) => item.post.author),
      });
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
    queryKey: [...scope, 'lists', actor ?? ''] as const,
    enabled: Boolean(actor),
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

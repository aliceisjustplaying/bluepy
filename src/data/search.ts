import type { AppBskyFeedDefs } from '@atproto/api';
import { useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { primePosts, primeProfiles } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

export function useSearchPosts(query: string | undefined) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<AtUri>({
    queryKey: keys.search(scope, query ?? '', 'posts'),
    enabled: Boolean(query && query.trim().length > 0),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.searchPosts({
        q: query!,
        limit: 25,
        cursor: pageParam,
      });
      primePosts(qc, scope, res.data);
      return {
        items: res.data.posts.map((post) => post.uri),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useSearchActors(query: string | undefined) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<string>({
    queryKey: keys.search(scope, query ?? '', 'actors'),
    enabled: Boolean(query && query.trim().length > 0),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.searchActors({
        q: query!,
        limit: 25,
        cursor: pageParam,
      });
      primeProfiles(qc, scope, res.data);
      return {
        items: res.data.actors.map((actor) => actor.did),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useActorLikes(actor: string | undefined) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<AtUri>({
    queryKey: [...scope, 'actorLikes', actor ?? ''] as const,
    enabled: Boolean(actor),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.getActorLikes({
        actor: actor!,
        limit: 30,
        cursor: pageParam,
      });
      primePosts(qc, scope, res.data);
      return {
        items: res.data.feed.map(
          (item: AppBskyFeedDefs.FeedViewPost) => item.post.uri,
        ),
        cursor: res.data.cursor,
      };
    },
  });
}

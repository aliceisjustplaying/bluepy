import type {
  AppBskyActorDefs,
  AppBskyFeedDefs,
  AppBskyFeedSearchPosts,
} from '@atproto/api';
import { useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { postHasMedia } from './_internal/post-media';
import { primePosts, primeProfiles } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

export interface SearchPostsOptions {
  since?: string;
  until?: string;
}

export function useSearchPosts(
  query: string | undefined,
  options?: SearchPostsOptions,
) {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<AtUri>({
    queryKey: [
      ...keys.search(scope, query ?? '', 'posts'),
      options?.since ?? '',
      options?.until ?? '',
    ] as const,
    enabled: Boolean(
      query &&
        query.trim().length > 0 &&
        (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const params: AppBskyFeedSearchPosts.QueryParams = {
        q: query!,
        limit: 25,
        cursor: pageParam,
        ...(options?.since ? { since: options.since } : {}),
        ...(options?.until ? { until: options.until } : {}),
      };
      const res = await agent.app.bsky.feed.searchPosts(params);
      primePosts(qc, scope, res.data);
      return {
        items: res.data.posts.map((post) => post.uri),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useHashtagFeed(
  tags: readonly string[] | undefined,
  options?: { onlyMedia?: boolean },
): ReturnType<typeof useInfiniteList<AtUri>> {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();
  const query = tags
    ?.filter(Boolean)
    .map((tag) => `#${tag.replace(/^#/, '')}`)
    .join(' ');

  return useInfiniteList<AtUri>({
    queryKey: query
      ? [...keys.search(scope, query, 'posts'), options?.onlyMedia ? 'media' : 'all'] as const
      : ['hashtagFeed', 'disabled'],
    enabled: Boolean(
      query && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.feed.searchPosts({
        q: query!,
        limit: 25,
        cursor: pageParam,
      });
      primePosts(qc, scope, res.data);
      let items = res.data.posts.map((post) => post.uri);
      if (options?.onlyMedia) {
        items = res.data.posts
          .filter((post) => postHasMedia(post))
          .map((post) => post.uri);
      }
      return {
        items,
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

  return useInfiniteList<
    AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewBasic
  >({
    queryKey: keys.search(scope, query ?? '', 'actors'),
    enabled: Boolean(
      query &&
        query.trim().length > 0 &&
        (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const q = query!;
      const [searchRes, typeaheadRes] = await Promise.all([
        agent.searchActors({
          q,
          limit: 25,
          cursor: pageParam,
        }),
        pageParam
          ? Promise.resolve(undefined)
          : agent.searchActorsTypeahead({ q, limit: 10 }).catch(() => undefined),
      ]);
      const searchActors = searchRes.data.actors;
      const typeaheadActors = typeaheadRes?.data.actors ?? [];
      const normalizedQuery = q.trim().replace(/^[@＠]/, '').toLowerCase();
      const leadingActor = typeaheadActors.find((actor) => {
        const handle = actor.handle.toLowerCase();
        const displayName = actor.displayName?.toLowerCase() ?? '';
        return (
          handle.startsWith(normalizedQuery) ||
          displayName.startsWith(normalizedQuery)
        );
      });
      const actors = leadingActor
        ? [
            leadingActor,
            ...searchActors.filter((actor) => actor.did !== leadingActor.did),
          ]
        : searchActors;
      primeProfiles(qc, scope, { actors });
      return {
        items: actors,
        cursor: searchRes.data.cursor,
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
    enabled: Boolean(
      actor && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
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

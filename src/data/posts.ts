import type { AppBskyFeedDefs } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { primePosts } from './_internal/prime';
import { getReadAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

const DIRECT_ROUTE_STALE_TIME = 60_000;

export async function fetchPost(
  uri: AtUri,
  clients: ReturnType<typeof useClients>,
  activeDid: string | null,
): Promise<AppBskyFeedDefs.PostView> {
  const agent = getReadAgent(clients, feedReadMode(activeDid));
  const res = await agent.getPosts({ uris: [uri] });
  const post = res.data.posts[0];
  if (!post) {
    throw new Error('Post not found');
  }
  return post;
}

export async function fetchPostThread(
  uri: AtUri,
  clients: ReturnType<typeof useClients>,
  activeDid: string | null,
  depth = 6,
): Promise<AppBskyFeedDefs.ThreadViewPost> {
  const agent = getReadAgent(clients, feedReadMode(activeDid));
  const res = await agent.getPostThread({
    uri,
    depth,
    parentHeight: depth,
  });
  if (
    !res.data.thread ||
    res.data.thread.$type === 'app.bsky.feed.defs#blockedPost' ||
    res.data.thread.$type === 'app.bsky.feed.defs#notFoundPost'
  ) {
    throw new Error('Thread not found');
  }
  return res.data.thread as AppBskyFeedDefs.ThreadViewPost;
}

export function usePost(uri: AtUri | undefined): {
  data?: AppBskyFeedDefs.PostView;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: uri ? keys.post(scope, uri) : ['post', 'disabled'],
    enabled: Boolean(uri),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const post = await fetchPost(uri!, clients, activeDid);
      primePosts(qc, scope, { posts: [post] });
      return qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scope, uri!)) ?? post;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function usePostRoute(uri: AtUri | undefined): {
  data?: AppBskyFeedDefs.PostView;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: uri ? keys.post(scope, uri) : ['post', 'disabled'],
    enabled: Boolean(uri),
    staleTime: DIRECT_ROUTE_STALE_TIME,
    refetchOnMount: 'always',
    queryFn: async () => {
      const post = await fetchPost(uri!, clients, activeDid);
      primePosts(qc, scope, { posts: [post] });
      return qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scope, uri!)) ?? post;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useThread(
  uri: AtUri | undefined,
  depth = 6,
): {
  data?: AppBskyFeedDefs.ThreadViewPost;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: uri ? keys.thread(scope, uri) : ['thread', 'disabled'],
    enabled: Boolean(uri),
    staleTime: DIRECT_ROUTE_STALE_TIME,
    refetchOnMount: 'always',
    queryFn: async () => {
      const thread = await fetchPostThread(uri!, clients, activeDid, depth);
      primePosts(qc, scope, { thread });
      return thread;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

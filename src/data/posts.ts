import type { AppBskyFeedDefs } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { primePosts } from './_internal/prime';
import { getReadAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

const DIRECT_ROUTE_STALE_TIME = 60_000;

function isThreadViewPost(
  node: unknown,
): node is AppBskyFeedDefs.ThreadViewPost {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { $type?: string }).$type === 'app.bsky.feed.defs#threadViewPost'
  );
}

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
    res.data.thread.$type === 'app.bsky.feed.defs#blockedPost' ||
    res.data.thread.$type === 'app.bsky.feed.defs#notFoundPost' ||
    !isThreadViewPost(res.data.thread)
  ) {
    throw new Error('Thread not found');
  }
  return res.data.thread;
}

function makePlaceholderThread(
  post: AppBskyFeedDefs.PostView | undefined,
): AppBskyFeedDefs.ThreadViewPost | undefined {
  if (!post) return undefined;
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post,
    replies: [],
  };
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
    enabled: Boolean(uri && (activeDid ? clients.activeAppViewProxyAgent : true)),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const postUri = uri;
      if (!postUri) throw new Error('Post URI required');
      const post = await fetchPost(postUri, clients, activeDid);
      primePosts(qc, scope, { posts: [post] });
      return qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scope, postUri)) ?? post;
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
    enabled: Boolean(uri && (activeDid ? clients.activeAppViewProxyAgent : true)),
    staleTime: DIRECT_ROUTE_STALE_TIME,
    refetchOnMount: 'always',
    queryFn: async () => {
      const postUri = uri;
      if (!postUri) throw new Error('Post URI required');
      const post = await fetchPost(postUri, clients, activeDid);
      primePosts(qc, scope, { posts: [post] });
      return qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scope, postUri)) ?? post;
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
    enabled: Boolean(uri && (activeDid ? clients.activeAppViewProxyAgent : true)),
    staleTime: DIRECT_ROUTE_STALE_TIME,
    refetchOnMount: 'always',
    placeholderData: () =>
      uri
        ? makePlaceholderThread(
            qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scope, uri)),
          )
        : undefined,
    queryFn: async () => {
      const threadUri = uri;
      if (!threadUri) throw new Error('Post URI required');
      const thread = await fetchPostThread(threadUri, clients, activeDid, depth);
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

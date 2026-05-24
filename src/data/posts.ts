import type { AppBskyFeedDefs, AppBskyFeedPost } from '@atproto/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import {
  invalidateCachedPostForViewer,
  invalidateCachedThreadPostsForViewer,
  invalidatePostListsForViewer,
  patchCachedPostForViewer,
  patchCachedThreadPostsForViewer,
  removeCachedPostForViewer,
} from './_internal/mutation-cache';
import { patchPostLike, patchPostRepost } from './_internal/patchers';
import { primePosts } from './_internal/prime';
import { getReadAgent, getWriteAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

const DIRECT_ROUTE_STALE_TIME = 60_000;

interface PostStrongRef {
  uri: AtUri;
  cid: string;
}

interface DeleteRecordVars {
  uri: AtUri;
}

interface CreatePostVars {
  record: AppBskyFeedPost.Record;
  repoDid?: string;
}

interface LikeVars extends PostStrongRef {
  likeUri?: AtUri;
}

interface RepostVars extends PostStrongRef {
  repostUri?: AtUri;
}

interface MutationContext {
  rollback?: () => void;
}

interface RecordListingAgent {
  com: {
    atproto: {
      repo: {
        listRecords: (params: {
          repo: string;
          collection: string;
          limit: number;
          cursor?: string;
        }) => Promise<{
          data: {
            cursor?: string;
            records: { uri: string; value: unknown }[];
          };
        }>;
      };
    };
  };
}

function recordUriForCollection(
  uri: string | undefined,
  collection: string,
): string | undefined {
  return uri?.includes(`/${collection}/`) ? uri : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function findViewerRecordUriForSubject(
  agent: RecordListingAgent,
  repo: string | null,
  collection: 'app.bsky.feed.like' | 'app.bsky.feed.repost',
  subjectUri: string,
): Promise<string | undefined> {
  if (!repo) return undefined;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let pages = 0;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo,
      collection,
      limit: 100,
      cursor,
    });
    const uri = res.data.records.find((record) => {
      const value = record.value;
      if (!isRecord(value) || !isRecord(value.subject)) return false;
      return value.subject.uri === subjectUri;
    })?.uri;
    if (uri) return uri;
    const nextCursor = res.data.cursor;
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      return undefined;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
    pages += 1;
    if (pages >= 50) return undefined;
  } while (cursor);
  return undefined;
}

function atprotoRkey(uri: string): string {
  return uri.split('/').pop() ?? '';
}

export function postDeleteRecordArgs(
  uri: string,
  activeDid: string | null,
): { repo: string; rkey: string } {
  if (!activeDid) throw new Error('Active DID required');
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) throw new Error('Post URI required');
  const [, repo, collection] = match;
  if (repo !== activeDid || collection !== 'app.bsky.feed.post') {
    throw new Error('Can only delete posts authored by the active account');
  }
  return { repo, rkey: atprotoRkey(uri) };
}

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
    enabled: Boolean(
      uri && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const postUri = uri;
      if (!postUri) throw new Error('Post URI required');
      const post = await fetchPost(postUri, clients, activeDid);
      primePosts(qc, scope, { posts: [post] });
      return (
        qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scope, postUri)) ??
        post
      );
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
    enabled: Boolean(
      uri && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    staleTime: DIRECT_ROUTE_STALE_TIME,
    refetchOnMount: 'always',
    queryFn: async () => {
      const postUri = uri;
      if (!postUri) throw new Error('Post URI required');
      const post = await fetchPost(postUri, clients, activeDid);
      primePosts(qc, scope, { posts: [post] });
      return (
        qc.getQueryData<AppBskyFeedDefs.PostView>(keys.post(scope, postUri)) ??
        post
      );
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useLikePost() {
  const clients = useClients();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<{ uri: AtUri }, Error, LikeVars, MutationContext>({
    mutationFn: async ({ uri, cid }) => {
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      const like = await agent.like(uri, cid);
      return { uri: like.uri };
    },
    onMutate: async ({ uri }) => ({
      rollback: await patchCachedPostForViewer(qc, scope, uri, (post) =>
        patchPostLike(post, true),
      ),
    }),
    onSuccess: ({ uri: likeUri }, { uri }) =>
      patchCachedPostForViewer(qc, scope, uri, (post) =>
        patchPostLike(post, true, likeUri),
      ),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { uri }) =>
      invalidateCachedPostForViewer(qc, scope, uri),
  });
}

export function useUnlikePost() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useMutation<null, Error, LikeVars, MutationContext>({
    mutationFn: async ({ uri, likeUri }) => {
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      const currentLikeUri =
        recordUriForCollection(likeUri, 'app.bsky.feed.like') ??
        recordUriForCollection(
          (await fetchPost(uri, clients, activeDid)).viewer?.like,
          'app.bsky.feed.like',
        ) ??
        (await findViewerRecordUriForSubject(
          agent,
          activeDid,
          'app.bsky.feed.like',
          uri,
        ));
      if (!currentLikeUri) throw new Error('Like URI required');
      await agent.deleteLike(currentLikeUri);
      return null;
    },
    onMutate: async ({ uri }) => ({
      rollback: await patchCachedPostForViewer(qc, scope, uri, (post) =>
        patchPostLike(post, false),
      ),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { uri }) =>
      invalidateCachedPostForViewer(qc, scope, uri),
  });
}

export function useRepostPost() {
  const clients = useClients();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<{ uri: AtUri }, Error, RepostVars, MutationContext>({
    mutationFn: async ({ uri, cid }) => {
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      const repost = await agent.repost(uri, cid);
      return { uri: repost.uri };
    },
    onMutate: async ({ uri }) => ({
      rollback: await patchCachedPostForViewer(qc, scope, uri, (post) =>
        patchPostRepost(post, true),
      ),
    }),
    onSuccess: ({ uri: repostUri }, { uri }) =>
      patchCachedPostForViewer(qc, scope, uri, (post) =>
        patchPostRepost(post, true, repostUri),
      ),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { uri }) =>
      invalidateCachedPostForViewer(qc, scope, uri),
  });
}

export function useUnrepostPost() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useMutation<null, Error, RepostVars, MutationContext>({
    mutationFn: async ({ uri, repostUri }) => {
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      const currentRepostUri =
        recordUriForCollection(repostUri, 'app.bsky.feed.repost') ??
        recordUriForCollection(
          (await fetchPost(uri, clients, activeDid)).viewer?.repost,
          'app.bsky.feed.repost',
        ) ??
        (await findViewerRecordUriForSubject(
          agent,
          activeDid,
          'app.bsky.feed.repost',
          uri,
        ));
      if (!currentRepostUri) throw new Error('Repost URI required');
      await agent.deleteRepost(currentRepostUri);
      return null;
    },
    onMutate: async ({ uri }) => ({
      rollback: await patchCachedPostForViewer(qc, scope, uri, (post) =>
        patchPostRepost(post, false),
      ),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { uri }) =>
      invalidateCachedPostForViewer(qc, scope, uri),
  });
}

export function useDeletePost() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useMutation<null, Error, DeleteRecordVars>({
    mutationFn: async ({ uri }) => {
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      await agent.app.bsky.feed.post.delete(postDeleteRecordArgs(uri, activeDid));
      return null;
    },
    onSuccess: (_data, { uri }) => {
      removeCachedPostForViewer(qc, scope, uri);
    },
    onSettled: () => invalidatePostListsForViewer(qc, scope),
  });
}

export function useMuteThread() {
  const clients = useClients();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<null, Error, { uri: AtUri }, MutationContext>({
    mutationFn: async ({ uri }) => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      await agent.app.bsky.graph.muteThread({ root: uri });
      return null;
    },
    onMutate: async ({ uri }) => ({
      rollback: await patchCachedThreadPostsForViewer(qc, scope, uri, (post) => ({
        ...post,
        viewer: { ...post.viewer, threadMuted: true },
      })),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: async (_data, _err, { uri }) => {
      await Promise.all([
        invalidateCachedThreadPostsForViewer(qc, scope, uri),
        invalidatePostListsForViewer(qc, scope),
      ]);
    },
  });
}

export function useUnmuteThread() {
  const clients = useClients();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<null, Error, { uri: AtUri }, MutationContext>({
    mutationFn: async ({ uri }) => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      await agent.app.bsky.graph.unmuteThread({ root: uri });
      return null;
    },
    onMutate: async ({ uri }) => ({
      rollback: await patchCachedThreadPostsForViewer(qc, scope, uri, (post) => ({
        ...post,
        viewer: { ...post.viewer, threadMuted: false },
      })),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: async (_data, _err, { uri }) => {
      await Promise.all([
        invalidateCachedThreadPostsForViewer(qc, scope, uri),
        invalidatePostListsForViewer(qc, scope),
      ]);
    },
  });
}

export function useCreatePost() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useMutation<{ uri: AtUri; cid: string }, Error, CreatePostVars>({
    mutationFn: async ({ record, repoDid }) => {
      const repo = repoDid ?? activeDid;
      if (!repo) throw new Error('Author DID required');
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      const res = await agent.app.bsky.feed.post.create({ repo }, record);
      return { uri: res.uri, cid: res.cid };
    },
    onSettled: () => invalidatePostListsForViewer(qc, scope),
  });
}

export function useThread(
  uri: AtUri | undefined,
  depth = 6,
): {
  data?: AppBskyFeedDefs.ThreadViewPost;
  isLoading: boolean;
  isPlaceholderData: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: uri ? keys.thread(scope, uri) : ['thread', 'disabled'],
    enabled: Boolean(
      uri && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
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
      const thread = await fetchPostThread(
        threadUri,
        clients,
        activeDid,
        depth,
      );
      primePosts(qc, scope, { thread });
      return thread;
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error instanceof Error ? query.error : null,
  };
}

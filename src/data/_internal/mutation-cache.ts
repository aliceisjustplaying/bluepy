import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { PostPatcher, ProfilePatcher } from './patchers';
import type { ViewerScope } from '../keys';

type Snapshot<T> = readonly [QueryKey, T | undefined];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPostKeyForViewer(
  queryKey: QueryKey,
  scope: ViewerScope,
  uri: string,
): boolean {
  return (
    queryKey[0] === scope[0] && queryKey[3] === 'post' && queryKey[4] === uri
  );
}

function isAnyPostKeyForViewer(queryKey: QueryKey, scope: ViewerScope): boolean {
  return queryKey[0] === scope[0] && queryKey[3] === 'post';
}

function postBelongsToThread(
  post: AppBskyFeedDefs.PostView | undefined,
  rootUri: string,
): boolean {
  if (!post) return false;
  if (post.uri === rootUri) return true;
  const reply = isRecord(post.record) ? post.record.reply : undefined;
  const root = isRecord(reply) ? reply.root : undefined;
  return isRecord(root) && root.uri === rootUri;
}

function isProfileKeyForViewer(
  queryKey: QueryKey,
  scope: ViewerScope,
  did: string,
): boolean {
  return (
    queryKey[0] === scope[0] &&
    queryKey[3] === 'profileByDid' &&
    queryKey[4] === did
  );
}

export async function patchCachedPostForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
  uri: string,
  patcher: PostPatcher,
): Promise<() => void> {
  await queryClient.cancelQueries({
    predicate: (query) => isPostKeyForViewer(query.queryKey, scope, uri),
  });

  const snapshots: Snapshot<AppBskyFeedDefs.PostView>[] =
    queryClient.getQueriesData<AppBskyFeedDefs.PostView>({
      predicate: (query) => isPostKeyForViewer(query.queryKey, scope, uri),
    });

  for (const [queryKey, post] of snapshots) {
    if (post) queryClient.setQueryData(queryKey, patcher(post));
  }

  return () => {
    for (const [queryKey, post] of snapshots) {
      queryClient.setQueryData(queryKey, post);
    }
  };
}

export async function patchCachedThreadPostsForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
  rootUri: string,
  patcher: PostPatcher,
): Promise<() => void> {
  await queryClient.cancelQueries({
    predicate: (query) => isAnyPostKeyForViewer(query.queryKey, scope),
  });

  const snapshots: Snapshot<AppBskyFeedDefs.PostView>[] =
    queryClient.getQueriesData<AppBskyFeedDefs.PostView>({
      predicate: (query) =>
        isAnyPostKeyForViewer(query.queryKey, scope) &&
        postBelongsToThread(query.state.data as AppBskyFeedDefs.PostView, rootUri),
    });

  for (const [queryKey, post] of snapshots) {
    if (post) queryClient.setQueryData(queryKey, patcher(post));
  }

  return () => {
    for (const [queryKey, post] of snapshots) {
      queryClient.setQueryData(queryKey, post);
    }
  };
}

export async function patchCachedProfileForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
  did: string,
  patcher: ProfilePatcher,
): Promise<() => void> {
  await queryClient.cancelQueries({
    predicate: (query) => isProfileKeyForViewer(query.queryKey, scope, did),
  });

  const snapshots = queryClient.getQueriesData<
    AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed
  >({
    predicate: (query) => isProfileKeyForViewer(query.queryKey, scope, did),
  });

  for (const [queryKey, profile] of snapshots) {
    if (profile) queryClient.setQueryData(queryKey, patcher(profile));
  }

  return () => {
    for (const [queryKey, profile] of snapshots) {
      queryClient.setQueryData(queryKey, profile);
    }
  };
}

export function invalidateCachedPostForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
  uri: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => isPostKeyForViewer(query.queryKey, scope, uri),
  });
}

export function invalidateCachedThreadPostsForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
  rootUri: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      isAnyPostKeyForViewer(query.queryKey, scope) &&
      postBelongsToThread(query.state.data as AppBskyFeedDefs.PostView, rootUri),
  });
}

export function removeCachedPostForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
  uri: string,
): void {
  queryClient.removeQueries({
    predicate: (query) => isPostKeyForViewer(query.queryKey, scope, uri),
  });
}

export function invalidateCachedProfileForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
  did: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => isProfileKeyForViewer(query.queryKey, scope, did),
  });
}

export function invalidatePostListsForViewer(
  queryClient: QueryClient,
  scope: ViewerScope,
): Promise<void> {
  const listSegments = new Set([
    'timeline',
    'feed',
    'listFeed',
    'thread',
    'profileFeed',
    'notifications',
    'bookmarks',
  ]);
  return queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === scope[0] &&
      typeof query.queryKey[3] === 'string' &&
      listSegments.has(query.queryKey[3]),
  });
}

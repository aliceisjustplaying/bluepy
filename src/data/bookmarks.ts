import { AppBskyFeedDefs } from '@atproto/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { setBookmarkOverride } from '../utils/bookmark-overrides';

import { feedReadMode } from './_internal/dispatch';
import {
  invalidateCachedPostForViewer,
  patchCachedPostForViewer,
} from './_internal/mutation-cache';
import { patchPostBookmark } from './_internal/patchers';
import { primePosts } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent, getWriteAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

interface BookmarkVars {
  uri: AtUri;
  cid: string;
}

interface BookmarkMutationContext {
  rollback?: () => void;
}

export function useBookmarks() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<AtUri>({
    queryKey: keys.bookmarks(scope),
    enabled: Boolean(activeDid && clients.activeAppViewProxyAgent),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.bookmark.getBookmarks({
        limit: 30,
        cursor: pageParam,
      });
      const posts = res.data.bookmarks.flatMap((bookmark) => {
        if (!AppBskyFeedDefs.isPostView(bookmark.item)) return [];
        setBookmarkOverride(activeDid, bookmark.item.uri, true);
        return [
          {
            ...bookmark.item,
            viewer: {
              ...bookmark.item.viewer,
              bookmarked: true,
            },
          },
        ];
      });
      primePosts(qc, scope, { posts });
      return {
        items: posts.map((post) => post.uri),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useBookmarkPost() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useMutation<null, Error, BookmarkVars, BookmarkMutationContext>({
    mutationFn: async ({ uri, cid }) => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      await agent.app.bsky.bookmark.createBookmark({ uri, cid });
      return null;
    },
    onMutate: async ({ uri }) => {
      setBookmarkOverride(activeDid, uri, true);
      return {
        rollback: await patchCachedPostForViewer(qc, scope, uri, (post) =>
          patchPostBookmark(post, true),
        ),
      };
    },
    onError: (_err, { uri }, context) => {
      setBookmarkOverride(activeDid, uri, false);
      context?.rollback?.();
    },
    onSettled: (_data, _err, { uri }) =>
      invalidateCachedPostForViewer(qc, scope, uri),
  });
}

export function useUnbookmarkPost() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useMutation<
    null,
    Error,
    Pick<BookmarkVars, 'uri'>,
    BookmarkMutationContext
  >({
    mutationFn: async ({ uri }) => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      await agent.app.bsky.bookmark.deleteBookmark({ uri });
      return null;
    },
    onMutate: async ({ uri }) => {
      setBookmarkOverride(activeDid, uri, false);
      return {
        rollback: await patchCachedPostForViewer(qc, scope, uri, (post) =>
          patchPostBookmark(post, false),
        ),
      };
    },
    onError: (_err, { uri }, context) => {
      setBookmarkOverride(activeDid, uri, true);
      context?.rollback?.();
    },
    onSettled: (_data, _err, { uri }) =>
      invalidateCachedPostForViewer(qc, scope, uri),
  });
}

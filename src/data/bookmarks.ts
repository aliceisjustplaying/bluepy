import { AppBskyFeedDefs } from '@atproto/api';
import { useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { primePosts } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys, type AtUri } from './keys';
import { useViewerScope } from './scope';

export function useBookmarks() {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  return useInfiniteList<AtUri>({
    queryKey: keys.bookmarks(scope),
    enabled: Boolean(activeDid),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.app.bsky.bookmark.getBookmarks({
        limit: 30,
        cursor: pageParam,
      });
      const posts = res.data.bookmarks.flatMap((bookmark) =>
        AppBskyFeedDefs.isPostView(bookmark.item) ? [bookmark.item] : [],
      );
      primePosts(qc, scope, { posts });
      return {
        items: posts.map((post) => post.uri),
        cursor: res.data.cursor,
      };
    },
  });
}

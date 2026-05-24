import type { AppBskyFeedDefs } from '@atproto/api';

function isThreadViewPost(
  node: unknown,
): node is AppBskyFeedDefs.ThreadViewPost {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { $type?: string }).$type === 'app.bsky.feed.defs#threadViewPost'
  );
}

export function collectThreadUris(
  thread: AppBskyFeedDefs.ThreadViewPost,
): string[] {
  const ancestors: string[] = [];
  let cursor: unknown = thread.parent;
  while (isThreadViewPost(cursor)) {
    ancestors.unshift(cursor.post.uri);
    cursor = cursor.parent;
  }

  const uris = [...ancestors, thread.post.uri];

  function collectReplies(node: AppBskyFeedDefs.ThreadViewPost): void {
    for (const reply of node.replies ?? []) {
      if (isThreadViewPost(reply)) {
        uris.push(reply.post.uri);
        collectReplies(reply);
      }
    }
  }

  collectReplies(thread);
  return uris;
}

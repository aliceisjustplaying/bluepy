import {
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  type Agent,
  type AppBskyFeedDefs,
} from '@atproto/api';

import type { AnyStatus } from '../components/status-types';
import { postToStatus } from '../utils/atproto-adapter';

type ResolvePostView = (uri: string) => AppBskyFeedDefs.PostView | undefined;

const VIEW_REF_TYPE = 'app.bsky.embed.record#viewRef';

function viewRecordFromPost(
  post: AppBskyFeedDefs.PostView,
): AppBskyEmbedRecord.ViewRecord {
  const loosePost = post as AppBskyFeedDefs.PostView & {
    value?: AppBskyEmbedRecord.ViewRecord['value'];
    embeds?: AppBskyFeedDefs.PostView['embed'][];
  };
  return {
    $type: 'app.bsky.embed.record#viewRecord',
    uri: post.uri,
    cid: post.cid,
    author: post.author,
    value: post.record ?? loosePost.value,
    embeds: post.embed
      ? [post.embed]
      : loosePost.embeds?.filter(
          (embed): embed is NonNullable<typeof embed> => Boolean(embed),
        ),
    labels: post.labels,
    replyCount: post.replyCount,
    repostCount: post.repostCount,
    likeCount: post.likeCount,
    quoteCount: post.quoteCount,
    indexedAt: post.indexedAt,
  };
}

function isViewRef(
  value: unknown,
): value is { $type: typeof VIEW_REF_TYPE; uri: string; cid?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { $type?: unknown }).$type === VIEW_REF_TYPE &&
    typeof (value as { uri?: unknown }).uri === 'string'
  );
}

function hydrateEmbedRefs(
  embed: AppBskyFeedDefs.PostView['embed'],
  resolvePost: ResolvePostView | undefined,
): AppBskyFeedDefs.PostView['embed'] {
  if (!embed || !resolvePost) return embed;

  if (AppBskyEmbedRecord.isView(embed) && isViewRef(embed.record)) {
    const quoted = resolvePost(embed.record.uri);
    return quoted
      ? {
          ...embed,
          record: viewRecordFromPost(quoted),
        } as AppBskyFeedDefs.PostView['embed']
      : embed;
  }

  if (AppBskyEmbedRecordWithMedia.isView(embed)) {
    const record = embed.record;
    if (AppBskyEmbedRecord.isView(record) && isViewRef(record.record)) {
      const quoted = resolvePost(record.record.uri);
      return quoted
        ? {
            ...embed,
            record: {
              ...record,
              record: viewRecordFromPost(quoted),
            },
          } as AppBskyFeedDefs.PostView['embed']
        : embed;
    }
    if (
      typeof record === 'object' &&
      record !== null &&
      'record' in record &&
      isViewRef(record.record)
    ) {
      const quoted = resolvePost(record.record.uri);
      return quoted
        ? {
            ...embed,
            record: {
              ...record,
              record: viewRecordFromPost(quoted),
            },
          } as AppBskyFeedDefs.PostView['embed']
        : embed;
    }
  }

  return embed;
}

function hydratePostRefs(
  post: AppBskyFeedDefs.PostView,
  resolvePost: ResolvePostView | undefined,
): AppBskyFeedDefs.PostView {
  const embed = hydrateEmbedRefs(post.embed, resolvePost);
  return embed === post.embed ? post : { ...post, embed };
}

export function postViewToDisplayStatus(
  post: AppBskyFeedDefs.PostView,
  agent: Agent,
  resolvePost?: ResolvePostView,
): AnyStatus {
  return postToStatus(hydratePostRefs(post, resolvePost), agent) as unknown as AnyStatus;
}

export function feedViewPostToDisplayStatus(
  item: AppBskyFeedDefs.FeedViewPost,
  agent: Agent,
  resolvePost?: ResolvePostView,
): AnyStatus {
  return postToStatus(
    { ...item, post: hydratePostRefs(item.post, resolvePost) },
    agent,
  ) as unknown as AnyStatus;
}

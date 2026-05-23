import {
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyFeedDefs,
  AppBskyActorDefs,
} from '@atproto/api';
import type { QueryClient } from '@tanstack/react-query';

import { keys, type ViewerScope } from '../keys';

const VIEW_REF_TYPE = 'app.bsky.embed.record#viewRef';

type RecordEmbedView =
  | AppBskyEmbedRecord.View
  | AppBskyEmbedRecordWithMedia.View;

function isPostView(value: unknown): value is AppBskyFeedDefs.PostView {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppBskyFeedDefs.PostView).uri === 'string' &&
    typeof (value as AppBskyFeedDefs.PostView).author?.did === 'string'
  );
}

function isProfileView(
  value: unknown,
): value is AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppBskyActorDefs.ProfileView).did === 'string'
  );
}

function toViewRef(
  record: AppBskyEmbedRecord.ViewRecord,
): { $type: typeof VIEW_REF_TYPE; uri: string; cid: string } {
  return {
    $type: VIEW_REF_TYPE,
    uri: record.uri,
    cid: record.cid,
  };
}

function primeEmbed(
  qc: QueryClient,
  scope: ViewerScope,
  embed: RecordEmbedView,
): AppBskyFeedDefs.PostView['embed'] {
  if (AppBskyEmbedRecord.isView(embed)) {
    const record = embed.record;
    if (AppBskyEmbedRecord.isViewRecord(record)) {
      primeOnePost(qc, scope, record);
      return { ...embed, record: toViewRef(record) };
    }
    return embed as AppBskyFeedDefs.PostView['embed'];
  }

  if (AppBskyEmbedRecordWithMedia.isView(embed)) {
    const recordWrapper = embed.record as
      | AppBskyEmbedRecord.View
      | { record?: AppBskyEmbedRecord.ViewRecord };
    if (AppBskyEmbedRecord.isView(recordWrapper)) {
      const inner = recordWrapper.record;
      if (AppBskyEmbedRecord.isViewRecord(inner)) {
        primeOnePost(qc, scope, inner);
        return {
          ...embed,
          record: { ...recordWrapper, record: toViewRef(inner) },
        };
      }
      return embed as AppBskyFeedDefs.PostView['embed'];
    }
    const looseInner = recordWrapper.record;
    if (looseInner && AppBskyEmbedRecord.isViewRecord(looseInner)) {
      primeOnePost(qc, scope, looseInner);
      return {
        ...embed,
        record: { record: toViewRef(looseInner) },
      } as AppBskyFeedDefs.PostView['embed'];
    }
    return embed as AppBskyFeedDefs.PostView['embed'];
  }

  return embed as AppBskyFeedDefs.PostView['embed'];
}

function primeOnePost(
  qc: QueryClient,
  scope: ViewerScope,
  post: AppBskyFeedDefs.PostView | AppBskyEmbedRecord.ViewRecord,
): AppBskyFeedDefs.PostView {
  const normalized = post as AppBskyFeedDefs.PostView;
  let shaped: AppBskyFeedDefs.PostView = normalized;

  if (normalized.embed) {
    const embed = normalized.embed;
    if (
      AppBskyEmbedRecord.isView(embed) ||
      AppBskyEmbedRecordWithMedia.isView(embed)
    ) {
      shaped = {
        ...normalized,
        embed: primeEmbed(qc, scope, embed),
      };
    }
  }

  qc.setQueryData(keys.post(scope, shaped.uri), shaped);
  primeOneProfile(qc, scope, shaped.author);
  return shaped;
}

function primeOneProfile(
  qc: QueryClient,
  scope: ViewerScope,
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed
    | AppBskyActorDefs.ProfileViewBasic,
): void {
  if (!profile.did) return;
  qc.setQueryData(keys.profileByDid(scope, profile.did), profile);
}

function walkThreadNode(
  qc: QueryClient,
  scope: ViewerScope,
  node: unknown,
): void {
  if (!node || typeof node !== 'object') return;
  const thread = node as AppBskyFeedDefs.ThreadViewPost;
  if (isPostView(thread.post)) {
    primeOnePost(qc, scope, thread.post);
  }
  const parent = thread.parent as AppBskyFeedDefs.ThreadViewPost | undefined;
  if (parent && isPostView(parent.post)) {
    primeOnePost(qc, scope, parent.post);
  }
  if (Array.isArray(thread.replies)) {
    for (const reply of thread.replies) {
      walkThreadNode(qc, scope, reply);
    }
  }
}

export function primePosts(
  qc: QueryClient,
  scope: ViewerScope,
  response: unknown,
): void {
  if (!response || typeof response !== 'object') return;

  const record = response as Record<string, unknown>;

  if (Array.isArray(record.feed)) {
    for (const item of record.feed) {
      if (!item || typeof item !== 'object') continue;
      const feedItem = item as AppBskyFeedDefs.FeedViewPost;
      if (isPostView(feedItem.post)) {
        primeOnePost(qc, scope, feedItem.post);
      }
      if (feedItem.reply) {
        if (isPostView(feedItem.reply.root)) {
          primeOnePost(qc, scope, feedItem.reply.root);
        }
        if (isPostView(feedItem.reply.parent)) {
          primeOnePost(qc, scope, feedItem.reply.parent);
        }
      }
      if (feedItem.reason && typeof feedItem.reason === 'object') {
        const reason = feedItem.reason as { by?: unknown };
        if (isProfileView(reason.by)) {
          primeOneProfile(qc, scope, reason.by);
        }
      }
    }
    return;
  }

  if (Array.isArray(record.posts)) {
    for (const post of record.posts) {
      if (isPostView(post)) primeOnePost(qc, scope, post);
    }
    return;
  }

  if (isPostView(record.post)) {
    primeOnePost(qc, scope, record.post);
    return;
  }

  if (record.thread && typeof record.thread === 'object') {
    walkThreadNode(
      qc,
      scope,
      record.thread as AppBskyFeedDefs.ThreadViewPost,
    );
  }
}

export function primeProfiles(
  qc: QueryClient,
  scope: ViewerScope,
  response: unknown,
): void {
  if (!response || typeof response !== 'object') return;

  const record = response as Record<string, unknown>;

  if (isProfileView(record)) {
    primeOneProfile(qc, scope, record);
    return;
  }

  for (const key of ['profiles', 'actors', 'followers', 'follows', 'blocks', 'mutes'] as const) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const profile of list) {
      if (isProfileView(profile)) primeOneProfile(qc, scope, profile);
    }
  }
}

export function getCachedPostUris(
  qc: QueryClient,
  scope: ViewerScope,
): string[] {
  const prefix = [...scope, 'post'] as const;
  return qc
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey)
    .filter(
      (key): key is readonly [...typeof prefix, string] =>
        key.length === prefix.length + 1 &&
        prefix.every((part, i) => key[i] === part),
    )
    .map((key) => key[key.length - 1]);
}

export function getCachedProfileDids(
  qc: QueryClient,
  scope: ViewerScope,
): string[] {
  const prefix = [...scope, 'profileByDid'] as const;
  return qc
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey)
    .filter(
      (key): key is readonly [...typeof prefix, string] =>
        key.length === prefix.length + 1 &&
        prefix.every((part, i) => key[i] === part),
    )
    .map((key) => key[key.length - 1]);
}

import {
  AppBskyEmbedRecord,
  AppBskyFeedDefs,
  type Agent,
  type AppBskyRichtextFacet,
} from '@atproto/api';
import type { QueryClient } from '@tanstack/react-query';

import type { NameTextAccount } from '../components/name-text';
import {
  decidePostModeration,
  type ModerationContext,
} from '../render/moderation-decision';
import { renderPostText } from '../render/post-text';
import { encodeAtprotoID } from '../utils/atproto-route';
import { catchupPageHasItemsInRange } from '../utils/catchup-fetch';

import { primePosts } from './_internal/prime';
import type { ViewerScope } from './keys';

const CATCHUP_PAGE_LIMIT = 25;
const CATCHUP_RESULT_LIMIT = 1000;

export interface CatchupMediaAttachment {
  id: string;
  type: 'image' | 'video' | 'gifv' | 'audio';
  url?: string | null;
  previewUrl?: string;
  previewRemoteUrl?: string;
  remoteUrl?: string;
  description?: string;
  meta?: {
    original?: { width?: number; height?: number };
    small?: { width?: number; height?: number };
  };
}

export interface CatchupPostSummary {
  [key: string]: unknown;
  id: string;
  uri: string;
  cid?: string;
  account: NameTextAccount;
  createdAt: string;
  content: string;
  spoilerText: string;
  sensitive: boolean;
  emojis: [];
  mediaAttachments: CatchupMediaAttachment[];
  card?: {
    url?: string;
    image?: string | null;
    imageDescription?: string;
    title?: string;
    description?: string;
    width?: number;
    height?: number;
    type?: string;
  } | null;
  quote?: {
    id?: string;
    quotedStatus?: CatchupPostSummary | null;
    account?: NameTextAccount;
    content?: string;
    spoilerText?: string;
    sensitive?: boolean;
    emojis?: [];
    mediaAttachments?: CatchupMediaAttachment[];
  } | null;
  reblog?: CatchupPostSummary | null;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  repliesCount: number;
  reblogsCount: number;
  favouritesCount: number;
  quotesCount: number;
  visibility: 'public';
  filtered?: [];
  group?: false;
}

export interface ScanTimelineForCatchupOptions {
  agent: Agent;
  queryClient: QueryClient;
  scope: ViewerScope;
  maxCreatedAt: number | null;
  currentAccountDid: string | null;
  moderationContext?: ModerationContext;
  pauseMs?: number;
}

function profileUrl(did: string): string {
  return `/at://${did}/app.bsky.actor.profile/self`;
}

function actorToCatchupAccount(
  actor: AppBskyFeedDefs.PostView['author'],
): NameTextAccount {
  return {
    id: actor.did,
    username: actor.handle,
    acct: actor.handle,
    url: profileUrl(actor.did),
    avatar: actor.avatar,
    avatarStatic: actor.avatar,
    displayName: actor.displayName || actor.handle,
    emojis: [],
    bot: false,
  };
}

function imageAttachments(
  embed: NonNullable<AppBskyFeedDefs.PostView['embed']>,
): CatchupMediaAttachment[] {
  if (!('images' in embed) || !Array.isArray(embed.images)) return [];
  return embed.images.map((image, index) => ({
    id: image.fullsize || image.thumb || String(index),
    type: 'image',
    url: image.fullsize,
    previewUrl: image.thumb || image.fullsize,
    remoteUrl: image.fullsize,
    description: image.alt || '',
    meta: {
      original: {
        width: image.aspectRatio?.width,
        height: image.aspectRatio?.height,
      },
    },
  }));
}

function videoAttachment(
  embed: NonNullable<AppBskyFeedDefs.PostView['embed']>,
): CatchupMediaAttachment[] {
  if (!('playlist' in embed) || !embed.playlist) return [];
  return [
    {
      id: embed.cid || embed.playlist,
      type: 'video',
      url: embed.playlist,
      previewUrl: embed.thumbnail,
      remoteUrl: embed.playlist,
      description: embed.alt || '',
      meta: {
        original: {
          width: embed.aspectRatio?.width,
          height: embed.aspectRatio?.height,
        },
      },
    },
  ];
}

function externalCard(embed: NonNullable<AppBskyFeedDefs.PostView['embed']>) {
  if (!('external' in embed) || !embed.external) return null;
  return {
    url: embed.external.uri,
    title: embed.external.title,
    description: embed.external.description,
    image: typeof embed.external.thumb === 'string' ? embed.external.thumb : null,
    type: 'link',
  };
}

function contentEmbed(
  embed: AppBskyFeedDefs.PostView['embed'],
): AppBskyFeedDefs.PostView['embed'] {
  if (!embed) return undefined;
  if ('media' in embed && embed.media) return embed.media;
  return embed;
}

function quotedPost(
  embed: NonNullable<AppBskyFeedDefs.PostView['embed']>,
): CatchupPostSummary | null {
  const record =
    'record' in embed && embed.record && 'record' in embed.record
      ? embed.record.record
      : 'record' in embed
        ? embed.record
        : null;
  if (!AppBskyEmbedRecord.isViewRecord(record)) {
    return null;
  }
  const value = record.value as AppBskyFeedDefs.PostView['record'] & {
    embed?: AppBskyFeedDefs.PostView['embed'];
  };
  const embeddedView =
    'embeds' in record && Array.isArray(record.embeds) && record.embeds[0]
      ? record.embeds[0]
      : value.embed;

  return postViewToCatchupSummary({
    uri: String(record.uri),
    cid: 'cid' in record ? String(record.cid) : '',
    author: record.author as AppBskyFeedDefs.PostView['author'],
    record: value,
    embed: embeddedView,
    labels: 'labels' in record ? record.labels as AppBskyFeedDefs.PostView['labels'] : undefined,
    replyCount: 'replyCount' in record && typeof record.replyCount === 'number' ? record.replyCount : 0,
    repostCount: 'repostCount' in record && typeof record.repostCount === 'number' ? record.repostCount : 0,
    likeCount: 'likeCount' in record && typeof record.likeCount === 'number' ? record.likeCount : 0,
    quoteCount: 'quoteCount' in record && typeof record.quoteCount === 'number' ? record.quoteCount : 0,
    indexedAt: 'indexedAt' in record && typeof record.indexedAt === 'string' ? record.indexedAt : new Date().toISOString(),
  });
}

export function postViewToCatchupSummary(
  post: AppBskyFeedDefs.PostView,
): CatchupPostSummary {
  const record = post.record as {
    text?: string;
    facets?: AppBskyRichtextFacet.Main[];
    createdAt?: string;
    reply?: { parent?: { uri?: string }; root?: { uri?: string } };
  };
  const embed = post.embed;
  const bodyEmbed = contentEmbed(embed);
  const mediaAttachments = bodyEmbed
    ? [...imageAttachments(bodyEmbed), ...videoAttachment(bodyEmbed)]
    : [];
  const quote = embed ? quotedPost(embed) : null;
  return {
    id: encodeAtprotoID(post.uri),
    uri: post.uri,
    cid: post.cid,
    account: actorToCatchupAccount(post.author),
    createdAt: record.createdAt || post.indexedAt,
    content: renderPostText(record.text || '', record.facets),
    spoilerText: '',
    sensitive: Boolean(post.labels?.length),
    emojis: [],
    mediaAttachments,
    card: bodyEmbed ? externalCard(bodyEmbed) : null,
    quote: quote
      ? {
          id: quote.id,
          quotedStatus: quote,
          account: quote.account,
          content: quote.content,
          spoilerText: quote.spoilerText,
          sensitive: quote.sensitive,
          emojis: quote.emojis,
          mediaAttachments: quote.mediaAttachments,
        }
      : null,
    reblog: null,
    inReplyToId: record.reply?.parent?.uri
      ? encodeAtprotoID(record.reply.parent.uri)
      : null,
    inReplyToAccountId: record.reply?.parent?.uri
      ? record.reply.parent.uri.split('/')[2]
      : null,
    repliesCount: post.replyCount || 0,
    reblogsCount: post.repostCount || 0,
    favouritesCount: post.likeCount || 0,
    quotesCount: post.quoteCount || 0,
    visibility: 'public',
    filtered: [],
    group: false,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function scanTimelineForCatchup({
  agent,
  queryClient,
  scope,
  maxCreatedAt,
  currentAccountDid,
  moderationContext,
  pauseMs = 1000,
}: ScanTimelineForCatchupOptions): Promise<CatchupPostSummary[]> {
  const allResults: CatchupPostSummary[] = [];
  let cursor: string | undefined;
  let pages = 0;

  while (pages < CATCHUP_PAGE_LIMIT && allResults.length < CATCHUP_RESULT_LIMIT) {
    pages += 1;
    const res = await agent.getTimeline({ limit: 40, cursor });
    primePosts(queryClient, scope, res.data);
    const page = res.data.feed;

    for (const item of page) {
      const decision = moderationContext
        ? decidePostModeration(item.post, moderationContext)
        : undefined;
      if (decision?.visibility === 'hide') {
        continue;
      }
      const summary = postViewToCatchupSummary(item.post);
      const repostReason =
        item.reason && AppBskyFeedDefs.isReasonRepost(item.reason)
          ? item.reason
          : null;
      const isRepost = !!repostReason;
      const timelineCreatedAt =
        repostReason && typeof repostReason.indexedAt === 'string'
          ? repostReason.indexedAt
          : summary.createdAt;
      const timelineCreatedAtTime = Date.parse(timelineCreatedAt);
      const inRange = !maxCreatedAt || timelineCreatedAtTime >= maxCreatedAt;
      if (!isRepost && inRange) {
        allResults.push(summary);
        if (allResults.length >= CATCHUP_RESULT_LIMIT) break;
      }
      if (isRepost && inRange) {
        const booster = repostReason.by;
        if (booster.did !== currentAccountDid) {
          allResults.push({
            ...summary,
            id: `${summary.id}:repost:${booster.did}`,
            account: actorToCatchupAccount(booster),
            reblog: summary,
            createdAt: timelineCreatedAt,
          });
          if (allResults.length >= CATCHUP_RESULT_LIMIT) break;
        }
      }
    }

    if (
      allResults.length >= CATCHUP_RESULT_LIMIT ||
      !page.length ||
      !catchupPageHasItemsInRange(
        page.map((item) => ({
          createdAt:
            item.reason?.$type === 'app.bsky.feed.defs#reasonRepost' &&
            'indexedAt' in item.reason &&
            typeof item.reason.indexedAt === 'string'
              ? item.reason.indexedAt
              : ((item.post.record as { createdAt?: string }).createdAt) ||
                item.post.indexedAt,
        })),
        maxCreatedAt,
      )
    ) {
      break;
    }
    cursor = res.data.cursor;
    if (!cursor) break;
    if (pauseMs > 0) await sleep(pauseMs);
  }

  allResults.forEach((status) => {
    if (status.inReplyToId) {
      const replyToStatus = allResults.find(
        (entry) => entry.id === status.inReplyToId,
      );
      if (replyToStatus && !replyToStatus.inReplyToId) {
        Object.assign(replyToStatus, { _thread: true });
      }
    }
  });

  return allResults;
}

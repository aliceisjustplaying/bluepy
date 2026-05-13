import {
  type Agent,
  AtpAgent,
  type AtpAgentOptions,
  type AtpSessionData,
  RichText,
  type RichTextProps,
} from '@atproto/api';
import { getPdsEndpoint } from '@atproto/common-web';
import type { OAuthSession } from '@atproto/oauth-client-browser';

import { BSKY_PDS, resolveAtprotoLoginService } from './atproto-login-service';
import { createAtprotoOAuthAgent } from './atproto-oauth';
import { encodeAtprotoID } from './atproto-route';
import { createAtprotoExternalEmbed, getFirstPostURL } from './atproto-unfurl';

const BSKY_APPVIEW = 'https://public.api.bsky.app';
const BSKY_APPVIEW_DID = 'did:web:api.bsky.app';
const BSKY_APPVIEW_PROXY = `${BSKY_APPVIEW_DID}#bsky_appview`;
export const BSKY_INSTANCE = 'bsky.social';
const BSKY_DISCOVER_FEED =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const BSKY_GET_POSTS_LIMIT = 25;
const BSKY_VIDEO_SERVICE = 'https://video.bsky.app';
const BSKY_VIDEO_SERVICE_DID = 'did:web:video.bsky.app';
export { BSKY_PDS, resolveAtprotoLoginService };

/**
 * The adapter accepts both regular and OAuth-authenticated AtpAgent / Agent
 * instances. Both expose the same surface used by this module, so we type the
 * argument as the more permissive structural shape. Internally we treat it as
 * an opaque agent whose methods are validated by the @atproto/api types at the
 * call sites.
 */
type AtprotoAgent = AtpAgent | Agent;

// Generic loose record for AT proto runtime data whose deep shape varies.
type AtprotoRecord = Record<string, unknown>;

/** Strong reference as stored on records. */
interface AtprotoStrongRef {
  uri: string;
  cid: string;
  [key: string]: unknown;
}

interface BlobRefLike {
  ref?: { toString?: () => string; $link?: string };
  // Full blob payload is opaque from our side.
  [key: string]: unknown;
}

interface AtprotoActor {
  did?: string;
  handle?: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  viewer?: {
    muted?: boolean;
    following?: string;
    blockedBy?: boolean;
    blocking?: string;
    threadMuted?: boolean;
    repost?: string;
    like?: string;
    bookmarked?: boolean;
  };
  [key: string]: unknown;
}

interface AtprotoFacetFeature {
  $type?: string;
  did?: string;
  uri?: string;
  tag?: string;
  [key: string]: unknown;
}

interface AtprotoFacet {
  index?: { byteStart: number; byteEnd: number };
  features?: AtprotoFacetFeature[];
}

interface AtprotoReplyRefLike {
  uri?: string;
  cid?: string;
  author?: AtprotoActor;
  record?: AtprotoRecord;
  value?: AtprotoRecord;
  // Some refs lack post-view fields; we treat them all as loose shapes.
  [key: string]: unknown;
}

interface AtprotoEmbedImage {
  fullsize?: string;
  thumb?: string;
  alt?: string;
  aspectRatio?: { width?: number; height?: number };
}

interface AtprotoEmbedExternal {
  uri: string;
  title?: string;
  description?: string;
  thumb?: string;
  associatedRecord?: unknown;
  associated_record?: unknown;
}

interface AtprotoEmbedVideo {
  cid?: string;
  playlist?: string;
  thumbnail?: string;
  thumb?: string;
  alt?: string;
  aspectRatio?: { width?: number; height?: number };
}

interface AtprotoEmbedRecord extends AtprotoReplyRefLike {
  uri?: string;
  author?: AtprotoActor;
  value?: AtprotoRecord;
  record?: AtprotoEmbedRecord;
}

interface AtprotoEmbed {
  $type?: string;
  images?: AtprotoEmbedImage[];
  external?: AtprotoEmbedExternal;
  video?: AtprotoEmbedVideo;
  playlist?: string;
  cid?: string;
  thumbnail?: string;
  thumb?: string;
  alt?: string;
  aspectRatio?: { width?: number; height?: number };
  media?: AtprotoEmbed;
  record?: AtprotoEmbedRecord;
  [key: string]: unknown;
}

interface AtprotoPostRecord {
  text?: string;
  facets?: AtprotoFacet[];
  langs?: string[];
  createdAt?: string;
  reply?: {
    root?: AtprotoReplyRefLike;
    parent?: AtprotoReplyRefLike;
  };
  embed?: AtprotoEmbed | AtprotoEmbed[];
  embeds?: AtprotoEmbed[];
  subject?: { uri?: string; cid?: string };
  [key: string]: unknown;
}

/**
 * Loose post-like shape consumed by the adapter. Intentionally more permissive
 * than @atproto/api's `AppBskyFeedDefs.PostView`: the same code paths receive
 * full PostViews, embedded record stubs (`{uri, cid, author, value}`),
 * BookmarkView wrappers, ReplyRef ancestors, and `NotFoundPost`/`BlockedPost`
 * placeholders. The JS adapter accepted all of these without validation; the
 * type mirrors that contract. Callers must therefore tolerate missing
 * `uri`/`cid`/`author`/`record` and short-circuit on those branches.
 */
interface AtprotoPost {
  uri?: string;
  cid?: string;
  author?: AtprotoActor;
  record?: AtprotoPostRecord;
  value?: AtprotoPostRecord;
  embed?: AtprotoEmbed | AtprotoEmbed[];
  embeds?: AtprotoEmbed[];
  labels?: unknown[];
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
  viewer?: AtprotoActor['viewer'];
  reply?: { root?: AtprotoReplyRefLike; parent?: AtprotoReplyRefLike };
  [key: string]: unknown;
}

interface AtprotoReason {
  $type?: string;
  by?: AtprotoActor;
  indexedAt?: string;
  [key: string]: unknown;
}

interface AtprotoFeedItem {
  post?: AtprotoPost;
  reply?: {
    root?: AtprotoReplyRefLike;
    parent?: AtprotoReplyRefLike;
    grandparentAuthor?: AtprotoActor;
  };
  reason?: AtprotoReason;
  [key: string]: unknown;
}

interface AtprotoNotification {
  uri?: string;
  cid?: string;
  author?: AtprotoActor;
  reason?: string;
  reasonSubject?: string;
  record?: AtprotoRecord & { subject?: { uri?: string } };
  indexedAt?: string;
  [key: string]: unknown;
}

interface AtprotoList {
  uri?: string;
  cid?: string;
  name?: string;
  displayName?: string;
  purpose?: string;
}

interface AtprotoFeedGenerator {
  uri?: string;
  cid?: string;
  displayName?: string;
  name?: string;
}

interface AtprotoRelationship {
  did?: string;
  following?: string;
  followedBy?: string;
  blocking?: string;
  blockedBy?: boolean;
}

interface AdaptedMediaAttachment {
  id: string;
  type: 'image' | 'video';
  url?: string;
  previewUrl?: string;
  remoteUrl?: string;
  description: string;
  meta: {
    original: {
      width?: number;
      height?: number;
    };
  };
}

interface AdaptedCard {
  url: string;
  title: string;
  description: string;
  image?: string;
  associatedRecord?: unknown;
  type: 'link';
}

interface AdaptedQuote {
  id: string;
  state: 'accepted';
  quotedStatus: AdaptedStatus;
}

interface AdaptedAccountAtproto {
  hasProfileCounts: boolean;
}

interface AdaptedAccount {
  id: string;
  username: string;
  acct: string;
  displayName: string;
  note: string;
  source: {
    note: string;
    fields: never[];
  };
  url: string;
  uri?: string;
  avatar?: string;
  avatarStatic?: string;
  header?: string;
  headerStatic?: string;
  followersCount: number;
  followingCount: number;
  statusesCount: number;
  emojis: never[];
  fields: never[];
  bot: boolean;
  group: boolean;
  _atproto: AdaptedAccountAtproto;
  // The adapter's return is consumed by code typed against AccountInfo, which
  // has an open index signature. Permit unknown extras so the structural cast
  // in api.ts succeeds without re-typing every consumer.
  [key: string]: unknown;
}

interface AdaptedMention {
  id: string;
  username: string;
  acct: string;
  url: string;
}

interface AdaptedTag {
  name: string;
  url: string;
  history?: never[];
}

interface AdaptedStatusAtproto {
  uri?: string;
  cid?: string;
  root?: AtprotoStrongRef;
  parent?: AtprotoStrongRef;
  replyParentAccount?: AdaptedAccount;
  replyParentUnavailable: boolean;
  like?: string;
  repost?: string;
  text: string;
}

interface AdaptedStatusBase {
  id: string;
  uri?: string;
  url: string;
  createdAt?: string;
  account: AdaptedAccount;
  content: string;
  visibility: 'public';
  sensitive: boolean;
  spoilerText: string;
  language?: string;
  repliesCount: number;
  reblogsCount: number;
  favouritesCount: number;
  quotesCount: number;
  reblogged: boolean;
  favourited: boolean;
  bookmarked: boolean;
  muted: boolean;
  mediaAttachments: AdaptedMediaAttachment[];
  card: AdaptedCard | undefined;
  mentions: AdaptedMention[];
  tags: AdaptedTag[];
  emojis: never[];
  poll: null;
  editedAt: null;
  inReplyToId: string | null;
  inReplyToAccountId: string | null;
  quote: AdaptedQuote | undefined;
  _atproto: AdaptedStatusAtproto;
  quoteApproval: {
    currentUser: 'automatic';
    automatic: ['public'];
    manual: never[];
  };
}

interface AdaptedStatus extends AdaptedStatusBase {
  reblog?: AdaptedStatusBase;
}

interface AdaptedList {
  id: string;
  title: string;
  repliesPolicy: 'list';
  exclusive: false;
  _atproto: {
    uri?: string;
    cid?: string;
    purpose?: string;
    type: 'list' | 'feed';
  };
}

interface AdaptedRelationshipAtproto {
  following?: string;
  blocking?: string;
}

interface AdaptedRelationship {
  id?: string;
  following: boolean;
  showingReblogs: boolean;
  notifying: boolean;
  followedBy: boolean;
  blocking: boolean;
  blockedBy: boolean;
  muting: boolean;
  mutingNotifications: boolean;
  requested: boolean;
  domainBlocking: boolean;
  endorsed: boolean;
  _atproto?: AdaptedRelationshipAtproto;
}

type AdaptedNotificationType =
  | 'favourite'
  | 'reblog'
  | 'quote'
  | 'mention'
  | 'follow'
  | 'status';

interface AdaptedNotification {
  id: string;
  type: AdaptedNotificationType;
  createdAt?: string;
  account: AdaptedAccount;
  status: AdaptedStatus | undefined;
}

interface AdaptedGroupedNotification extends AdaptedNotification {
  groupKey: string;
  sampleAccountIds: string[];
  statusId: string | undefined;
  notificationsCount: number;
  mostRecentNotificationId: string;
  latestPageNotificationAt: string | undefined;
}

interface AdaptedUploadedMedia {
  id: string;
  type: 'image' | 'video';
  url: string;
  previewUrl: string;
  description?: string;
  blob: BlobRefLike;
}

interface CollectionPage<T> {
  cursor: string | undefined;
  items: T;
}

interface CollectionFetcher<T> {
  (cursor?: string): Promise<CollectionPage<T>>;
}

interface AsyncIteratorLike<T> {
  next(): Promise<{ value: T; done: boolean }>;
}

interface Collection<T> {
  values(): AsyncIteratorLike<T>;
}

interface JobStatus {
  state?: string;
  blob?: BlobRefLike;
  message?: string;
  error?: string;
  jobId?: string;
  jobStatus?: JobStatus;
}

interface CreateAtprotoClientOptions {
  // Accept loose runtime types from callers; the adapter shims to concrete
  // @atproto types at use sites. `session` and `oauthSession` are typed as
  // `unknown` to document that callers may pass either the concrete
  // AtpSessionData/OAuthSession shape or a looser runtime value.
  session?: unknown;
  oauthSession?: unknown;
  service?: string;
  persistSession?: unknown;
}

function getServiceAuthAudFromUrl(url: string): string {
  const { hostname } = new URL(url);
  return `did:web:${hostname}`;
}

function createVideoEndpointUrl(
  route: string,
  params: Record<string, string> = {},
): string {
  const url = new URL(BSKY_VIDEO_SERVICE);
  url.pathname = route;
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.href;
}

async function getServiceAuthToken({
  agent,
  aud,
  lxm,
  exp,
}: {
  agent: AtprotoAgent;
  aud: string;
  lxm: string;
  exp?: number;
}): Promise<string> {
  const res = await agent.com.atproto.server.getServiceAuth({
    aud,
    lxm,
    exp,
  });
  return res.data.token;
}

async function uploadVideoBlob(
  agent: AtprotoAgent,
  file: File,
): Promise<BlobRefLike> {
  if (file.type !== 'video/mp4') {
    throw new Error('Only MP4 video uploads are supported for Bluesky posts');
  }
  const agentLoose = agent as unknown as {
    did?: string;
    sessionManager?: {
      pdsUrl?: URL;
      getTokenInfo?: () => Promise<{ aud?: string } | undefined>;
      session?: AtpSessionData;
    };
    dispatchUrl?: string;
  };
  if (!agentLoose.did) throw new Error('Missing Bluesky session');

  if (agentLoose.sessionManager && !agentLoose.sessionManager.pdsUrl) {
    const session = await agent.com.atproto.server.getSession();
    const pdsEndpoint = session.data.didDoc
      ? getPdsEndpoint(
          session.data.didDoc as Parameters<typeof getPdsEndpoint>[0],
        )
      : null;
    if (pdsEndpoint) agentLoose.sessionManager.pdsUrl = new URL(pdsEndpoint);
  }
  const dispatchUrl =
    agentLoose.dispatchUrl ||
    (await agentLoose.sessionManager?.getTokenInfo?.())?.aud;

  const uploadToken = await getServiceAuthToken({
    agent,
    aud: getServiceAuthAudFromUrl(dispatchUrl as string),
    lxm: 'com.atproto.repo.uploadBlob',
    exp: Date.now() / 1000 + 60 * 30,
  });
  const uploadRes = await fetch(
    createVideoEndpointUrl('/xrpc/app.bsky.video.uploadVideo', {
      did: agentLoose.did,
      name: `${crypto.randomUUID()}.mp4`,
    }),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${uploadToken}`,
        'content-type': file.type,
      },
      body: file,
    },
  );
  if (!uploadRes.ok) {
    const message = await uploadRes.text().catch(() => '');
    throw new Error(
      `Failed to upload video (${uploadRes.status})${message ? `: ${message}` : ''}`,
    );
  }
  let jobStatus = (await uploadRes.json()) as JobStatus;
  if (jobStatus.jobStatus) jobStatus = jobStatus.jobStatus;
  if (jobStatus.error) {
    throw new Error(jobStatus.message || jobStatus.error);
  }

  const videoAgent = new AtpAgent({ service: BSKY_VIDEO_SERVICE });
  const statusToken = await getServiceAuthToken({
    agent,
    aud: BSKY_VIDEO_SERVICE_DID,
    lxm: 'app.bsky.video.getJobStatus',
  });
  for (let i = 0; i < 60; i++) {
    if (jobStatus.state === 'JOB_STATE_COMPLETED' && jobStatus.blob) {
      return jobStatus.blob;
    }
    if (jobStatus.state === 'JOB_STATE_FAILED') {
      throw new Error(
        jobStatus.message || jobStatus.error || 'Video upload failed',
      );
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1_000);
    });
    const statusRes = await videoAgent.app.bsky.video.getJobStatus(
      { jobId: jobStatus.jobId as string },
      { headers: { authorization: `Bearer ${statusToken}` } },
    );
    jobStatus =
      (statusRes.data as { jobStatus?: JobStatus }).jobStatus ||
      (statusRes.data as unknown as JobStatus);
  }
  throw new Error('Timed out waiting for Bluesky video processing');
}

// Coerce non-string runtime values (some ATProto fields arrive as unknown).
function escapeHTML(value: unknown = ''): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function textToHTML(text: string | undefined = ''): string {
  return escapeHTML(text).replace(/\n/g, '<br />');
}

function richTextToHTML(
  text: string | undefined = '',
  facets: AtprotoFacet[] = [],
): string {
  if (!facets?.length) return textToHTML(text);
  const richText = new RichText({
    text: text || '',
    facets: facets as unknown as RichTextProps['facets'],
  });
  return Array.from(richText.segments())
    .map((segment) => {
      const html = textToHTML(segment.text);
      if (segment.link?.uri) {
        return `<a href="${escapeHTML(segment.link.uri)}" target="_blank" rel="nofollow noopener noreferrer">${html}</a>`;
      }
      if (segment.mention?.did) {
        return `<a href="https://bsky.app/profile/${escapeHTML(segment.mention.did)}" class="mention" target="_blank" rel="nofollow noopener noreferrer">${html}</a>`;
      }
      if (segment.tag?.tag) {
        return `<a href="/t/${encodeURIComponent(segment.tag.tag)}" class="mention hashtag" rel="tag">#<span>${escapeHTML(segment.tag.tag)}</span></a>`;
      }
      return html;
    })
    .join('');
}

function actorToAccount(actor: AtprotoActor = {}): AdaptedAccount {
  const handle = actor.handle || actor.did || 'unknown.bsky.social';
  const displayName = actor.displayName || handle;
  const description = actor.description || '';
  const url = `https://bsky.app/profile/${handle}`;
  const hasProfileCounts =
    Number.isFinite(actor.followersCount) &&
    Number.isFinite(actor.followsCount) &&
    Number.isFinite(actor.postsCount);
  return {
    id: actor.did || handle,
    username: handle,
    acct: handle,
    displayName,
    note: textToHTML(description),
    source: {
      note: description,
      fields: [],
    },
    url,
    uri: actor.did,
    avatar: actor.avatar,
    avatarStatic: actor.avatar,
    header: actor.banner,
    headerStatic: actor.banner,
    followersCount: actor.followersCount ?? 0,
    followingCount: actor.followsCount ?? 0,
    statusesCount: actor.postsCount ?? 0,
    emojis: [],
    fields: [],
    bot: false,
    group: false,
    _atproto: {
      hasProfileCounts,
    },
  };
}

interface EmbedParts {
  mediaAttachments: AdaptedMediaAttachment[];
  card: AdaptedCard | undefined;
  quote: AdaptedQuote | undefined;
}

function embedToParts(
  embed: AtprotoEmbed | AtprotoEmbed[] | undefined,
  agent: AtprotoAgent,
): EmbedParts {
  const mediaAttachments: AdaptedMediaAttachment[] = [];
  let card: AdaptedCard | undefined;
  let quote: AdaptedQuote | undefined;

  if (!embed) return { mediaAttachments, card, quote };
  if (Array.isArray(embed)) {
    embed.forEach((item) => {
      const parts = embedToParts(item, agent);
      mediaAttachments.push(...parts.mediaAttachments);
      card ||= parts.card;
      quote ||= parts.quote;
    });
    return { mediaAttachments, card, quote };
  }

  const images: AtprotoEmbedImage[] = embed.images || embed.media?.images || [];
  images.forEach((image, index) => {
    const fullsize = image.fullsize || image.thumb;
    mediaAttachments.push({
      id: `${fullsize || index}`,
      type: 'image',
      url: fullsize,
      previewUrl: image.thumb || fullsize,
      remoteUrl: fullsize,
      description: image.alt || '',
      meta: {
        original: {
          width: image.aspectRatio?.width,
          height: image.aspectRatio?.height,
        },
      },
    });
  });

  const external = embed.external || embed.media?.external;
  if (external) {
    card = {
      url: external.uri,
      title: external.title || external.uri,
      description: external.description || '',
      image: external.thumb,
      associatedRecord: external.associatedRecord || external.associated_record,
      type: 'link',
    };
  }

  const videoCandidate: AtprotoEmbedVideo | undefined =
    (embed.playlist && (embed as AtprotoEmbedVideo)) ||
    embed.video ||
    (embed.media?.playlist && (embed.media as AtprotoEmbedVideo)) ||
    embed.media?.video;
  const video = videoCandidate;
  if (video?.playlist) {
    mediaAttachments.push({
      id: video.cid || video.playlist,
      type: 'video',
      url: video.playlist,
      previewUrl: video.thumbnail || video.thumb,
      remoteUrl: video.playlist,
      description: video.alt || '',
      meta: {
        original: {
          width: video.aspectRatio?.width,
          height: video.aspectRatio?.height,
        },
      },
    });
  }

  const record: AtprotoEmbedRecord | undefined =
    embed.record?.record || embed.record;
  if (record?.uri && record?.author && record?.value) {
    quote = {
      id: encodeAtprotoID(record.uri),
      state: 'accepted',
      quotedStatus: postToStatus(
        { post: record as unknown as AtprotoPost },
        agent,
      ),
    };
  }

  return { mediaAttachments, card, quote };
}

function postURL(post: AtprotoPost): string {
  const rkey = post.uri?.split('/').pop();
  return `https://bsky.app/profile/${post.author?.handle || post.author?.did}/post/${rkey}`;
}

function parseBskyPostURL(
  text: string | undefined = '',
): { actor: string; rkey: string } | null {
  const match = text.match(
    /https?:\/\/bsky\.app\/profile\/([^/\s]+)\/post\/([^?\s#]+)/i,
  );
  if (!match) return null;
  return {
    actor: decodeURIComponent(match[1]),
    rkey: decodeURIComponent(match[2]),
  };
}

function normalizeActor(actor: string | undefined): string | undefined {
  if (!actor) return actor;
  return actor
    .replace(/^@/, '')
    .replace(/^https?:\/\/bsky\.app\/profile\//, '')
    .replace(/\/+$/, '');
}

function decodeResourceID(id: string): string {
  return decodeURIComponent(id);
}

function atprotoRkey(uri: string | undefined): string | undefined {
  return uri?.split('/').pop();
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function listToPhanpyList(list: AtprotoList = {}): AdaptedList {
  const uri = list.uri;
  return {
    // Preserve the JS adapter's degenerate output for malformed data:
    // `encodeURIComponent(undefined)` stringifies to "undefined" rather than
    // collapsing to "" (which would alias all malformed list IDs).
    id: encodeURIComponent(uri as string),
    title: list.name || list.displayName || uri || '',
    repliesPolicy: 'list',
    exclusive: false,
    _atproto: {
      uri,
      cid: list.cid,
      purpose: list.purpose,
      type: 'list',
    },
  };
}

function feedGeneratorToPhanpyList(
  feed: AtprotoFeedGenerator = {},
): AdaptedList {
  const uri = feed.uri;
  return {
    // See note in listToPhanpyList — preserve JS's "undefined" fallback.
    id: encodeURIComponent(uri as string),
    title: feed.displayName || feed.name || uri || '',
    repliesPolicy: 'list',
    exclusive: false,
    _atproto: {
      uri,
      cid: feed.cid,
      type: 'feed',
    },
  };
}

function atUriRepo(uri: string | undefined): string | null {
  return /^at:\/\/([^/]+)/.exec(uri || '')?.[1] || null;
}

function strongRef(
  value: AtprotoReplyRefLike | AtprotoStrongRef | undefined,
): AtprotoStrongRef | AtprotoReplyRefLike | undefined {
  if (!value?.uri) return value;
  return {
    uri: value.uri,
    cid: (value as AtprotoStrongRef).cid,
  };
}

function isPostView(value: unknown): value is AtprotoPost {
  const v = value as AtprotoPost | null | undefined;
  return !!(v?.uri && v?.author && v?.record);
}

function replyContextSourceForPost(
  feedItem: AtprotoFeedItem | undefined,
  post: AtprotoReplyRefLike | undefined,
): AtprotoFeedItem | AtprotoReplyRefLike | undefined {
  if (!feedItem?.reply || feedItem.post?.uri === post?.uri) return feedItem;
  const parent = feedItem.reply.parent;
  if (
    parent?.uri === post?.uri &&
    feedItem.reply.grandparentAuthor &&
    (post as AtprotoPost)?.record?.reply?.parent?.uri
  ) {
    const postRecord = (post as AtprotoPost).record;
    return {
      post: post as AtprotoPost,
      reply: {
        root: feedItem.reply.root,
        parent: {
          ...(postRecord?.reply?.parent as AtprotoStrongRef),
          author: feedItem.reply.grandparentAuthor,
        },
      },
    };
  }
  return post;
}

export async function hydrateFeedReplyContext(
  feed: AtprotoFeedItem[],
  agent: AtprotoAgent,
): Promise<AtprotoFeedItem[]> {
  const feedPostURIs = new Set(
    feed.map((item) => item.post?.uri).filter(Boolean),
  );
  const missingURIs: string[] = [];
  const seen = new Set<string | undefined>(feedPostURIs);
  feed.forEach((item) => {
    if (item?.reason?.$type === 'app.bsky.feed.defs#reasonRepost') return;
    const refs: Array<AtprotoReplyRefLike | undefined> = [
      item.reply?.root || item.post?.record?.reply?.root,
      item.reply?.parent || item.post?.record?.reply?.parent,
    ];
    refs.forEach((ref) => {
      if (!ref?.uri || isPostView(ref) || seen.has(ref.uri)) return;
      seen.add(ref.uri);
      missingURIs.push(ref.uri);
    });
  });
  if (!missingURIs.length) return feed;

  const hydratedPosts: AtprotoPost[] = [];
  for (let i = 0; i < missingURIs.length; i += BSKY_GET_POSTS_LIMIT) {
    const uris = missingURIs.slice(i, i + BSKY_GET_POSTS_LIMIT);
    const res = await agent.getPosts({ uris });
    hydratedPosts.push(...((res.data.posts || []) as unknown as AtprotoPost[]));
  }
  if (!hydratedPosts.length) return feed;

  const postsByURI: Record<string, AtprotoPost> = Object.fromEntries(
    hydratedPosts.map((post) => [post.uri as string, post]),
  );
  const hydrateRef = (ref: AtprotoReplyRefLike | undefined) =>
    (ref?.uri && postsByURI[ref.uri]) || ref;
  return feed.map((item) => {
    const reply = item.reply || item.post?.record?.reply;
    if (!reply) return item;
    return {
      ...item,
      reply: {
        ...item.reply,
        root: hydrateRef(reply.root),
        parent: hydrateRef(reply.parent),
      },
    };
  });
}

function feedItemToStatuses(
  feedItem: AtprotoFeedItem,
  agent: AtprotoAgent,
): AdaptedStatus[] {
  const post = feedItem?.post || (feedItem as unknown as AtprotoPost);
  if (feedItem?.reason?.$type === 'app.bsky.feed.defs#reasonRepost') {
    return [postToStatus(feedItem, agent)];
  }

  const statuses: AdaptedStatus[] = [];
  const seen = new Set<string>();
  const addPost = (
    item: AtprotoReplyRefLike | undefined,
    statusSource:
      | AtprotoFeedItem
      | AtprotoReplyRefLike
      | AtprotoPost
      | undefined = item,
  ) => {
    if (!isPostView(item) || !item.uri || seen.has(item.uri)) return;
    seen.add(item.uri);
    statuses.push(postToStatus(statusSource, agent));
  };

  addPost(
    feedItem?.reply?.root,
    replyContextSourceForPost(feedItem, feedItem?.reply?.root),
  );
  addPost(
    feedItem?.reply?.parent,
    replyContextSourceForPost(feedItem, feedItem?.reply?.parent),
  );
  addPost(post as AtprotoReplyRefLike, feedItem);
  return statuses;
}

export function feedToStatuses(
  feed: AtprotoFeedItem[],
  agent: AtprotoAgent,
): AdaptedStatus[] {
  return feed.flatMap((item) => feedItemToStatuses(item, agent));
}

function feedToProfileStatuses(
  feed: AtprotoFeedItem[],
  agent: AtprotoAgent,
): AdaptedStatus[] {
  return feed.map((item) => postToStatus(item, agent));
}

function isReasonRepost(reason: AtprotoReason | undefined): boolean {
  return reason?.$type === 'app.bsky.feed.defs#reasonRepost';
}

function isReasonPin(reason: AtprotoReason | undefined): boolean {
  return reason?.$type === 'app.bsky.feed.defs#reasonPin';
}

function isActorProfile(
  profile: AtprotoActor | undefined,
  actor: string | undefined,
): boolean {
  return profile?.did === actor || profile?.handle === actor;
}

function isAuthorReplyChain(
  actor: string | undefined,
  feedItem: AtprotoFeedItem,
  feed: AtprotoFeedItem[],
): boolean {
  if (!isActorProfile(feedItem?.post?.author, actor)) return false;

  const replyParent = feedItem.reply?.parent;
  if (isPostView(replyParent)) {
    if (!isActorProfile(replyParent.author, actor)) return false;
    const parentPost = feed.find((item) => item.post?.uri === replyParent.uri);
    if (!parentPost) return true;
    return isAuthorReplyChain(actor, parentPost, feed);
  }

  return true;
}

function filterAuthorFeed(
  feed: AtprotoFeedItem[],
  actor: string | undefined,
  filter: string,
): AtprotoFeedItem[] {
  let filtered = feed;
  if (filter === 'posts_and_author_threads') {
    filtered = filtered.filter((item) => {
      if (!item.reply) return true;
      if (isReasonRepost(item.reason) || isReasonPin(item.reason)) return true;
      return isAuthorReplyChain(actor, item, feed);
    });
  }

  const seen = new Set<string>();
  return filtered.filter((item) => {
    const uri = item.post?.uri;
    if (!uri) return false;
    if (seen.has(uri)) return false;
    seen.add(uri);
    return true;
  });
}

function feedItemRootURI(feedItem: AtprotoFeedItem): string | undefined {
  return isPostView(feedItem?.reply?.root)
    ? feedItem.reply?.root?.uri
    : feedItem?.post?.uri;
}

function isSelfOrFollowing(
  profile: AtprotoActor | undefined,
  currentUserDid: string | undefined,
): boolean {
  return !!(
    profile?.did &&
    (profile.did === currentUserDid || profile.viewer?.following)
  );
}

function shouldDisplayReplyInFollowing(
  feedItem: AtprotoFeedItem,
  currentUserDid: string | undefined,
): boolean {
  const post = feedItem?.post;
  const author = post?.author;
  const parentAuthor = isPostView(feedItem?.reply?.parent)
    ? feedItem.reply?.parent?.author
    : undefined;
  const grandparentAuthor = feedItem?.reply?.grandparentAuthor;
  const rootAuthor = isPostView(feedItem?.reply?.root)
    ? feedItem.reply?.root?.author
    : undefined;

  if (!isSelfOrFollowing(author, currentUserDid)) return false;
  if (
    (!parentAuthor || parentAuthor.did === author?.did) &&
    (!grandparentAuthor || grandparentAuthor.did === author?.did) &&
    (!rootAuthor || rootAuthor.did === author?.did)
  ) {
    return true;
  }
  return [parentAuthor, grandparentAuthor, rootAuthor].some(
    (profile) =>
      profile?.did !== author?.did &&
      isSelfOrFollowing(profile, currentUserDid),
  );
}

export function postProcessFollowingFeed(
  feed: AtprotoFeedItem[],
  currentUserDid: string | undefined,
): AtprotoFeedItem[] {
  const seenRootURIs = new Set<string>();
  return feed.filter((item) => {
    const post = item?.post;
    if (!post) return false;
    if (post.viewer?.threadMuted) return false;

    const isRepost = item?.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
    const isReply = !!post.record?.reply;

    if (isReply && !isRepost) {
      if (!item.reply || !isPostView(item.reply.parent)) return false;
      if (!shouldDisplayReplyInFollowing(item, currentUserDid)) return false;
    }

    const rootURI = feedItemRootURI(item);
    if (!isRepost && rootURI) {
      if (seenRootURIs.has(rootURI)) return false;
      seenRootURIs.add(rootURI);
    }

    return true;
  });
}

export function postToStatus(
  feedItemOrPost:
    | AtprotoFeedItem
    | AtprotoPost
    | AtprotoReplyRefLike
    | undefined,
  agent: AtprotoAgent,
): AdaptedStatus {
  const post: AtprotoPost =
    ((feedItemOrPost as AtprotoFeedItem)?.post as AtprotoPost) ||
    (feedItemOrPost as AtprotoPost);
  const record: AtprotoPostRecord = post?.record || post?.value || {};
  const feedReply = (feedItemOrPost as AtprotoFeedItem)?.reply;
  const replyParent: AtprotoReplyRefLike | undefined =
    feedReply?.parent || post.reply?.parent;
  const replyParentRef = strongRef(
    record.reply?.parent || post.reply?.parent || feedReply?.parent,
  ) as AtprotoStrongRef | undefined;
  const replyRootRef = strongRef(
    record.reply?.root || post.reply?.root || feedReply?.root,
  ) as AtprotoStrongRef | undefined;
  const replyParentURI = replyParentRef?.uri;
  const replyParentAuthorDid =
    replyParent?.author?.did ||
    post.reply?.parent?.author?.did ||
    atUriRepo(replyParentURI);
  // Preserve JS behavior: `encodeAtprotoID(undefined)` stringifies to
  // "undefined" so malformed inputs each get the same noisy id rather than
  // collapsing to "" and colliding.
  const id = encodeAtprotoID(post.uri as string);
  const { mediaAttachments, card, quote } = embedToParts(
    post.embed || post.embeds || record.embed || record.embeds,
    agent,
  );
  const mentions: AdaptedMention[] = (record.facets || []).flatMap((facet) => {
    const matched = Array.from(
      new RichText({
        text: record.text || '',
        facets: [facet] as unknown as RichTextProps['facets'],
      }).segments(),
    ).find((seg) => seg.facet);
    const text = matched?.text;
    return (facet.features || [])
      .filter((feature) => feature.$type === 'app.bsky.richtext.facet#mention')
      .map((feature) => {
        const username = (text || feature.did || '').replace(/^@/, '');
        return {
          id: feature.did ?? '',
          username,
          acct: username,
          url: `https://bsky.app/profile/${feature.did}`,
        };
      });
  });
  const status: AdaptedStatus = {
    id,
    uri: post.uri,
    url: postURL(post),
    createdAt: record.createdAt || post.indexedAt,
    account: actorToAccount(post.author),
    content: richTextToHTML(record.text || '', record.facets),
    visibility: 'public',
    sensitive: !!post.labels?.length,
    spoilerText: '',
    language: record.langs?.[0],
    repliesCount: post.replyCount || 0,
    reblogsCount: post.repostCount || 0,
    favouritesCount: post.likeCount || 0,
    quotesCount: post.quoteCount || 0,
    reblogged: !!post.viewer?.repost,
    favourited: !!post.viewer?.like,
    bookmarked: !!post.viewer?.bookmarked,
    muted: false,
    mediaAttachments,
    card,
    mentions,
    tags: (record.facets || [])
      .flatMap((facet) => facet.features || [])
      .filter((feature) => feature.$type === 'app.bsky.richtext.facet#tag')
      .map((feature) => ({
        name: feature.tag ?? '',
        url: `/t/${encodeURIComponent(feature.tag ?? '')}`,
      })),
    emojis: [],
    poll: null,
    editedAt: null,
    inReplyToId: replyParentURI ? encodeAtprotoID(replyParentURI) : null,
    inReplyToAccountId: replyParentAuthorDid || null,
    quote,
    _atproto: {
      uri: post.uri,
      cid: post.cid,
      root: replyRootRef,
      parent: replyParentRef,
      replyParentAccount: replyParent?.author
        ? actorToAccount(replyParent.author)
        : undefined,
      replyParentUnavailable: !!replyParentURI && !replyParent?.author,
      like: post.viewer?.like,
      repost: post.viewer?.repost,
      text: record.text || '',
    },
    quoteApproval: {
      currentUser: 'automatic',
      automatic: ['public'],
      manual: [],
    },
  };

  const reason = (feedItemOrPost as AtprotoFeedItem)?.reason;
  if (reason?.$type === 'app.bsky.feed.defs#reasonRepost') {
    return {
      ...status,
      id: `${id}-repost-${reason.indexedAt}`,
      createdAt: reason.indexedAt,
      account: actorToAccount(reason.by),
      reblog: status,
    };
  }

  return status;
}

function createIterator<T>(
  fetchPage: CollectionFetcher<T>,
): AsyncIteratorLike<T> {
  let cursor: string | undefined;
  return {
    async next() {
      const res = await fetchPage(cursor);
      cursor = res.cursor;
      return {
        value: res.items,
        done: !res.cursor,
      };
    },
  };
}

function makeCollection<T>(fetchPage: CollectionFetcher<T>): Collection<T> {
  return {
    values() {
      return createIterator(fetchPage);
    },
  };
}

function emptyCollection<T>(): Collection<T> {
  return makeCollection<T>(async () => ({
    cursor: undefined,
    items: [] as unknown as T,
  }));
}

function relationshipFor(id: string | undefined): AdaptedRelationship {
  return {
    id,
    following: false,
    showingReblogs: true,
    notifying: false,
    followedBy: false,
    blocking: false,
    blockedBy: false,
    muting: false,
    mutingNotifications: false,
    requested: false,
    domainBlocking: false,
    endorsed: false,
  };
}

function relationshipFromAtproto(
  rel: AtprotoRelationship = {},
  profile: AtprotoActor = {},
): AdaptedRelationship {
  return {
    ...relationshipFor(rel.did || profile.did),
    id: rel.did || profile.did,
    following: !!rel.following,
    followedBy: !!rel.followedBy,
    blocking: !!rel.blocking,
    blockedBy: !!rel.blockedBy,
    muting: !!profile.viewer?.muted,
    _atproto: {
      following: rel.following,
      blocking: rel.blocking,
    },
  };
}

export function notificationType(
  reason: string | undefined,
): AdaptedNotificationType {
  switch (reason) {
    case 'like':
    case 'like-via-repost':
      return 'favourite';
    case 'repost':
    case 'repost-via-repost':
      return 'reblog';
    case 'quote':
      return 'quote';
    case 'reply':
    case 'mention':
      return 'mention';
    case 'follow':
      return 'follow';
    case undefined:
    default:
      return 'status';
  }
}

export function notificationStatusURI(
  notification: AtprotoNotification,
): string | undefined {
  if (notification.reason === 'like-via-repost') {
    return notification.record?.subject?.uri || notification.reasonSubject;
  }
  if (notification.reason === 'repost-via-repost') {
    return notification.record?.subject?.uri || notification.reasonSubject;
  }
  if (notification.reason === 'like' || notification.reason === 'repost') {
    return notification.reasonSubject || notification.record?.subject?.uri;
  }
  if (
    notification.reason === 'quote' ||
    notification.reason === 'reply' ||
    notification.reason === 'mention'
  ) {
    return notification.uri || notification.reasonSubject;
  }
  return (
    notification.reasonSubject ||
    notification.record?.subject?.uri ||
    notification.uri
  );
}

interface GroupedNotificationsItems {
  accounts: AdaptedAccount[];
  statuses: AdaptedStatus[];
  notificationGroups: AdaptedGroupedNotification[];
}

function toGroupedNotificationsPage({
  cursor,
  items,
}: CollectionPage<
  AdaptedNotification[]
>): CollectionPage<GroupedNotificationsItems> {
  const accounts: AdaptedAccount[] = [];
  const statuses: AdaptedStatus[] = [];
  const accountIds = new Set<string>();
  const statusIds = new Set<string>();
  const notificationGroups: AdaptedGroupedNotification[] = items.map(
    (notification) => {
      const accountId = notification.account?.id;
      const statusId = notification.status?.id;
      if (notification.account && accountId && !accountIds.has(accountId)) {
        accountIds.add(accountId);
        accounts.push(notification.account);
      }
      if (notification.status && statusId && !statusIds.has(statusId)) {
        statusIds.add(statusId);
        statuses.push(notification.status);
      }
      return {
        ...notification,
        groupKey: `${notification.type}:${statusId || ''}:${accountId || ''}:${notification.id}`,
        sampleAccountIds: accountId ? [accountId] : [],
        statusId,
        notificationsCount: 1,
        mostRecentNotificationId: notification.id,
        latestPageNotificationAt: notification.createdAt,
      };
    },
  );
  return {
    cursor,
    items: {
      accounts,
      statuses,
      notificationGroups,
    },
  };
}

async function createMediaUpload({
  agent,
  uploadedMedia,
  file,
  description,
}: {
  agent: AtprotoAgent;
  uploadedMedia: Map<string, AdaptedUploadedMedia>;
  file?: File;
  description?: string;
}): Promise<AdaptedUploadedMedia> {
  if (!file) throw new Error('Missing media file');
  const url = URL.createObjectURL(file);

  if (file.type?.startsWith('image/')) {
    const res = await agent.uploadBlob(file, {
      encoding: file.type,
    });
    const blob = res.data.blob as unknown as BlobRefLike;
    const id =
      blob?.ref?.toString?.() || blob?.ref?.$link || crypto.randomUUID();
    const media: AdaptedUploadedMedia = {
      id,
      type: 'image',
      url,
      previewUrl: url,
      description,
      blob,
    };
    uploadedMedia.set(id, media);
    return media;
  }

  if (file.type?.startsWith('video/')) {
    const blob = await uploadVideoBlob(agent, file);
    const id =
      blob?.ref?.toString?.() || blob?.ref?.$link || crypto.randomUUID();
    const media: AdaptedUploadedMedia = {
      id,
      type: 'video',
      url,
      previewUrl: url,
      description,
      blob,
    };
    uploadedMedia.set(id, media);
    return media;
  }

  throw new Error(
    'Only image and MP4 video uploads are supported for Bluesky posts',
  );
}

function hasUploadableFile(file: unknown): file is Blob {
  return file instanceof Blob && file.size > 0;
}

async function uploadProfileImage(
  agent: AtprotoAgent,
  file: unknown,
): Promise<BlobRefLike | null> {
  if (!hasUploadableFile(file)) return null;
  if (!file.type?.startsWith('image/')) {
    throw new Error('Only images are supported for Bluesky profile media');
  }
  const res = await agent.uploadBlob(file, {
    encoding: file.type,
  });
  return res.data.blob as unknown as BlobRefLike;
}

function isBskyAppViewService(service: string): boolean {
  try {
    const { hostname } = new URL(service);
    return hostname === 'public.api.bsky.app' || hostname === 'api.bsky.app';
  } catch {
    return false;
  }
}

export function createAtprotoClient({
  session,
  oauthSession,
  service = BSKY_PDS,
  persistSession,
}: CreateAtprotoClientOptions) {
  const agentOrNull: AtprotoAgent | null = oauthSession
    ? createAtprotoOAuthAgent(oauthSession as OAuthSession)
    : new AtpAgent({
        service,
        persistSession: persistSession as AtpAgentOptions['persistSession'],
      } satisfies AtpAgentOptions);
  if (!agentOrNull) throw new Error('Missing Bluesky OAuth session');
  const agent: AtprotoAgent = agentOrNull;
  if (!isBskyAppViewService(service)) {
    (
      agent as unknown as { configureProxy: (p: string) => void }
    ).configureProxy(BSKY_APPVIEW_PROXY);
  }
  const agentLoose = agent as unknown as {
    did?: string;
    sessionManager?: { session?: AtpSessionData };
    [key: string]: unknown;
  };
  if (session && agentLoose.sessionManager) {
    agentLoose.sessionManager.session = session as AtpSessionData;
  }
  const uploadedMedia = new Map<string, AdaptedUploadedMedia>();

  const statusAPI = (id: string) => {
    const uri = decodeURIComponent(id);
    const hydrateLegacyLinkQuote = async (
      status: AdaptedStatus,
    ): Promise<AdaptedStatus> => {
      if (status.quote) return status;
      const parsed = parseBskyPostURL(status._atproto?.text || '');
      if (!parsed) return status;
      const profile = await agent.getProfile({ actor: parsed.actor });
      const quoteURI = `at://${profile.data.did}/app.bsky.feed.post/${parsed.rkey}`;
      const quoteRes = await agent.getPosts({ uris: [quoteURI] });
      const quotePost = (quoteRes.data.posts as unknown as AtprotoPost[])?.[0];
      if (!quotePost) return status;
      return {
        ...status,
        quote: {
          id: encodeAtprotoID(quotePost.uri as string),
          state: 'accepted',
          quotedStatus: postToStatus(quotePost, agent),
        },
      };
    };
    return {
      async fetch(): Promise<AdaptedStatus> {
        const res = await agent.getPosts({ uris: [uri] });
        const post = (res.data.posts as unknown as AtprotoPost[])?.[0];
        if (!post) throw new Error('Post not found');
        const status = await hydrateLegacyLinkQuote(postToStatus(post, agent));
        return status;
      },
      context: {
        async fetch() {
          const res = await agent.getPostThread({
            uri,
            depth: 8,
            parentHeight: 8,
          });
          interface ThreadNode {
            post?: AtprotoPost;
            replies?: ThreadNode[];
            parent?: ThreadNode;
          }
          const flatten = (
            node: ThreadNode | undefined,
            bucket: AdaptedStatus[] = [],
          ): AdaptedStatus[] => {
            if (node?.post) bucket.push(postToStatus(node.post, agent));
            node?.replies?.forEach((reply) => flatten(reply, bucket));
            return bucket;
          };
          const thread = res.data.thread as unknown as ThreadNode;
          const ancestors: AdaptedStatus[] = [];
          let parent = thread?.parent;
          while (parent?.post) {
            ancestors.unshift(postToStatus(parent.post, agent));
            parent = parent.parent;
          }
          const descendants = thread?.replies?.flatMap((reply) =>
            flatten(reply, []),
          );
          return { ancestors, descendants: descendants || [] };
        },
      },
      source: {
        async fetch() {
          const current = await statusAPI(id).fetch();
          return {
            id: current.id,
            text: current.content
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<[^>]+>/g, ''),
            spoilerText: current.spoilerText || '',
          };
        },
      },
      history: {
        async list() {
          const current = await statusAPI(id).fetch();
          return [
            {
              id: current.id,
              createdAt: current.createdAt,
              account: current.account,
              content: current.content,
              spoilerText: current.spoilerText,
              mediaAttachments: current.mediaAttachments,
              emojis: current.emojis,
              poll: current.poll,
            },
          ];
        },
      },
      rebloggedBy: {
        list({ limit = 80 }: { limit?: number } = {}) {
          return makeCollection<AdaptedAccount[]>(async (cursor) => {
            const res = await agent.app.bsky.feed.getRepostedBy({
              uri,
              limit,
              cursor,
            });
            return {
              cursor: res.data.cursor,
              items: res.data.repostedBy.map((actor) =>
                actorToAccount(actor as unknown as AtprotoActor),
              ),
            };
          });
        },
      },
      favouritedBy: {
        list({ limit = 80 }: { limit?: number } = {}) {
          return makeCollection<AdaptedAccount[]>(async (cursor) => {
            const res = await agent.app.bsky.feed.getLikes({
              uri,
              limit,
              cursor,
            });
            return {
              cursor: res.data.cursor,
              items: res.data.likes.map((like) =>
                actorToAccount(like.actor as unknown as AtprotoActor),
              ),
            };
          });
        },
      },
      quotes: {
        list({ limit = 20 }: { limit?: number } = {}) {
          return makeCollection<AdaptedStatus[]>(async (cursor) => {
            const res = await agent.app.bsky.feed.getQuotes({
              uri,
              limit,
              cursor,
            });
            return {
              cursor: res.data.cursor,
              items: (res.data.posts as unknown as AtprotoPost[]).map((post) =>
                postToStatus(post, agent),
              ),
            };
          });
        },
        $select() {
          return {
            revoke: {
              async create() {
                throw new Error('Bluesky quote removal is not supported');
              },
            },
          };
        },
      },
      interactionPolicy: {
        async update() {
          throw new Error('Bluesky quote settings are not supported');
        },
      },
      async favourite(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        const like = await agent.like(
          current.uri ?? '',
          current._atproto.cid ?? '',
        );
        return {
          ...current,
          favourited: true,
          favouritesCount: current.favouritesCount + 1,
          _atproto: { ...current._atproto, like: like.uri },
        };
      },
      async unfavourite(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        if (current._atproto.like)
          await agent.deleteLike(current._atproto.like);
        return {
          ...current,
          favourited: false,
          favouritesCount: Math.max(0, current.favouritesCount - 1),
        };
      },
      async reblog(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        const repost = await agent.repost(
          current.uri ?? '',
          current._atproto.cid ?? '',
        );
        return {
          ...current,
          reblogged: true,
          reblogsCount: current.reblogsCount + 1,
          _atproto: { ...current._atproto, repost: repost.uri },
        };
      },
      async unreblog(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        if (current._atproto.repost)
          await agent.deleteRepost(current._atproto.repost);
        return {
          ...current,
          reblogged: false,
          reblogsCount: Math.max(0, current.reblogsCount - 1),
        };
      },
      async bookmark(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        await (
          agent.app.bsky as unknown as {
            bookmark: {
              createBookmark: (args: {
                uri: string;
                cid?: string;
              }) => Promise<unknown>;
            };
          }
        ).bookmark.createBookmark({
          uri,
          cid: current._atproto.cid,
        });
        return { ...current, bookmarked: true };
      },
      async unbookmark(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        await (
          agent.app.bsky as unknown as {
            bookmark: {
              deleteBookmark: (args: { uri: string }) => Promise<unknown>;
            };
          }
        ).bookmark.deleteBookmark({ uri });
        return { ...current, bookmarked: false };
      },
      async remove() {
        await agent.app.bsky.feed.post.delete({
          repo: agentLoose.did ?? '',
          rkey: atprotoRkey(uri) ?? '',
        });
        return {};
      },
      async update() {
        throw new Error('Bluesky posts cannot be edited');
      },
      async mute(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        return { ...current, muted: true };
      },
      async unmute(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        return { ...current, muted: false };
      },
      async pin() {
        throw new Error('Bluesky pinned posts are not supported');
      },
      async unpin() {
        throw new Error('Bluesky pinned posts are not supported');
      },
    };
  };

  async function fetchRelationship(id: string): Promise<AdaptedRelationship> {
    const actor = normalizeActor(id);
    const profileRes = await agent.getProfile({ actor: actor ?? '' });
    const relationshipsRes = await agent.app.bsky.graph.getRelationships({
      actor: agentLoose.did ?? '',
      others: [profileRes.data.did],
    });
    return relationshipFromAtproto(
      relationshipsRes.data
        .relationships?.[0] as unknown as AtprotoRelationship,
      profileRes.data as unknown as AtprotoActor,
    );
  }

  const accountAPI = (id: string) => ({
    async fetch(): Promise<AdaptedAccount> {
      const res = await agent.getProfile({ actor: normalizeActor(id) ?? '' });
      return actorToAccount(res.data as unknown as AtprotoActor);
    },
    statuses: {
      list({
        limit = 20,
        exclude_replies: excludeReplies,
        exclude_reblogs: excludeReposts,
        only_media: onlyMedia,
        tagged,
        pinned,
      }: {
        limit?: number;
        exclude_replies?: boolean;
        exclude_reblogs?: boolean;
        only_media?: boolean;
        tagged?: string;
        pinned?: boolean;
      } = {}) {
        if (pinned) return emptyCollection<AdaptedStatus[]>();
        return makeCollection<AdaptedStatus[]>(async (cursor) => {
          const filter = onlyMedia
            ? 'posts_with_media'
            : excludeReplies
              ? 'posts_and_author_threads'
              : 'posts_with_replies';
          const actor = normalizeActor(id);
          const res = await agent.getAuthorFeed({
            actor: actor ?? '',
            limit,
            cursor,
            filter,
            includePins: filter === 'posts_and_author_threads',
          });
          const feed = filterAuthorFeed(
            await hydrateFeedReplyContext(
              res.data.feed as unknown as AtprotoFeedItem[],
              agent,
            ),
            actor,
            filter,
          );
          let items = feedToProfileStatuses(feed, agent);
          if (excludeReposts) items = items.filter((item) => !item.reblog);
          if (onlyMedia) {
            items = items.filter((item) => item.mediaAttachments?.length);
          }
          if (tagged) {
            const tag = tagged.toLowerCase();
            items = items.filter((item) =>
              item.tags?.some((itemTag) => itemTag.name?.toLowerCase() === tag),
            );
          }
          return { cursor: res.data.cursor, items };
        });
      },
    },
    followers: {
      list({ limit = 80 }: { limit?: number } = {}) {
        return makeCollection<AdaptedAccount[]>(async (cursor) => {
          const res = await agent.getFollowers({
            actor: normalizeActor(id) ?? '',
            limit,
            cursor,
          });
          return {
            cursor: res.data.cursor,
            items: res.data.followers.map((actor) =>
              actorToAccount(actor as unknown as AtprotoActor),
            ),
          };
        });
      },
    },
    following: {
      list({ limit = 80 }: { limit?: number } = {}) {
        return makeCollection<AdaptedAccount[]>(async (cursor) => {
          const res = await agent.getFollows({
            actor: normalizeActor(id) ?? '',
            limit,
            cursor,
          });
          return {
            cursor: res.data.cursor,
            items: res.data.follows.map((actor) =>
              actorToAccount(actor as unknown as AtprotoActor),
            ),
          };
        });
      },
    },
    featuredTags: {
      async list(): Promise<never[]> {
        return [];
      },
    },
    endorsements: {
      async list(): Promise<never[]> {
        return [];
      },
    },
    note: {
      async create() {
        throw new Error('Bluesky private notes are not supported');
      },
    },
    async follow(): Promise<AdaptedRelationship> {
      const current = await fetchRelationship(id);
      if (!current.following) {
        const follow = await agent.follow(current.id ?? '');
        return {
          ...current,
          following: true,
          _atproto: { ...current._atproto, following: follow.uri },
        };
      }
      return current;
    },
    async unfollow(): Promise<AdaptedRelationship> {
      const current = await fetchRelationship(id);
      if (current._atproto?.following) {
        await agent.deleteFollow(current._atproto.following);
      }
      return {
        ...current,
        following: false,
        _atproto: { ...current._atproto, following: undefined },
      };
    },
    async mute(): Promise<AdaptedRelationship> {
      const actor = normalizeActor(id) ?? '';
      await agent.mute(actor);
      const current = await fetchRelationship(actor);
      return { ...current, muting: true };
    },
    async unmute(): Promise<AdaptedRelationship> {
      const actor = normalizeActor(id) ?? '';
      await agent.unmute(actor);
      const current = await fetchRelationship(actor);
      return { ...current, muting: false };
    },
    async block(): Promise<AdaptedRelationship> {
      const current = await fetchRelationship(id);
      if (!current.blocking) {
        const block = await agent.app.bsky.graph.block.create(
          { repo: agentLoose.did ?? '' },
          {
            subject: current.id ?? '',
            createdAt: new Date().toISOString(),
          },
        );
        return {
          ...current,
          blocking: true,
          _atproto: { ...current._atproto, blocking: block.uri },
        };
      }
      return current;
    },
    async unblock(): Promise<AdaptedRelationship> {
      const current = await fetchRelationship(id);
      if (current._atproto?.blocking) {
        await agent.app.bsky.graph.block.delete({
          repo: agentLoose.did ?? '',
          rkey: atprotoRkey(current._atproto.blocking) ?? '',
        });
      }
      return {
        ...current,
        blocking: false,
        _atproto: { ...current._atproto, blocking: undefined },
      };
    },
    async pin() {
      throw new Error('Bluesky featured profiles are not supported');
    },
    async unpin() {
      throw new Error('Bluesky featured profiles are not supported');
    },
  });

  const listAPI = (id: string) => {
    const uri = decodeResourceID(id);
    return {
      async fetch(): Promise<AdaptedList> {
        if (uri.includes('/app.bsky.feed.generator/')) {
          const res = await agent.app.bsky.feed.getFeedGenerator({
            feed: uri,
          });
          return feedGeneratorToPhanpyList(
            res.data.view as unknown as AtprotoFeedGenerator,
          );
        }
        const res = await agent.app.bsky.graph.getList({
          list: uri,
          limit: 1,
        });
        return listToPhanpyList(res.data.list as unknown as AtprotoList);
      },
      async update({ title }: { title?: string } = {}): Promise<AdaptedList> {
        if (uri.includes('/app.bsky.feed.generator/')) {
          throw new Error('Feed generators are not editable here');
        }
        const current = await this.fetch();
        await agent.com.atproto.repo.putRecord({
          repo: agentLoose.did ?? '',
          collection: 'app.bsky.graph.list',
          rkey: atprotoRkey(uri) ?? '',
          record: {
            purpose:
              current._atproto?.purpose || 'app.bsky.graph.defs#curatelist',
            name: title || current.title,
            description: '',
            createdAt: new Date().toISOString(),
          },
        });
        return { ...current, title: title || current.title };
      },
      async remove() {
        if (uri.includes('/app.bsky.feed.generator/')) {
          throw new Error('Feed generators are not removable here');
        }
        const listitemURIs: string[] = [];
        let cursor: string | undefined;
        do {
          const res = await agent.app.bsky.graph.listitem.list({
            repo: agentLoose.did ?? '',
            cursor,
            limit: 100,
          });
          listitemURIs.push(
            ...res.records
              .filter(
                (record) =>
                  (record.value as { list?: string } | undefined)?.list === uri,
              )
              .map((record) => record.uri),
          );
          cursor = res.cursor;
        } while (cursor);

        const deleteWrite = (recordURI: string) => ({
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: recordURI.split('/').slice(-2, -1)[0],
          rkey: atprotoRkey(recordURI) ?? '',
        });
        const writes = [...listitemURIs.map(deleteWrite), deleteWrite(uri)];
        for (let i = 0; i < writes.length; i += 10) {
          await agent.com.atproto.repo.applyWrites({
            repo: agentLoose.did ?? '',
            writes: writes.slice(i, i + 10),
          } as unknown as Parameters<
            typeof agent.com.atproto.repo.applyWrites
          >[0]);
        }
        return {};
      },
      accounts: {
        list({ limit = 80 }: { limit?: number } = {}) {
          return makeCollection<AdaptedAccount[]>(async (cursor) => {
            const res = await agent.app.bsky.graph.getList({
              list: uri,
              limit,
              cursor,
            });
            return {
              cursor: res.data.cursor,
              items: res.data.items.map((item) =>
                actorToAccount(item.subject as unknown as AtprotoActor),
              ),
            };
          });
        },
        async create({ accountIds = [] }: { accountIds?: string[] } = {}) {
          if (uri.includes('/app.bsky.feed.generator/')) {
            throw new Error('Feed generators do not have editable members');
          }
          await Promise.all(
            accountIds.map((accountID) =>
              agent.app.bsky.graph.listitem.create(
                { repo: agentLoose.did ?? '' },
                {
                  subject: accountID,
                  list: uri,
                  createdAt: new Date().toISOString(),
                },
              ),
            ),
          );
          return {};
        },
        async remove({ accountIds = [] }: { accountIds?: string[] } = {}) {
          if (uri.includes('/app.bsky.feed.generator/')) {
            throw new Error('Feed generators do not have editable members');
          }
          const ids = new Set(accountIds);
          const removals: Array<{ uri: string }> = [];
          let cursor: string | undefined;
          do {
            const res = await agent.app.bsky.graph.listitem.list({
              repo: agentLoose.did ?? '',
              cursor,
              limit: 100,
            });
            removals.push(
              ...res.records.filter((record) => {
                const value = record.value as
                  | { list?: string; subject?: string }
                  | undefined;
                return value?.list === uri && ids.has(value?.subject ?? '');
              }),
            );
            cursor = res.cursor;
          } while (cursor);
          await Promise.all(
            removals.map((record) =>
              agent.app.bsky.graph.listitem.delete({
                repo: agentLoose.did ?? '',
                rkey: atprotoRkey(record.uri) ?? '',
              }),
            ),
          );
          return {};
        },
      },
    };
  };

  async function fetchNotifications(
    {
      limit = 80,
      types,
      excludeTypes,
    }: {
      limit?: number;
      types?: AdaptedNotificationType[];
      excludeTypes?: AdaptedNotificationType[];
    } = {},
    cursor?: string,
  ): Promise<CollectionPage<AdaptedNotification[]>> {
    const res = await agent.listNotifications({
      limit,
      cursor,
    });
    const allowedTypes = types?.length
      ? new Set<AdaptedNotificationType>(types)
      : null;
    const blockedTypes = excludeTypes?.length
      ? new Set<AdaptedNotificationType>(excludeTypes)
      : null;
    const notifications = (
      res.data.notifications as unknown as AtprotoNotification[]
    ).filter((notification) => {
      const type = notificationType(notification.reason);
      if (allowedTypes && !allowedTypes.has(type)) return false;
      if (blockedTypes?.has(type)) return false;
      return true;
    });
    const statusURIs = [
      ...new Set(
        notifications
          .map((notification) => notificationStatusURI(notification))
          .filter((uri): uri is string => Boolean(uri)),
      ),
    ];
    const posts: AtprotoPost[] = statusURIs.length
      ? await agent
          .getPosts({ uris: statusURIs })
          .then((postsRes) => postsRes.data.posts as unknown as AtprotoPost[])
          .catch(() => [] as AtprotoPost[])
      : [];
    const postMap: Record<string, AdaptedStatus> = Object.fromEntries(
      posts.map((post) => [post.uri as string, postToStatus(post, agent)]),
    );
    const items: AdaptedNotification[] = notifications.map((notification) => {
      const statusURI = notificationStatusURI(notification);
      return {
        id: `${notification.uri}-${notification.indexedAt}`,
        type: notificationType(notification.reason),
        createdAt: notification.indexedAt,
        account: actorToAccount(notification.author),
        status: statusURI ? postMap[statusURI] : undefined,
      };
    });
    const statusRequiredTypes = new Set<AdaptedNotificationType>([
      'favourite',
      'reblog',
      'status',
      'mention',
      'quote',
    ]);
    return {
      cursor: res.data.cursor,
      items: items.filter(
        (item) => !statusRequiredTypes.has(item.type) || item.status,
      ),
    };
  }

  return {
    agent,
    v1: {
      accounts: {
        async verifyCredentials(): Promise<AdaptedAccount> {
          const profile = await agent.getProfile({
            actor: agentLoose.did ?? '',
          });
          return actorToAccount(profile.data as unknown as AtprotoActor);
        },
        async updateCredentials({
          avatar,
          header,
          displayName,
          note,
          source,
        }: {
          avatar?: unknown;
          header?: unknown;
          displayName?: string;
          note?: string;
          source?: unknown;
        } = {}): Promise<AdaptedAccount> {
          if (source) return this.verifyCredentials();
          const current = (await agent.com.atproto.repo
            .getRecord({
              repo: agentLoose.did ?? '',
              collection: 'app.bsky.actor.profile',
              rkey: 'self',
            })
            .then((res) => res.data.value)
            .catch(() => ({
              $type: 'app.bsky.actor.profile',
            }))) as AtprotoRecord;
          const next: AtprotoRecord = {
            ...current,
          };
          if (displayName !== undefined) {
            next.displayName = displayName || '';
          }
          if (note !== undefined) {
            next.description = note || '';
          }
          const avatarBlob = await uploadProfileImage(agent, avatar);
          if (avatarBlob) next.avatar = avatarBlob;
          const headerBlob = await uploadProfileImage(agent, header);
          if (headerBlob) next.banner = headerBlob;
          await agent.com.atproto.repo.putRecord({
            repo: agentLoose.did ?? '',
            collection: 'app.bsky.actor.profile',
            rkey: 'self',
            record: next,
          });
          return this.verifyCredentials();
        },
        async lookup({ acct }: { acct: string }): Promise<AdaptedAccount> {
          const profile = await agent.getProfile({
            actor: normalizeActor(acct) ?? '',
          });
          return actorToAccount(profile.data as unknown as AtprotoActor);
        },
        $select: accountAPI,
        relationships: {
          async fetch({ id }: { id?: string | string[] } = {}): Promise<
            AdaptedRelationship[]
          > {
            const ids = Array.isArray(id)
              ? id
              : ([id].filter(Boolean) as string[]);
            if (!ids.length) return [];
            const profilesRes = await agent.getProfiles({
              actors: ids.map((value) => normalizeActor(value) ?? ''),
            });
            const relationshipsRes =
              await agent.app.bsky.graph.getRelationships({
                actor: agentLoose.did ?? '',
                others: ids.map((value) => normalizeActor(value) ?? ''),
              });
            const profiles: Record<string, AtprotoActor> = Object.fromEntries(
              (profilesRes.data.profiles as unknown as AtprotoActor[]).map(
                (profile) => [profile.did ?? '', profile],
              ),
            );
            return (
              relationshipsRes.data
                .relationships as unknown as AtprotoRelationship[]
            ).map((relationship) =>
              relationshipFromAtproto(
                relationship,
                profiles[relationship.did ?? ''],
              ),
            );
          },
        },
        familiarFollowers: {
          async fetch({ id }: { id?: string | string[] } = {}): Promise<
            Array<{ id: string; accounts: never[] }>
          > {
            const ids = Array.isArray(id)
              ? id
              : ([id].filter(Boolean) as string[]);
            return ids.map((accountID) => ({ id: accountID, accounts: [] }));
          },
        },
        search: {
          async list({
            q,
            limit = 10,
            cursor,
          }: { q?: string; limit?: number; cursor?: string } = {}) {
            const res = await agent.searchActors({
              q: q || '',
              limit,
              cursor,
            });
            const accounts = (res.data.actors as unknown as AtprotoActor[]).map(
              actorToAccount,
            ) as AdaptedAccount[] & { _pagination?: { cursor?: string } };
            accounts._pagination = { cursor: res.data.cursor };
            return accounts;
          },
        },
      },
      timelines: {
        home: {
          list({ limit = 20 }: { limit?: number } = {}) {
            return makeCollection<AdaptedStatus[]>(async (cursor) => {
              const res = await agent.getTimeline({ limit, cursor });
              const feed = await hydrateFeedReplyContext(
                res.data.feed as unknown as AtprotoFeedItem[],
                agent,
              );
              const processedFeed = postProcessFollowingFeed(
                feed,
                agentLoose.did,
              );
              return {
                cursor: res.data.cursor,
                items: feedToStatuses(processedFeed, agent),
              };
            });
          },
        },
        public: {
          list({ limit = 20 }: { limit?: number } = {}) {
            return makeCollection<AdaptedStatus[]>(async (cursor) => {
              const res = await agent.app.bsky.feed.getFeed({
                feed: BSKY_DISCOVER_FEED,
                limit,
                cursor,
              });
              const feed = await hydrateFeedReplyContext(
                res.data.feed as unknown as AtprotoFeedItem[],
                agent,
              );
              return {
                cursor: res.data.cursor,
                items: feedToStatuses(feed, agent),
              };
            });
          },
        },
        tag: {
          $select(tag: string) {
            return {
              list({
                limit = 20,
                any = [],
                onlyMedia,
              }: {
                limit?: number;
                any?: string[];
                onlyMedia?: boolean;
              } = {}) {
                const q = [tag, ...any]
                  .filter(Boolean)
                  .map((value) => `#${value.replace(/^#/, '')}`)
                  .join(' ');
                return makeCollection<AdaptedStatus[]>(async (cursor) => {
                  const res = await agent.app.bsky.feed.searchPosts({
                    q,
                    limit,
                    cursor,
                  });
                  let items = (res.data.posts as unknown as AtprotoPost[]).map(
                    (post) => postToStatus(post, agent),
                  );
                  if (onlyMedia) {
                    items = items.filter(
                      (item) => item.mediaAttachments?.length,
                    );
                  }
                  return { cursor: res.data.cursor, items };
                });
              },
            };
          },
        },
        link: {
          list({ url, limit = 20 }: { url?: string; limit?: number } = {}) {
            if (!url) return emptyCollection<AdaptedStatus[]>();
            return makeCollection<AdaptedStatus[]>(async (cursor) => {
              const res = await agent.app.bsky.feed.searchPosts({
                q: url,
                limit,
                cursor,
              });
              return {
                cursor: res.data.cursor,
                items: (res.data.posts as unknown as AtprotoPost[]).map(
                  (post) => postToStatus(post, agent),
                ),
              };
            });
          },
        },
        list: {
          $select(id: string) {
            const uri = decodeResourceID(id);
            return {
              list({ limit = 20 }: { limit?: number } = {}) {
                return makeCollection<AdaptedStatus[]>(async (cursor) => {
                  const method = uri.includes('/app.bsky.feed.generator/')
                    ? 'getFeed'
                    : 'getListFeed';
                  const key = method === 'getFeed' ? 'feed' : 'list';
                  const feedApi = agent.app.bsky.feed as unknown as Record<
                    string,
                    (args: Record<string, unknown>) => Promise<{
                      data: { feed: unknown[]; cursor?: string };
                    }>
                  >;
                  const res = await feedApi[method]({
                    [key]: uri,
                    limit,
                    cursor,
                  });
                  const feed = await hydrateFeedReplyContext(
                    res.data.feed as unknown as AtprotoFeedItem[],
                    agent,
                  );
                  return {
                    cursor: res.data.cursor,
                    items: feedToStatuses(feed, agent),
                  };
                });
              },
            };
          },
        },
      },
      lists: {
        async list(): Promise<AdaptedList[]> {
          const lists: AdaptedList[] = [];
          let cursor: string | undefined;
          do {
            const res = await agent.app.bsky.graph.getLists({
              actor: agentLoose.did ?? '',
              limit: 50,
              cursor,
            });
            lists.push(
              ...(res.data.lists as unknown as AtprotoList[])
                .filter(
                  (list) => list.purpose === 'app.bsky.graph.defs#curatelist',
                )
                .map(listToPhanpyList),
            );
            cursor = res.data.cursor;
          } while (cursor);
          const preferences = await agent.getPreferences().catch(() => null);
          const savedFeeds =
            (
              preferences as unknown as {
                savedFeeds?: Array<{ type?: string; value: string }>;
              } | null
            )?.savedFeeds || [];
          const savedFeedURIs = [
            BSKY_DISCOVER_FEED,
            ...savedFeeds
              .filter((feed) => feed.type === 'feed')
              .map((feed) => feed.value),
          ];
          const feedViews: AtprotoFeedGenerator[] = savedFeedURIs.length
            ? await agent.app.bsky.feed
                .getFeedGenerators({
                  feeds: [...new Set(savedFeedURIs)],
                })
                .then(
                  (res) => res.data.feeds as unknown as AtprotoFeedGenerator[],
                )
                .catch(() => [] as AtprotoFeedGenerator[])
            : [];
          const actorFeeds: AtprotoFeedGenerator[] = await agent.app.bsky.feed
            .getActorFeeds({
              actor: agentLoose.did ?? '',
              limit: 100,
            })
            .then((res) => res.data.feeds as unknown as AtprotoFeedGenerator[])
            .catch(() => [] as AtprotoFeedGenerator[]);
          const savedLists = await Promise.all(
            savedFeeds
              .filter((feed) => feed.type === 'list')
              .map((feed) =>
                agent.app.bsky.graph
                  .getList({ list: feed.value, limit: 1 })
                  .then((res) =>
                    listToPhanpyList(res.data.list as unknown as AtprotoList),
                  )
                  .catch(() => null),
              ),
          );
          const allLists = [
            ...lists,
            ...feedViews.map(feedGeneratorToPhanpyList),
            ...actorFeeds.map(feedGeneratorToPhanpyList),
            ...savedLists.filter((list): list is AdaptedList => Boolean(list)),
          ];
          return [...new Map(allLists.map((list) => [list.id, list])).values()];
        },
        $select: listAPI,
        async create({ title }: { title?: string } = {}): Promise<AdaptedList> {
          const res = await agent.app.bsky.graph.list.create(
            { repo: agentLoose.did ?? '' },
            {
              purpose: 'app.bsky.graph.defs#curatelist',
              name: title || 'List',
              description: '',
              createdAt: new Date().toISOString(),
            },
          );
          return listAPI(encodeURIComponent(res.uri)).fetch();
        },
      },
      bookmarks: {
        list({ limit = 20 }: { limit?: number } = {}) {
          return makeCollection<AdaptedStatus[]>(async (cursor) => {
            const res = await (
              agent.app.bsky as unknown as {
                bookmark: {
                  getBookmarks: (args: {
                    limit?: number;
                    cursor?: string;
                  }) => Promise<{
                    data: { bookmarks: unknown[]; cursor?: string };
                  }>;
                };
              }
            ).bookmark.getBookmarks({
              limit,
              cursor,
            });
            // FIXME (pre-existing bug, preserved by this type migration):
            // `getBookmarks()` returns `BookmarkView[]` wrappers where the
            // actual post is under `.item` and may be a PostView, a
            // NotFoundPost, or a BlockedPost. The original JS adapter passed
            // each wrapper straight to `postToStatus`, which then sees
            // `post.author === undefined` / `post.record === undefined` and
            // emits a malformed status. This batch keeps that behavior
            // verbatim — fixing the unwrap is a runtime change that belongs
            // in its own commit, not a TypeScript migration. The wrapper is
            // typed as `unknown` so no incorrect shape claim is introduced.
            return {
              cursor: res.data.cursor,
              items: res.data.bookmarks.map((bookmark) =>
                postToStatus(
                  bookmark as
                    | AtprotoFeedItem
                    | AtprotoPost
                    | AtprotoReplyRefLike
                    | undefined,
                  agent,
                ),
              ),
            };
          });
        },
      },
      favourites: {
        list({ limit = 20 }: { limit?: number } = {}) {
          return makeCollection<AdaptedStatus[]>(async (cursor) => {
            const res = await agent.app.bsky.feed.getActorLikes({
              actor: agentLoose.did ?? '',
              limit,
              cursor,
            });
            const feed = await hydrateFeedReplyContext(
              res.data.feed as unknown as AtprotoFeedItem[],
              agent,
            );
            return {
              cursor: res.data.cursor,
              items: feedToStatuses(feed, agent),
            };
          });
        },
      },
      mutes: {
        list({ limit = 80 }: { limit?: number } = {}) {
          return makeCollection<AdaptedAccount[]>(async (cursor) => {
            const res = await agent.app.bsky.graph.getMutes({
              limit,
              cursor,
            });
            return {
              cursor: res.data.cursor,
              items: (res.data.mutes as unknown as AtprotoActor[]).map(
                actorToAccount,
              ),
            };
          });
        },
      },
      blocks: {
        list({ limit = 80 }: { limit?: number } = {}) {
          return makeCollection<AdaptedAccount[]>(async (cursor) => {
            const res = await agent.app.bsky.graph.getBlocks({
              limit,
              cursor,
            });
            return {
              cursor: res.data.cursor,
              items: (res.data.blocks as unknown as AtprotoActor[]).map(
                actorToAccount,
              ),
            };
          });
        },
      },
      tags: {
        $select(name: string) {
          return {
            async fetch() {
              return {
                name,
                url: `/t/${encodeURIComponent(name)}`,
                history: [],
                following: false,
              };
            },
            async follow() {
              throw new Error('Bluesky hashtag follows are not supported');
            },
            async unfollow() {
              throw new Error('Bluesky hashtag follows are not supported');
            },
          };
        },
      },
      followedTags: {
        list() {
          return emptyCollection<unknown[]>();
        },
      },
      featuredTags: {
        async list(): Promise<never[]> {
          return [];
        },
        async create() {
          throw new Error('Bluesky featured hashtags are not supported');
        },
        $select() {
          return {
            async remove() {
              throw new Error('Bluesky featured hashtags are not supported');
            },
          };
        },
      },
      trends: {
        tags: {
          list() {
            return emptyCollection<unknown[]>();
          },
        },
        links: {
          list() {
            return emptyCollection<unknown[]>();
          },
        },
        statuses: {
          list({ limit = 20 }: { limit?: number } = {}) {
            return makeCollection<AdaptedStatus[]>(async (cursor) => {
              const res = await agent.app.bsky.feed.getFeed({
                feed: BSKY_DISCOVER_FEED,
                limit,
                cursor,
              });
              const feed = await hydrateFeedReplyContext(
                res.data.feed as unknown as AtprotoFeedItem[],
                agent,
              );
              return {
                cursor: res.data.cursor,
                items: feedToStatuses(feed, agent),
              };
            });
          },
        },
      },
      notifications: {
        list(
          opts: {
            limit?: number;
            types?: AdaptedNotificationType[];
            excludeTypes?: AdaptedNotificationType[];
          } = {},
        ) {
          return makeCollection<AdaptedNotification[]>((cursor) =>
            fetchNotifications(opts, cursor),
          );
        },
        $select(id: string) {
          return {
            async fetch(): Promise<AdaptedNotification> {
              let cursor: string | undefined;
              for (let page = 0; page < 5; page++) {
                const res = await fetchNotifications({ limit: 80 }, cursor);
                const notification = res.items.find((item) => item.id === id);
                if (notification) return notification;
                if (!res.cursor) break;
                cursor = res.cursor;
              }
              throw new Error('Notification not found');
            },
          };
        },
        requests: {
          async list(): Promise<never[]> {
            return [];
          },
          $select(id: string) {
            return {
              async accept() {
                return { id };
              },
              async dismiss() {
                return { id };
              },
            };
          },
        },
      },
      conversations: {
        list() {
          return emptyCollection<unknown[]>();
        },
        $select() {
          return {
            async read() {
              return {};
            },
          };
        },
      },
      announcements: {
        async list(): Promise<never[]> {
          return [];
        },
      },
      push: {
        subscription: {
          async fetch() {
            throw new Error('Push subscription not found');
          },
          async create() {
            throw new Error('Bluesky push subscriptions are not supported');
          },
          async update() {
            throw new Error('Bluesky push subscriptions are not supported');
          },
          async remove() {
            return {};
          },
        },
      },
      markers: {
        async create() {
          return {};
        },
        async fetch() {
          return {};
        },
      },
      customEmojis: {
        async list(): Promise<never[]> {
          return [];
        },
      },
      followRequests: {
        async list(): Promise<never[]> {
          return [];
        },
        $select(id: string) {
          return {
            async authorize() {
              return relationshipFor(id);
            },
            async reject() {
              return relationshipFor(id);
            },
          };
        },
      },
      scheduledStatuses: {
        list() {
          return emptyCollection<unknown[]>();
        },
        $select() {
          return {
            async update() {
              throw new Error('Bluesky scheduled posts are not supported');
            },
            async remove() {
              throw new Error('Bluesky scheduled posts are not supported');
            },
          };
        },
      },
      statuses: {
        $select: statusAPI,
        async list({ id }: { id?: string | string[] } = {}): Promise<
          AdaptedStatus[]
        > {
          const ids = Array.isArray(id)
            ? id
            : ([id].filter(Boolean) as string[]);
          if (!ids.length) return [];
          const uris = ids.map((value) => decodeURIComponent(value));
          const res = await agent.getPosts({ uris });
          return (res.data.posts as unknown as AtprotoPost[]).map((post) =>
            postToStatus(post, agent),
          );
        },
        async create(
          params: {
            status?: string;
            scheduled_at?: string;
            scheduledAt?: string;
            poll?: unknown;
            in_reply_to_id?: string;
            inReplyToId?: string;
            quoted_status_id?: string;
            quote_id?: string;
            quoteId?: string;
            media_ids?: string[];
            mediaIds?: string[];
            disable_card?: boolean;
            disableCard?: boolean;
            card_url?: string;
            cardUrl?: string;
            external_url?: string;
            externalUrl?: string;
          } = {},
        ): Promise<AdaptedStatus> {
          if (params.scheduled_at || params.scheduledAt) {
            throw new Error('Bluesky scheduled posts are not supported');
          }
          if (params.poll) {
            throw new Error('Bluesky polls are not supported');
          }
          const inReplyToId = params.in_reply_to_id || params.inReplyToId;
          const quoteId =
            params.quoted_status_id || params.quote_id || params.quoteId;
          const rt = new RichText({ text: params.status || '' });
          await rt.detectFacets(agent);
          const record: AtprotoPostRecord = {
            text: rt.text,
            facets: rt.facets as unknown as AtprotoFacet[],
            createdAt: new Date().toISOString(),
          };
          if (inReplyToId) {
            const parent = await statusAPI(inReplyToId).fetch();
            const root: AtprotoStrongRef = parent._atproto?.root || {
              uri: parent.uri ?? '',
              cid: parent._atproto.cid ?? '',
            };
            record.reply = {
              root,
              parent: {
                uri: parent.uri ?? '',
                cid: parent._atproto.cid ?? '',
              },
            };
          }
          if (quoteId) {
            const quote = await statusAPI(quoteId).fetch();
            record.embed = {
              $type: 'app.bsky.embed.record',
              record: {
                uri: quote.uri,
                cid: quote._atproto.cid,
              },
            } as unknown as AtprotoEmbed;
          }
          const mediaIds = params.media_ids || params.mediaIds || [];
          if (mediaIds.length) {
            const media = mediaIds
              .map((id) => uploadedMedia.get(id))
              .filter((item): item is AdaptedUploadedMedia =>
                Boolean(item?.blob),
              );
            const videos = media.filter((item) => item.type === 'video');
            const images = media
              .filter((item) => item.type === 'image')
              .map((item) => ({
                image: item.blob,
                alt: item.description || '',
              }));
            if (videos.length && images.length) {
              throw new Error('Bluesky posts cannot mix images and video');
            }
            if (videos.length > 1) {
              throw new Error('Bluesky posts support one video');
            }
            if (videos.length) {
              const videoEmbed = {
                $type: 'app.bsky.embed.video',
                video: videos[0].blob,
                alt: videos[0].description || '',
              };
              if (record.embed) {
                record.embed = {
                  $type: 'app.bsky.embed.recordWithMedia',
                  record: record.embed,
                  media: videoEmbed,
                } as unknown as AtprotoEmbed;
              } else {
                record.embed = videoEmbed as unknown as AtprotoEmbed;
              }
            } else if (images.length) {
              if (record.embed) {
                record.embed = {
                  $type: 'app.bsky.embed.recordWithMedia',
                  record: record.embed,
                  media: {
                    $type: 'app.bsky.embed.images',
                    images,
                  },
                } as unknown as AtprotoEmbed;
              } else {
                record.embed = {
                  $type: 'app.bsky.embed.images',
                  images,
                } as unknown as AtprotoEmbed;
              }
            }
          }
          if (!record.embed && !(params.disable_card || params.disableCard)) {
            const externalUrl =
              params.card_url ||
              params.cardUrl ||
              params.external_url ||
              params.externalUrl ||
              getFirstPostURL(rt.text);
            const externalEmbed = externalUrl
              ? await createAtprotoExternalEmbed(
                  agent as unknown as Agent,
                  externalUrl,
                )
              : null;
            if (externalEmbed) {
              record.embed = externalEmbed as unknown as AtprotoEmbed;
            }
          }
          const res = await agent.post(
            record as unknown as Parameters<typeof agent.post>[0],
          );
          const id = encodeAtprotoID(res.uri);
          for (let i = 0; i < 10; i++) {
            try {
              return await statusAPI(id).fetch();
            } catch {
              await wait(500);
            }
          }
          const profile = await agent.getProfile({
            actor: agentLoose.did ?? '',
          });
          return postToStatus(
            {
              uri: res.uri,
              cid: res.cid,
              author: profile.data as unknown as AtprotoActor,
              record,
              reply: record.reply as
                | { root?: AtprotoReplyRefLike; parent?: AtprotoReplyRefLike }
                | undefined,
            },
            agent,
          );
        },
      },
      polls: {
        $select(_id: string) {
          return {
            async fetch() {
              throw new Error('Bluesky polls are not supported');
            },
            votes: {
              async create() {
                throw new Error('Bluesky polls are not supported');
              },
            },
          };
        },
      },
      annualReports: {
        $select(year: number | string) {
          return {
            async fetch() {
              return {
                accounts: [],
                statuses: [],
                annualReports: [{ year, data: {} }],
              };
            },
          };
        },
      },
      media: {
        async create({
          file,
          description,
        }: { file?: File; description?: string } = {}) {
          return createMediaUpload({
            agent,
            uploadedMedia,
            file,
            description,
          });
        },
      },
      instance: {
        async fetch() {
          return atprotoInstanceInfo();
        },
      },
      preferences: {
        async fetch(): Promise<Record<string, never>> {
          return {};
        },
      },
      reports: {
        async create({
          accountId,
          statusIds,
          category,
          comment,
        }: {
          accountId?: string;
          statusIds?: string[];
          category?: string;
          comment?: string;
        } = {}) {
          let subject: Record<string, unknown> = {
            $type: 'com.atproto.admin.defs#repoRef',
            did: normalizeActor(accountId) ?? '',
          };
          if (statusIds?.length) {
            const status = await statusAPI(statusIds[0]).fetch();
            subject = {
              $type: 'com.atproto.repo.strongRef',
              uri: status.uri,
              cid: status._atproto.cid,
            };
          }
          return agent.com.atproto.moderation.createReport({
            reasonType:
              category === 'spam'
                ? 'com.atproto.moderation.defs#reasonSpam'
                : 'com.atproto.moderation.defs#reasonViolation',
            reason: comment,
            subject,
          } as unknown as Parameters<
            typeof agent.com.atproto.moderation.createReport
          >[0]);
        },
      },
    },
    v2: {
      media: {
        async create(params: { file?: File; description?: string } = {}) {
          return this._create(params);
        },
        async _create({
          file,
          description,
        }: { file?: File; description?: string } = {}) {
          return createMediaUpload({
            agent,
            uploadedMedia,
            file,
            description,
          });
        },
      },
      instance: {
        async fetch() {
          return atprotoInstanceInfo();
        },
      },
      notifications: {
        list(
          opts: {
            limit?: number;
            types?: AdaptedNotificationType[];
            excludeTypes?: AdaptedNotificationType[];
          } = {},
        ) {
          return makeCollection<GroupedNotificationsItems>((cursor) =>
            fetchNotifications(opts, cursor).then(toGroupedNotificationsPage),
          );
        },
        policy: {
          async fetch(): Promise<Record<string, never>> {
            return {};
          },
          async update(policy: Record<string, unknown> = {}) {
            return policy;
          },
        },
      },
      filters: {
        async list(): Promise<never[]> {
          return [];
        },
        async create() {
          throw new Error('Bluesky filters are not supported');
        },
        $select() {
          return {
            async update() {
              throw new Error('Bluesky filters are not supported');
            },
            async remove() {
              throw new Error('Bluesky filters are not supported');
            },
          };
        },
      },
      search: {
        async fetch(params: Parameters<typeof this.list>[0] = {}) {
          return this.list(params);
        },
        async list({
          q = '',
          type,
          limit = 20,
          cursor,
          sort,
        }: {
          q?: string;
          type?: 'accounts' | 'statuses' | 'hashtags';
          limit?: number;
          cursor?: string;
          sort?: string;
        } = {}) {
          const wanted = type ? [type] : ['accounts', 'statuses', 'hashtags'];
          const results: {
            accounts: AdaptedAccount[];
            statuses: AdaptedStatus[];
            hashtags: AdaptedTag[];
            _pagination: { accounts?: string; statuses?: string };
          } = {
            accounts: [],
            statuses: [],
            hashtags: [],
            _pagination: {},
          };

          if (wanted.includes('accounts')) {
            try {
              const res = await agent.searchActors({
                q,
                limit,
                cursor,
              });
              results.accounts = (
                res.data.actors as unknown as AtprotoActor[]
              ).map(actorToAccount);
              results._pagination.accounts = res.data.cursor;
            } catch (err) {
              if (wanted.length === 1) throw err;
            }
          }

          if (wanted.includes('statuses')) {
            try {
              const res = await agent.app.bsky.feed.searchPosts({
                q,
                limit,
                cursor,
                sort,
              } as unknown as Parameters<
                typeof agent.app.bsky.feed.searchPosts
              >[0]);
              results.statuses = (
                res.data.posts as unknown as AtprotoPost[]
              ).map((post) => postToStatus(post, agent));
              results._pagination.statuses = res.data.cursor;
            } catch (err) {
              if (wanted.length === 1) throw err;
            }
          }

          if (wanted.includes('hashtags')) {
            const tag = q.replace(/^#/, '').trim();
            results.hashtags = tag
              ? [
                  {
                    name: tag,
                    url: `/t/${encodeURIComponent(tag)}`,
                    history: [],
                  },
                ]
              : [];
          }

          return results;
        },
      },
    },
  };
}

export function atprotoInstanceInfo() {
  return {
    uri: BSKY_INSTANCE,
    domain: BSKY_INSTANCE,
    title: 'Bluesky',
    version: '4.4.0 (compatible; Bluesky ATProto)',
    sourceUrl: 'https://github.com/bluesky-social/social-app',
    configuration: {
      statuses: {
        maxCharacters: 300,
        maxMediaAttachments: 4,
      },
      mediaAttachments: {
        supportedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'video/mp4',
        ],
        imageSizeLimit: 1_000_000,
        videoSizeLimit: 100_000_000,
        descriptionLimit: 1_000,
      },
      polls: {
        maxOptions: 0,
      },
    },
    apiVersions: { mastodon: 7 },
  };
}

export async function loginAtproto({
  identifier,
  password,
  service,
}: {
  identifier: string;
  password: string;
  service?: string;
}) {
  service = await resolveAtprotoLoginService({ identifier, service });
  const agent = new AtpAgent({ service });
  await agent.login({ identifier, password });
  const profile = await agent.getProfile({
    actor: (agent as unknown as { did?: string }).did ?? '',
  });
  return {
    agent,
    account: actorToAccount(profile.data as unknown as AtprotoActor),
    session: agent.session,
    service,
  };
}

export function createPublicAtprotoClient() {
  return createAtprotoClient({ service: BSKY_APPVIEW });
}

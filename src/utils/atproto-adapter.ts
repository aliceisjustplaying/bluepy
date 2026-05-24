import {
  type Agent,
  type AppBskyActorDefs,
  type AppBskyEmbedExternal,
  type AppBskyEmbedImages,
  type AppBskyEmbedRecord,
  type AppBskyEmbedRecordWithMedia,
  type AppBskyEmbedVideo,
  type AppBskyFeedDefs,
  type AppBskyFeedPost,
  type AppBskyGraphDefs,
  type AppBskyLabelerDefs,
  type AppBskyNotificationListNotifications,
  AppBskyVideoDefs,
  AppBskyRichtextFacet,
  type BskyPreferences,
  AtpAgent,
  type AtpAgentOptions,
  type AtpPersistSessionHandler,
  type AtpSessionData,
  BlobRef,
  type ComAtprotoModerationCreateReport,
  type ComAtprotoRepoApplyWrites,
  type ComAtprotoRepoStrongRef,
  interpretLabelValueDefinitions,
  type $Typed,
  RichText,
} from '@atproto/api';
import { getPdsEndpoint, isValidDidDoc } from '@atproto/common-web';

import { prepareAtprotoImageUpload } from './atproto-image-compression';
import { setBookmarkOverride } from './bookmark-overrides';
import {
  type AtprotoLabel,
  type AtprotoLabelDefinitionMap,
  type AtprotoLabelerInfoMap,
  normalizeAtprotoLabelerDids,
  normalizeAtprotoLabels,
} from './atproto-labels';
import { BSKY_PDS, resolveAtprotoLoginService } from './atproto-login-service';
import { createAtprotoOAuthAgent } from './atproto-oauth';
import { encodeAtprotoID } from './atproto-route';
import { createAtprotoExternalEmbed, getFirstPostURL } from './atproto-unfurl';
import store from './store';

const BSKY_APPVIEW = 'https://public.api.bsky.app';
const BSKY_APPVIEW_DID = 'did:web:api.bsky.app';
const BSKY_APPVIEW_PROXY = `${BSKY_APPVIEW_DID}#bsky_appview`;

const BLACKSKY_APPVIEW = 'https://api.blacksky.community';
const BLACKSKY_APPVIEW_DID = 'did:web:api.blacksky.community';
const BLACKSKY_APPVIEW_PROXY = `${BLACKSKY_APPVIEW_DID}#bsky_appview`;

export const APPVIEW_OPTIONS: Record<
  string,
  { label: string; url: string; proxy: string }
> = {
  bluesky: {
    label: 'Bluesky',
    url: BSKY_APPVIEW,
    proxy: BSKY_APPVIEW_PROXY,
  },
  blacksky: {
    label: 'Blacksky',
    url: BLACKSKY_APPVIEW,
    proxy: BLACKSKY_APPVIEW_PROXY,
  },
};

export function getActiveAppview(): string {
  return store.local.get('settings-appview') || 'bluesky';
}

export function applyAppviewTheme(appview?: string): void {
  const active = appview ?? getActiveAppview();
  document.documentElement.dataset.appview = active;
}

function getActiveAppviewConfig() {
  return APPVIEW_OPTIONS[getActiveAppview()] ?? APPVIEW_OPTIONS.bluesky;
}

export const BSKY_INSTANCE = 'bsky.social';
const BSKY_DISCOVER_FEED =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';
const BSKY_GET_POSTS_LIMIT = 25;
const BSKY_FOLLOWING_FILL_MAX_PAGES = 5;
const BSKY_THREAD_CONTEXT_DEPTH = 1000;
const BSKY_VIDEO_SERVICE = 'https://video.bsky.app';
const BSKY_VIDEO_SERVICE_DID = 'did:web:video.bsky.app';

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
  cid?: string;
  [key: string]: unknown;
}

type BlobRefLike = BlobRef;
type TypedRecordEmbed = $Typed<AppBskyEmbedRecord.Main>;
type TypedVideoEmbed = $Typed<AppBskyEmbedVideo.Main>;
type TypedImagesEmbed = $Typed<AppBskyEmbedImages.Main>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

interface AtprotoAgentSessionManagerInternals {
  pdsUrl?: URL;
  getTokenInfo?: () => Promise<{ aud?: string } | undefined>;
  session?: AtpSessionData;
}

interface AtprotoAgentInternals {
  did?: string;
  sessionManager?: AtprotoAgentSessionManagerInternals;
  dispatchUrl?: string | URL;
}

interface AtprotoProxyAgent {
  configureProxy: (proxy: string | null) => void;
}

interface AtprotoCloneableProxyAgent extends AtprotoProxyAgent {
  clone: () => AtprotoAgent;
}

interface AtprotoLabelersAgent {
  appLabelers?: readonly string[];
  configureLabelers?: (labelerDids: readonly string[]) => void;
  getLabelers?: (params: {
    dids: string[];
    detailed?: boolean;
  }) => Promise<{ data?: { views?: unknown[] } }>;
  getLabelDefinitions?: (
    prefs: BskyPreferences | readonly string[],
  ) => Promise<AtprotoLabelDefinitionMap>;
}

type AtprotoOAuthAgentSession = NonNullable<
  Parameters<typeof createAtprotoOAuthAgent>[0]
>;

function toAtpSessionData(value: unknown): AtpSessionData | null {
  if (
    !isRecord(value) ||
    typeof value.refreshJwt !== 'string' ||
    typeof value.accessJwt !== 'string' ||
    typeof value.handle !== 'string' ||
    typeof value.did !== 'string'
  ) {
    return null;
  }
  const sessionData: AtpSessionData = {
    refreshJwt: value.refreshJwt,
    accessJwt: value.accessJwt,
    handle: value.handle,
    did: value.did,
    active: typeof value.active === 'boolean' ? value.active : true,
  };
  if (typeof value.email === 'string') sessionData.email = value.email;
  if (typeof value.emailConfirmed === 'boolean') {
    sessionData.emailConfirmed = value.emailConfirmed;
  }
  if (typeof value.emailAuthFactor === 'boolean') {
    sessionData.emailAuthFactor = value.emailAuthFactor;
  }
  if (typeof value.status === 'string') sessionData.status = value.status;
  return sessionData;
}

function isAgentSessionManager(
  value: unknown,
): value is AtprotoAgentSessionManagerInternals {
  if (!isRecord(value)) return false;
  return (
    (value.pdsUrl === undefined || value.pdsUrl instanceof URL) &&
    (value.getTokenInfo === undefined ||
      typeof value.getTokenInfo === 'function') &&
    (value.session === undefined || toAtpSessionData(value.session) !== null)
  );
}

function isAtprotoAgentInternals(
  value: unknown,
): value is AtprotoAgentInternals {
  if (!isRecord(value)) return false;
  return (
    (value.did === undefined || typeof value.did === 'string') &&
    (value.sessionManager === undefined ||
      isAgentSessionManager(value.sessionManager)) &&
    (value.dispatchUrl === undefined ||
      typeof value.dispatchUrl === 'string' ||
      value.dispatchUrl instanceof URL)
  );
}

function isAtprotoProxyAgent(value: unknown): value is AtprotoProxyAgent {
  return isRecord(value) && typeof value.configureProxy === 'function';
}

function isAtprotoLabelersAgent(value: unknown): value is AtprotoLabelersAgent {
  return (
    isRecord(value) &&
    (typeof value.configureLabelers === 'function' ||
      typeof value.getLabelers === 'function' ||
      typeof value.getLabelDefinitions === 'function')
  );
}

function isAtprotoCloneableProxyAgent(
  value: unknown,
): value is AtprotoCloneableProxyAgent {
  return (
    isAtprotoProxyAgent(value) &&
    isRecord(value) &&
    typeof value.clone === 'function'
  );
}

function isAtprotoOAuthAgentSession(
  value: unknown,
): value is AtprotoOAuthAgentSession {
  return (
    typeof value === 'function' ||
    (isRecord(value) && typeof value.fetchHandler === 'function')
  );
}

function isAtprotoActor(value: unknown): value is AtprotoActor {
  return isRecord(value);
}

function isAtprotoPostRecord(value: unknown): value is AtprotoPostRecord {
  return isRecord(value);
}

function isAtprotoRelationship(value: unknown): value is AtprotoRelationship {
  return isRecord(value) && typeof value.did === 'string';
}

type AtprotoActor = Partial<
  Omit<AppBskyActorDefs.ProfileViewDetailed, '$type'>
> &
  Partial<Omit<AppBskyActorDefs.ProfileView, '$type'>> &
  Partial<Omit<AppBskyActorDefs.ProfileViewBasic, '$type'>> & {
    $type?: string;
  };

type AtprotoFacet = AppBskyRichtextFacet.Main;

interface AtprotoReplyRefLike {
  $type?: string;
  uri?: string;
  cid?: string;
  author?: AtprotoActor;
  record?: AtprotoPostRecord;
  value?: AtprotoPostRecord;
}

interface AtprotoEmbedImage
  extends
    Partial<Omit<AppBskyEmbedImages.ViewImage, '$type'>>,
    Partial<Omit<AppBskyEmbedImages.Image, '$type'>> {}

type AtprotoEmbedExternal =
  | AppBskyEmbedExternal.ViewExternal
  | AppBskyEmbedExternal.External
  | (Partial<AppBskyEmbedExternal.External> & {
      uri: string;
      associatedRecord?: unknown;
      associated_record?: unknown;
    });

interface AtprotoEmbedVideo
  extends
    Partial<Omit<AppBskyEmbedVideo.View, '$type' | 'aspectRatio'>>,
    Partial<Omit<AppBskyEmbedVideo.Main, '$type' | 'aspectRatio'>> {
  thumb?: string;
  aspectRatio?: { width?: number; height?: number };
}

interface AtprotoEmbedRecord {
  uri?: string;
  cid?: string;
  author?: AtprotoActor;
  value?: AtprotoRecord;
  record?: AtprotoEmbedRecord;
  embeds?: AtprotoEmbed[];
  labels?: unknown[];
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
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
}

type AtprotoEmbedInput =
  | AtprotoEmbed
  | AtprotoEmbed[]
  | AppBskyFeedDefs.PostView['embed']
  | AppBskyFeedPost.Record['embed']
  | undefined;

function isAtprotoEmbedObject(embed: AtprotoEmbedInput): embed is AtprotoEmbed {
  return isRecord(embed);
}

interface AtprotoPostRecord extends Partial<
  Omit<AppBskyFeedPost.Record, 'reply' | 'embed'>
> {
  text?: string;
  facets?: AtprotoFacet[];
  langs?: string[];
  createdAt?: string;
  reply?: {
    root?: AtprotoReplyRefLike;
    parent?: AtprotoReplyRefLike;
  };
  embed?:
    | AtprotoEmbed
    | AtprotoEmbed[]
    | AppBskyFeedDefs.PostView['embed']
    | AppBskyFeedPost.Record['embed'];
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
interface AtprotoPost extends Partial<
  Omit<
    AppBskyFeedDefs.PostView,
    '$type' | 'author' | 'record' | 'embed' | 'viewer' | 'labels'
  >
> {
  $type?: string;
  uri?: string;
  cid?: string;
  author?: AtprotoActor;
  record?: AtprotoPostRecord;
  value?: AtprotoPostRecord;
  embed?:
    | AtprotoEmbed
    | AtprotoEmbed[]
    | AppBskyFeedDefs.PostView['embed']
    | AppBskyFeedPost.Record['embed'];
  embeds?: AtprotoEmbed[];
  labels?: unknown[];
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
  viewer?: AppBskyFeedDefs.ViewerState;
  reply?: { root?: AtprotoReplyRefLike; parent?: AtprotoReplyRefLike };
}

type AtprotoReason =
  | AppBskyFeedDefs.ReasonRepost
  | AppBskyFeedDefs.ReasonPin
  | { $type?: string; by?: AtprotoActor; indexedAt?: string };

interface AtprotoFeedItem extends Partial<
  Omit<AppBskyFeedDefs.FeedViewPost, 'post' | 'reply' | 'reason'>
> {
  post?: AtprotoPost;
  reply?: {
    root?: AtprotoReplyRefLike;
    parent?: AtprotoReplyRefLike;
    grandparentAuthor?: AtprotoActor;
  };
  reason?: AtprotoReason;
}

interface AtprotoThreadNode {
  post?: AtprotoPost;
  replies?: AtprotoThreadNode[];
  parent?: AtprotoThreadNode;
}

interface AtprotoNotification extends Partial<
  Omit<AppBskyNotificationListNotifications.Notification, 'author' | 'record'>
> {
  uri?: string;
  cid?: string;
  author?: AtprotoActor;
  reason?: string;
  reasonSubject?: string;
  record?: AtprotoRecord & { subject?: { uri?: string } };
  indexedAt?: string;
}

interface AtprotoList
  extends
    Partial<Omit<AppBskyGraphDefs.ListView, '$type'>>,
    Partial<Omit<AppBskyGraphDefs.ListViewBasic, '$type'>> {
  displayName?: string;
}

interface AtprotoFeedGenerator extends Partial<
  Omit<AppBskyFeedDefs.GeneratorView, '$type'>
> {
  name?: string;
}

interface AtprotoRelationship extends Partial<
  Omit<AppBskyGraphDefs.Relationship, '$type'>
> {
  $type?: string;
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
  labels: AtprotoLabel[];
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
  mutedAuthor?: boolean;
  like?: string;
  repost?: string;
  text: string;
  labels: AtprotoLabel[];
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
  _atproto?: AdaptedRelationshipAtproto;
}

type AdaptedNotificationType =
  | 'favourite'
  | 'reblog'
  | 'quote'
  | 'mention'
  | 'follow'
  | 'status';

const notificationReasonsByType: Record<AdaptedNotificationType, string[]> = {
  favourite: ['like', 'like-via-repost'],
  reblog: ['repost', 'repost-via-repost'],
  quote: ['quote'],
  mention: ['mention', 'reply'],
  follow: ['follow'],
  status: [],
};

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
  aspectRatio?: { width: number; height: number };
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

type VideoJobStatus = Omit<AppBskyVideoDefs.JobStatus, 'blob' | 'did'> & {
  blob?: BlobRefLike;
  did?: string;
};

interface CreateAtprotoClientOptions {
  session?: unknown;
  oauthSession?: unknown;
  service?: string;
  persistSession?: AtpPersistSessionHandler;
}

export interface AtprotoPostParams {
  status?: string;
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
  visibility?: string;
  sensitive?: boolean;
  spoiler_text?: string;
  spoilerText?: string;
  quote_approval_policy?: string;
  quoteApprovalPolicy?: string;
  language?: string | null;
}

export function assertAtprotoPostParamsSupported(
  params: AtprotoPostParams,
): void {
  if (params.poll) {
    throw new Error('Bluesky polls are not supported');
  }
  if (params.visibility && params.visibility !== 'public') {
    throw new Error('Bluesky posts only support public visibility');
  }
  if (params.sensitive) {
    throw new Error('Bluesky content warnings are not supported');
  }
  if ((params.spoiler_text || params.spoilerText || '').trim()) {
    throw new Error('Bluesky content warnings are not supported');
  }
  const quoteApprovalPolicy =
    params.quote_approval_policy || params.quoteApprovalPolicy;
  if (quoteApprovalPolicy && quoteApprovalPolicy !== 'public') {
    throw new Error('Bluesky quote approval settings are not supported');
  }
}

function getServiceAuthAudFromUrl(url: string | URL): string | null {
  try {
    const { host } = typeof url === 'string' ? new URL(url) : url;
    if (!host) return null;
    return `did:web:${host.replaceAll(':', '%3A')}`;
  } catch {
    return null;
  }
}

function getServiceAuthAudFromUrlOrDid(value: string | URL): string | null {
  if (typeof value === 'string' && value.startsWith('did:')) {
    if (isConfiguredAppViewUrl(value)) return null;
    return value.split('#', 1)[0] || null;
  }
  return getServiceAuthAudFromUrl(value);
}

function isConfiguredAppViewUrl(value: string | URL): boolean {
  if (typeof value === 'string' && value.startsWith('did:')) {
    const did = value.split('#', 1)[0];
    return did === BSKY_APPVIEW_DID || did === BLACKSKY_APPVIEW_DID;
  }
  try {
    const url = typeof value === 'string' ? new URL(value) : value;
    return KNOWN_APPVIEW_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function createPdsFacingAgent(agent: AtprotoAgent): AtprotoAgent {
  if (!isAtprotoCloneableProxyAgent(agent)) return agent;
  const cloned = agent.clone();
  if (isAtprotoProxyAgent(cloned)) cloned.configureProxy(null);
  return cloned;
}

export async function getVideoUploadServiceAuthAud(
  agent: AtprotoAgent,
): Promise<string> {
  if (!isAtprotoAgentInternals(agent)) {
    throw new Error('Missing Bluesky session');
  }
  const sessionManager = agent.sessionManager;
  if (sessionManager?.pdsUrl) {
    const aud = getServiceAuthAudFromUrl(sessionManager.pdsUrl);
    if (aud) return aud;
  }
  const tokenInfoAud = (await sessionManager?.getTokenInfo?.())?.aud;
  if (tokenInfoAud) {
    const aud = getServiceAuthAudFromUrlOrDid(tokenInfoAud);
    if (aud) return aud;
  }
  if (agent.dispatchUrl && !isConfiguredAppViewUrl(agent.dispatchUrl)) {
    const aud = getServiceAuthAudFromUrlOrDid(agent.dispatchUrl);
    if (aud) return aud;
  }
  const session =
    await createPdsFacingAgent(agent).com.atproto.server.getSession();
  const pdsEndpoint = isValidDidDoc(session.data.didDoc)
    ? getPdsEndpoint(session.data.didDoc)
    : null;
  if (pdsEndpoint && sessionManager)
    sessionManager.pdsUrl = new URL(pdsEndpoint);
  if (pdsEndpoint) {
    const aud = getServiceAuthAudFromUrl(pdsEndpoint);
    if (aud) return aud;
  }
  throw new Error('Missing Bluesky PDS URL');
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

function blobRefFromUnknown(value: unknown): BlobRefLike | undefined {
  if (value instanceof BlobRef) return value;
  const direct = BlobRef.asBlobRef(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  const ref = value.ref;
  if (!isRecord(ref) || typeof ref.$link !== 'string') return undefined;
  const mimeType =
    typeof value.mimeType === 'string'
      ? value.mimeType
      : 'application/octet-stream';
  return (
    BlobRef.asBlobRef({
      cid: ref.$link,
      mimeType,
    }) ?? undefined
  );
}

export function getVideoJobStatus(value: unknown): VideoJobStatus {
  const candidate =
    isRecord(value) && 'jobStatus' in value ? value.jobStatus : value;
  const result = AppBskyVideoDefs.validateJobStatus(candidate);
  if (result.success) return result.value;
  if (
    isRecord(candidate) &&
    typeof candidate.jobId === 'string' &&
    typeof candidate.state === 'string'
  ) {
    const status: VideoJobStatus = {
      jobId: candidate.jobId,
      state: candidate.state,
    };
    if (candidate.$type === 'app.bsky.video.defs#jobStatus') {
      status.$type = candidate.$type;
    }
    if (typeof candidate.did === 'string') status.did = candidate.did;
    if (typeof candidate.progress === 'number') {
      status.progress = candidate.progress;
    }
    const blob = blobRefFromUnknown(candidate.blob);
    if (blob) status.blob = blob;
    if (typeof candidate.error === 'string') status.error = candidate.error;
    if (typeof candidate.message === 'string')
      status.message = candidate.message;
    return status;
  }
  if (isRecord(candidate)) {
    const message =
      typeof candidate.message === 'string' ? candidate.message : undefined;
    const error =
      typeof candidate.error === 'string' ? candidate.error : undefined;
    if (message || error) {
      throw new Error(message || error);
    }
  }
  throw new Error('Invalid Bluesky video job status response');
}

async function uploadVideoBlob(
  agent: AtprotoAgent,
  file: File,
): Promise<BlobRefLike> {
  if (file.type !== 'video/mp4') {
    throw new Error('Only MP4 video uploads are supported for Bluesky posts');
  }
  if (!isAtprotoAgentInternals(agent)) {
    throw new Error('Missing Bluesky session');
  }
  const agentLoose = agent;
  if (!agentLoose.did) throw new Error('Missing Bluesky session');

  const pdsAgent = createPdsFacingAgent(agent);
  const uploadAud = await getVideoUploadServiceAuthAud(agent);

  const uploadToken = await getServiceAuthToken({
    agent: pdsAgent,
    aud: uploadAud,
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
  let jobStatus = getVideoJobStatus(await uploadRes.json());
  if (jobStatus.error) {
    throw new Error(jobStatus.message || jobStatus.error);
  }

  const videoAgent = new AtpAgent({ service: BSKY_VIDEO_SERVICE });
  const statusToken = await getServiceAuthToken({
    agent: pdsAgent,
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
      { jobId: jobStatus.jobId },
      { headers: { authorization: `Bearer ${statusToken}` } },
    );
    jobStatus = getVideoJobStatus(statusRes.data);
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
    facets,
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
      labels: normalizeAtprotoLabels(actor.labels),
    },
  };
}

export function getStoredAtprotoLabelerDids(agent: unknown): string[] {
  const preferences = store.account.get('preferences');
  if (!isRecord(preferences)) return [];
  const appLabelers = isAtprotoLabelersAgent(agent)
    ? (agent.appLabelers ?? [])
    : [];
  const storedDids = normalizeAtprotoLabelerDids(
    preferences.atprotoLabelerDids,
    appLabelers,
  );
  if (storedDids.length) return storedDids;
  if (isRecord(preferences.moderationPrefs)) {
    return normalizeAtprotoLabelerDids(
      preferences.moderationPrefs.labelers,
      appLabelers,
    );
  }
  return [];
}

export function getAtprotoLabelerDids(
  preferences: { moderationPrefs: { labelers: unknown } },
  agent: unknown,
): string[] {
  const appLabelers = isAtprotoLabelersAgent(agent)
    ? (agent.appLabelers ?? [])
    : [];
  return normalizeAtprotoLabelerDids(
    preferences.moderationPrefs.labelers,
    appLabelers,
  );
}

function isDetailedLabelerView(
  value: unknown,
): value is AppBskyLabelerDefs.LabelerViewDetailed {
  return (
    isRecord(value) &&
    isRecord(value.creator) &&
    typeof value.creator.did === 'string' &&
    isRecord(value.policies)
  );
}

function toAtprotoLabelerInfo(
  labeler: AppBskyLabelerDefs.LabelerViewDetailed,
): AtprotoLabelerInfoMap[string] {
  return {
    did: labeler.creator.did,
    handle: labeler.creator.handle,
    displayName: labeler.creator.displayName,
    avatar: labeler.creator.avatar,
  };
}

export async function fetchAtprotoLabelerMetadata(
  agent: unknown,
  labelerDids: readonly string[],
): Promise<{
  labelDefs: AtprotoLabelDefinitionMap;
  labelers: AtprotoLabelerInfoMap;
}> {
  if (!isAtprotoLabelersAgent(agent)) {
    return { labelDefs: {}, labelers: {} };
  }
  if (!agent.getLabelers) {
    const labelDefs = agent.getLabelDefinitions
      ? await agent.getLabelDefinitions(labelerDids).catch(() => ({}))
      : {};
    return { labelDefs, labelers: {} };
  }
  const dids = Array.from(
    new Set([...(agent.appLabelers ?? []), ...labelerDids]),
  );
  if (!dids.length) return { labelDefs: {}, labelers: {} };
  const res = await agent
    .getLabelers({ dids, detailed: true })
    .catch((): { data?: { views?: unknown[] } } => ({}));
  const views = (res.data?.views ?? []).filter(isDetailedLabelerView);
  return {
    labelDefs: Object.fromEntries(
      views.map((labeler) => [
        labeler.creator.did,
        interpretLabelValueDefinitions(labeler),
      ]),
    ),
    labelers: Object.fromEntries(
      views.map((labeler) => [
        labeler.creator.did,
        toAtprotoLabelerInfo(labeler),
      ]),
    ),
  };
}

function configureAgentLabelers(
  agent: AtprotoAgent,
  labelerDids: readonly string[],
): void {
  if (!isAtprotoLabelersAgent(agent)) return;
  agent.configureLabelers?.(labelerDids);
}

const BSKY_PROFILE_FALLBACK_TTL = 5 * 60 * 1_000;
const blueskyProfileFallbacks = new Map<
  string,
  { expiresAt: number; promise: Promise<AtprotoActor | null> }
>();

async function fetchBlueskyProfileFallback(
  actor: AtprotoActor,
): Promise<AtprotoActor | null> {
  const did = actor.did;
  if (!did) return null;
  const cached = blueskyProfileFallbacks.get(did);
  const now = Date.now();
  blueskyProfileFallbacks.forEach((entry, profileDid) => {
    if (entry.expiresAt <= now) blueskyProfileFallbacks.delete(profileDid);
  });
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = (async () => {
    try {
      const res = await new AtpAgent({ service: BSKY_APPVIEW }).getProfile({
        actor: did,
      });
      return res.data;
    } catch {
      blueskyProfileFallbacks.delete(did);
      return null;
    }
  })();
  blueskyProfileFallbacks.set(did, {
    expiresAt: now + BSKY_PROFILE_FALLBACK_TTL,
    promise,
  });
  const profile = await promise;
  if (!profile) {
    blueskyProfileFallbacks.delete(did);
  }
  return profile;
}

async function hydrateMissingProfilePresentation(
  actor: AtprotoActor | null | undefined,
  shouldHydrate: boolean,
): Promise<AtprotoActor> {
  if (!actor || !shouldHydrate || actor.avatar) {
    return actor ?? {};
  }
  const fallback = await fetchBlueskyProfileFallback(actor);
  if (!fallback) return actor;
  return {
    ...actor,
    avatar: actor.avatar || fallback.avatar,
    banner: actor.banner || fallback.banner,
    displayName: actor.displayName || fallback.displayName,
    description: actor.description || fallback.description,
  };
}

interface EmbedParts {
  mediaAttachments: AdaptedMediaAttachment[];
  card: AdaptedCard | undefined;
  quote: AdaptedQuote | undefined;
}

function embedToParts(
  embed: AtprotoEmbedInput,
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
  if (!isAtprotoEmbedObject(embed)) return { mediaAttachments, card, quote };

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
      image: typeof external.thumb === 'string' ? external.thumb : undefined,
      associatedRecord:
        ('associatedRecord' in external
          ? external.associatedRecord
          : undefined) ||
        ('associated_record' in external
          ? external.associated_record
          : undefined),
      type: 'link',
    };
  }

  const videoCandidate: AtprotoEmbedVideo | undefined =
    (embed.playlist
      ? {
          cid: embed.cid,
          playlist: embed.playlist,
          thumbnail: embed.thumbnail,
          thumb: embed.thumb,
          alt: embed.alt,
          aspectRatio: embed.aspectRatio,
        }
      : undefined) ||
    embed.video ||
    (embed.media?.playlist
      ? {
          cid: embed.media.cid,
          playlist: embed.media.playlist,
          thumbnail: embed.media.thumbnail,
          thumb: embed.media.thumb,
          alt: embed.media.alt,
          aspectRatio: embed.media.aspectRatio,
        }
      : undefined) ||
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
        {
          post: {
            uri: record.uri,
            cid: record.cid,
            author: record.author,
            value: record.value,
            embeds: record.embeds,
            labels: record.labels,
            replyCount: record.replyCount,
            repostCount: record.repostCount,
            likeCount: record.likeCount,
            quoteCount: record.quoteCount,
            indexedAt: record.indexedAt,
          },
        },
        agent,
      ),
    };
  }

  return { mediaAttachments, card, quote };
}

function firstEmbed(...embeds: AtprotoEmbedInput[]): AtprotoEmbedInput {
  return embeds.find((embed) =>
    Array.isArray(embed) ? embed.length > 0 : Boolean(embed),
  );
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
    id: encodeURIComponent(String(uri)),
    title: list.name || list.displayName || uri || '',
    repliesPolicy: 'list',
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
    id: encodeURIComponent(String(uri)),
    title: feed.displayName || feed.name || uri || '',
    repliesPolicy: 'list',
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
): AtprotoStrongRef | undefined {
  if (!value?.uri) return undefined;
  return {
    uri: value.uri,
    cid: value.cid,
  };
}

function isPostView(value: unknown): value is AtprotoPost {
  return !!(
    value &&
    typeof value === 'object' &&
    'uri' in value &&
    'author' in value &&
    'record' in value &&
    typeof value.uri === 'string' &&
    value.author &&
    value.record
  );
}

function isAtprotoFeedItem(
  value: AtprotoFeedItem | AtprotoPost | AtprotoReplyRefLike | undefined,
): value is AtprotoFeedItem {
  return !!(
    value &&
    typeof value === 'object' &&
    ('post' in value ||
      'reason' in value ||
      ('reply' in value && !('uri' in value)))
  );
}

function postLikeToPost(
  value: AtprotoFeedItem | AtprotoPost | AtprotoReplyRefLike | undefined,
): AtprotoPost {
  if (!value) return {};
  const base = isRecord(value) ? value : {};
  return {
    ...base,
    uri:
      'uri' in value && typeof value.uri === 'string' ? value.uri : undefined,
    cid:
      'cid' in value && typeof value.cid === 'string' ? value.cid : undefined,
    author:
      'author' in value && isAtprotoActor(value.author)
        ? value.author
        : undefined,
    record:
      'record' in value && isAtprotoPostRecord(value.record)
        ? value.record
        : undefined,
    value:
      'value' in value && isAtprotoPostRecord(value.value)
        ? value.value
        : undefined,
    embed: 'embed' in value ? value.embed : undefined,
    embeds: 'embeds' in value ? value.embeds : undefined,
    labels:
      'labels' in value && Array.isArray(value.labels)
        ? value.labels
        : undefined,
    reply:
      'reply' in value && !Array.isArray(value.reply) && isRecord(value.reply)
        ? {
            root:
              'root' in value.reply && isRecord(value.reply.root)
                ? value.reply.root
                : undefined,
            parent:
              'parent' in value.reply && isRecord(value.reply.parent)
                ? value.reply.parent
                : undefined,
          }
        : undefined,
    replyCount:
      'replyCount' in value && typeof value.replyCount === 'number'
        ? value.replyCount
        : undefined,
    repostCount:
      'repostCount' in value && typeof value.repostCount === 'number'
        ? value.repostCount
        : undefined,
    likeCount:
      'likeCount' in value && typeof value.likeCount === 'number'
        ? value.likeCount
        : undefined,
    quoteCount:
      'quoteCount' in value && typeof value.quoteCount === 'number'
        ? value.quoteCount
        : undefined,
    indexedAt:
      'indexedAt' in value && typeof value.indexedAt === 'string'
        ? value.indexedAt
        : undefined,
    viewer:
      'viewer' in value && isRecord(value.viewer) ? value.viewer : undefined,
  };
}

function isThreadNode(
  value: AtprotoThreadNode | undefined,
): value is AtprotoThreadNode {
  return !!value;
}

function threadNodeFromView(
  value:
    | AppBskyFeedDefs.ThreadViewPost
    | AppBskyFeedDefs.NotFoundPost
    | AppBskyFeedDefs.BlockedPost
    | { $type: string }
    | undefined,
): AtprotoThreadNode | undefined {
  if (!value || !('post' in value)) return undefined;
  return {
    post: value.post,
    parent: threadNodeFromView(value.parent),
    replies: value.replies?.map(threadNodeFromView).filter(isThreadNode),
  };
}

function replyContextSourceForPost(
  feedItem: AtprotoFeedItem | undefined,
  post: AtprotoReplyRefLike | undefined,
): AtprotoFeedItem | AtprotoReplyRefLike | undefined {
  if (!feedItem?.reply || feedItem.post?.uri === post?.uri) return feedItem;
  const parent = feedItem.reply.parent;
  if (
    post &&
    parent?.uri === post?.uri &&
    feedItem.reply.grandparentAuthor &&
    post.record?.reply?.parent?.uri
  ) {
    const postRecord = post.record;
    return {
      post: { ...post },
      reply: {
        root: feedItem.reply.root,
        parent: {
          ...postRecord?.reply?.parent,
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
  const feedPostsByURI: Record<string, AtprotoPost> = Object.fromEntries(
    feed.flatMap((item) => {
      const post = item.post;
      return post?.uri ? [[post.uri, post]] : [];
    }),
  );
  const missingURIs: string[] = [];
  const seen = new Set<string>();
  let hasSamePageContext = false;
  feed.forEach((item) => {
    if (item?.reason?.$type === 'app.bsky.feed.defs#reasonRepost') return;
    const refs: Array<AtprotoReplyRefLike | undefined> = [
      item.reply?.root || item.post?.record?.reply?.root,
      item.reply?.parent || item.post?.record?.reply?.parent,
    ];
    refs.forEach((ref) => {
      if (!ref?.uri || isPostView(ref) || seen.has(ref.uri)) return;
      seen.add(ref.uri);
      if (feedPostsByURI[ref.uri]) {
        hasSamePageContext = true;
        return;
      }
      missingURIs.push(ref.uri);
    });
  });
  if (!hasSamePageContext && !missingURIs.length) return feed;

  const hydratedPosts: AtprotoPost[] = [];
  for (let i = 0; i < missingURIs.length; i += BSKY_GET_POSTS_LIMIT) {
    const uris = missingURIs.slice(i, i + BSKY_GET_POSTS_LIMIT);
    const res = await agent.getPosts({ uris });
    hydratedPosts.push(...(res.data.posts || []));
  }
  const postsByURI: Record<string, AtprotoPost> = { ...feedPostsByURI };
  hydratedPosts.forEach((post) => {
    if (post.uri) postsByURI[post.uri] = post;
  });
  if (!Object.keys(postsByURI).length) return feed;
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
  const post: AtprotoPost = feedItem.post || {};
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

function isReasonRepost(
  reason: AtprotoReason | undefined,
): reason is AppBskyFeedDefs.ReasonRepost {
  return reason?.$type === 'app.bsky.feed.defs#reasonRepost';
}

function isReasonPin(reason: AtprotoReason | undefined): boolean {
  return reason?.$type === 'app.bsky.feed.defs#reasonPin';
}

function isActorMuted(actor: AtprotoActor | undefined): boolean {
  return !!(actor?.viewer?.muted || actor?.viewer?.mutedByList);
}

function blobRefID(blob: BlobRefLike): string {
  const json = blob.toJSON();
  if (isRecord(json)) {
    if (typeof json.cid === 'string' && json.cid) return json.cid;
    const ref = json.ref;
    if (typeof ref === 'string' && ref) return ref;
    if (isRecord(ref) && typeof ref.$link === 'string') return ref.$link;
  }
  return crypto.randomUUID();
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

export async function fetchFollowingFeedPage({
  agent,
  currentUserDid,
  cursor,
  limit,
  maxPages = BSKY_FOLLOWING_FILL_MAX_PAGES,
}: {
  agent: AtprotoAgent;
  currentUserDid: string | undefined;
  cursor?: string;
  limit: number;
  maxPages?: number;
}): Promise<CollectionPage<AdaptedStatus[]>> {
  const items: AdaptedStatus[] = [];

  const collect = async (
    page: number,
    pageCursor: string | undefined,
  ): Promise<string | undefined> => {
    if (page >= maxPages) return pageCursor;

    const res = await agent.getTimeline({ limit, cursor: pageCursor });
    const nextCursor = res.data.cursor;
    const feed = await hydrateFeedReplyContext(res.data.feed, agent);
    const processedFeed = postProcessFollowingFeed(feed, currentUserDid);
    items.push(...feedToStatuses(processedFeed, agent));

    if (items.length >= limit || !nextCursor) return nextCursor;
    return collect(page + 1, nextCursor);
  };

  return {
    cursor: await collect(0, cursor),
    items,
  };
}

export function postToStatus(
  feedItemOrPost:
    | AtprotoFeedItem
    | AtprotoPost
    | AtprotoReplyRefLike
    | undefined,
  agent: AtprotoAgent,
): AdaptedStatus {
  const feedItem = isAtprotoFeedItem(feedItemOrPost)
    ? feedItemOrPost
    : undefined;
  const post: AtprotoPost = feedItem
    ? feedItem.post || {}
    : postLikeToPost(feedItemOrPost);
  const record: AtprotoPostRecord = post?.record || post?.value || {};
  const feedReply = feedItem?.reply;
  const replyParent: AtprotoReplyRefLike | undefined =
    feedReply?.parent || post.reply?.parent;
  const replyParentRef = strongRef(
    record.reply?.parent || post.reply?.parent || feedReply?.parent,
  );
  const replyRootRef = strongRef(
    record.reply?.root || post.reply?.root || feedReply?.root,
  );
  const replyParentURI = replyParentRef?.uri;
  const replyParentAuthorDid =
    replyParent?.author?.did ||
    post.reply?.parent?.author?.did ||
    atUriRepo(replyParentURI);
  // Preserve JS behavior: `encodeAtprotoID(undefined)` stringifies to
  // "undefined" so malformed inputs each get the same noisy id rather than
  // collapsing to "" and colliding.
  const id = encodeAtprotoID(String(post.uri));
  const { mediaAttachments, card, quote } = embedToParts(
    firstEmbed(post.embed, post.embeds, record.embed, record.embeds),
    agent,
  );
  const mentions: AdaptedMention[] = (record.facets || []).flatMap((facet) => {
    const matched = Array.from(
      new RichText({
        text: record.text || '',
        facets: [facet],
      }).segments(),
    ).find((seg) => seg.facet);
    const text = matched?.text;
    return (facet.features || [])
      .filter(AppBskyRichtextFacet.isMention)
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
    muted: !!post.viewer?.threadMuted,
    mediaAttachments,
    card,
    mentions,
    tags: (record.facets || [])
      .flatMap((facet) => facet.features || [])
      .filter(AppBskyRichtextFacet.isTag)
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
      mutedAuthor: isActorMuted(post.author),
      like: post.viewer?.like,
      repost: post.viewer?.repost,
      text: record.text || '',
      labels: normalizeAtprotoLabels(post.labels),
    },
    quoteApproval: {
      currentUser: 'automatic',
      automatic: ['public'],
      manual: [],
    },
  };

  const reason = feedItem?.reason;
  if (isReasonRepost(reason)) {
    return {
      ...status,
      id: `${id}-repost-${reason.indexedAt}`,
      createdAt: reason.indexedAt,
      account: actorToAccount(reason.by),
      _atproto: {
        ...status._atproto,
        mutedAuthor: status._atproto.mutedAuthor || isActorMuted(reason.by),
      },
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

function emptyCollection<T>(): Collection<T[]> {
  return makeCollection<T[]>(async () => ({
    cursor: undefined,
    items: [],
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

function notificationReasonsForTypes(
  types: AdaptedNotificationType[] | undefined,
): string[] | undefined {
  if (!types?.length) return undefined;
  const reasons = new Set<string>();
  types.forEach((type) => {
    notificationReasonsByType[type].forEach((reason) => {
      reasons.add(reason);
    });
  });
  return reasons.size ? [...reasons] : undefined;
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

  if (file.type?.startsWith('image/')) {
    const { file: uploadFile, dimensions } =
      await prepareAtprotoImageUpload(file);
    const res = await agent.uploadBlob(uploadFile, {
      encoding: uploadFile.type,
    });
    const blob = res.data.blob;
    const id = blobRefID(blob);
    const mediaUrl = URL.createObjectURL(uploadFile);
    const media: AdaptedUploadedMedia = {
      id,
      type: 'image',
      url: mediaUrl,
      previewUrl: mediaUrl,
      description,
      blob,
      aspectRatio: dimensions,
    };
    uploadedMedia.set(id, media);
    return media;
  }

  if (file.type?.startsWith('video/')) {
    const blob = await uploadVideoBlob(agent, file);
    const id = blobRefID(blob);
    const url = URL.createObjectURL(file);
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
  return res.data.blob;
}

const KNOWN_APPVIEW_HOSTNAMES = new Set(
  Object.values(APPVIEW_OPTIONS).flatMap(({ url }) => {
    try {
      return [new URL(url).hostname];
    } catch {
      return [];
    }
  }),
);

function isBskyAppViewService(service: string): boolean {
  try {
    const { hostname } = new URL(service);
    return KNOWN_APPVIEW_HOSTNAMES.has(hostname);
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
  let agentOrNull: AtprotoAgent | null;
  if (oauthSession) {
    if (!isAtprotoOAuthAgentSession(oauthSession)) {
      throw new Error('Unrecognized Bluesky OAuth session');
    }
    agentOrNull = createAtprotoOAuthAgent(oauthSession);
  } else {
    agentOrNull = new AtpAgent({
      service,
      persistSession,
    } satisfies AtpAgentOptions);
  }
  if (!agentOrNull) throw new Error('Missing Bluesky OAuth session');
  const agent: AtprotoAgent = agentOrNull;
  if (!isBskyAppViewService(service) && isAtprotoProxyAgent(agent)) {
    agent.configureProxy(getActiveAppviewConfig().proxy);
  }
  configureAgentLabelers(agent, getStoredAtprotoLabelerDids(agent));
  const agentLoose: AtprotoAgentInternals = isAtprotoAgentInternals(agent)
    ? agent
    : {};
  const sessionData = toAtpSessionData(session);
  if (sessionData && agentLoose.sessionManager) {
    agentLoose.sessionManager.session = sessionData;
  }
  const shouldHydrateProfilePresentation =
    getActiveAppviewConfig().url !== BSKY_APPVIEW ||
    service === BLACKSKY_APPVIEW;
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
      const quotePost = quoteRes.data.posts[0];
      if (!quotePost) return status;
      return {
        ...status,
        quote: {
          id: encodeAtprotoID(quotePost.uri),
          state: 'accepted',
          quotedStatus: postToStatus(quotePost, agent),
        },
      };
    };
    return {
      async fetch(): Promise<AdaptedStatus> {
        const res = await agent.getPosts({ uris: [uri] });
        const post = res.data.posts[0];
        if (!post) throw new Error('Post not found');
        const status = await hydrateLegacyLinkQuote(postToStatus(post, agent));
        return status;
      },
      context: {
        async fetch() {
          const res = await agent.getPostThread({
            uri,
            depth: BSKY_THREAD_CONTEXT_DEPTH,
            parentHeight: BSKY_THREAD_CONTEXT_DEPTH,
          });
          const flatten = (
            node: AtprotoThreadNode | undefined,
            bucket: AdaptedStatus[] = [],
          ): AdaptedStatus[] => {
            if (node?.post) bucket.push(postToStatus(node.post, agent));
            node?.replies?.forEach((reply) => {
              flatten(reply, bucket);
            });
            return bucket;
          };
          const thread = threadNodeFromView(res.data.thread);
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
              items: res.data.repostedBy.map(actorToAccount),
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
              items: res.data.likes.map((like) => actorToAccount(like.actor)),
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
              items: res.data.posts.map((post) => postToStatus(post, agent)),
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
        await agent.app.bsky.bookmark.createBookmark({
          uri,
          cid: current._atproto.cid ?? '',
        });
        setBookmarkOverride(agentLoose.did ?? sessionData?.did, uri, true);
        return { ...current, bookmarked: true };
      },
      async unbookmark(): Promise<AdaptedStatus> {
        const current = await this.fetch();
        await agent.app.bsky.bookmark.deleteBookmark({ uri });
        setBookmarkOverride(agentLoose.did ?? sessionData?.did, uri, false);
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
      relationshipsRes.data.relationships.find(isAtprotoRelationship),
      profileRes.data,
    );
  }

  const accountAPI = (id: string) => ({
    async fetch(): Promise<AdaptedAccount> {
      const res = await agent.getProfile({ actor: normalizeActor(id) ?? '' });
      const profile = await hydrateMissingProfilePresentation(
        res.data,
        shouldHydrateProfilePresentation,
      );
      return actorToAccount(profile);
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
        if (pinned) return emptyCollection<AdaptedStatus>();
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
            await hydrateFeedReplyContext(res.data.feed, agent),
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
            items: res.data.followers.map(actorToAccount),
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
            items: res.data.follows.map(actorToAccount),
          };
        });
      },
    },
    featuredTags: {
      async list(): Promise<never[]> {
        return [];
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
  });

  const listAPI = (id: string) => {
    const uri = decodeResourceID(id);
    return {
      async fetch(): Promise<AdaptedList> {
        if (uri.includes('/app.bsky.feed.generator/')) {
          const res = await agent.app.bsky.feed.getFeedGenerator({
            feed: uri,
          });
          return feedGeneratorToPhanpyList(res.data.view);
        }
        const res = await agent.app.bsky.graph.getList({
          list: uri,
          limit: 1,
        });
        return listToPhanpyList(res.data.list);
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

        const deleteWrite = (
          recordURI: string,
        ): ComAtprotoRepoApplyWrites.Delete & {
          $type: 'com.atproto.repo.applyWrites#delete';
        } => ({
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: recordURI.split('/').slice(-2, -1)[0],
          rkey: atprotoRkey(recordURI) ?? '',
        });
        const writes = [...listitemURIs.map(deleteWrite), deleteWrite(uri)];
        for (let i = 0; i < writes.length; i += 10) {
          await agent.com.atproto.repo.applyWrites({
            repo: agentLoose.did ?? '',
            writes: writes.slice(i, i + 10),
          });
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
              items: res.data.items.map((item) => actorToAccount(item.subject)),
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
    const reasons = notificationReasonsForTypes(types);
    const res = await agent.listNotifications({
      limit,
      cursor,
      reasons,
    });
    const allowedTypes = types?.length
      ? new Set<AdaptedNotificationType>(types)
      : null;
    const blockedTypes = excludeTypes?.length
      ? new Set<AdaptedNotificationType>(excludeTypes)
      : null;
    const notifications = res.data.notifications.filter((notification) => {
      const type = notificationType(notification.reason);
      if (allowedTypes && !allowedTypes.has(type)) return false;
      if (blockedTypes?.has(type)) return false;
      if (isActorMuted(notification.author)) return false;
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
          .then((postsRes) => postsRes.data.posts)
          .catch(() => [])
      : [];
    const postMap = posts.reduce<Record<string, AdaptedStatus>>((map, post) => {
      if (post.uri) map[post.uri] = postToStatus(post, agent);
      return map;
    }, {});
    const items: AdaptedNotification[] = await Promise.all(
      notifications.map(async (notification) => {
        const statusURI = notificationStatusURI(notification);
        const author = await hydrateMissingProfilePresentation(
          notification.author,
          shouldHydrateProfilePresentation,
        );
        return {
          id: `${notification.uri}-${notification.indexedAt}`,
          type: notificationType(notification.reason),
          createdAt: notification.indexedAt,
          account: actorToAccount(author),
          status: statusURI ? postMap[statusURI] : undefined,
        };
      }),
    );
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
          const hydratedProfile = await hydrateMissingProfilePresentation(
            profile.data,
            shouldHydrateProfilePresentation,
          );
          return actorToAccount(hydratedProfile);
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
          const current = await agent.com.atproto.repo
            .getRecord({
              repo: agentLoose.did ?? '',
              collection: 'app.bsky.actor.profile',
              rkey: 'self',
            })
            .then((res) => res.data.value)
            .catch(() => ({
              $type: 'app.bsky.actor.profile',
            }));
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
          const hydratedProfile = await hydrateMissingProfilePresentation(
            profile.data,
            shouldHydrateProfilePresentation,
          );
          return actorToAccount(hydratedProfile);
        },
        $select: accountAPI,
        relationships: {
          async fetch({ id }: { id?: string | string[] } = {}): Promise<
            AdaptedRelationship[]
          > {
            const ids = Array.isArray(id)
              ? id
              : [id].filter((value): value is string => Boolean(value));
            if (!ids.length) return [];
            const actors = ids.map((value) => normalizeActor(value) ?? '');
            const profilesRes = await agent.getProfiles({
              actors,
            });
            const relationshipsRes =
              await agent.app.bsky.graph.getRelationships({
                actor: agentLoose.did ?? '',
                others: actors,
              });
            const profiles: Record<string, AtprotoActor> = Object.fromEntries(
              profilesRes.data.profiles.map((profile) => [
                profile.did ?? '',
                profile,
              ]),
            );
            const relationships = new Map<string, AtprotoRelationship>();
            for (const relationship of relationshipsRes.data.relationships) {
              if (isAtprotoRelationship(relationship)) {
                relationships.set(relationship.did, relationship);
              }
            }
            return profilesRes.data.profiles.map((profile) => {
              const did = profile.did;
              return relationshipFromAtproto(
                did ? relationships.get(did) : undefined,
                did ? profiles[did] : undefined,
              );
            });
          },
        },
        familiarFollowers: {
          async fetch({ id }: { id?: string | string[] } = {}): Promise<
            Array<{ id: string; accounts: never[] }>
          > {
            const ids = Array.isArray(id)
              ? id
              : [id].filter((value): value is string => Boolean(value));
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
            const accounts = res.data.actors.map(
              actorToAccount,
            ) as AdaptedAccount[] & {
              _pagination?: { cursor?: string };
            };
            accounts._pagination = { cursor: res.data.cursor };
            return accounts;
          },
        },
      },
      timelines: {
        home: {
          list({ limit = 20 }: { limit?: number } = {}) {
            return makeCollection<AdaptedStatus[]>((cursor) =>
              fetchFollowingFeedPage({
                agent,
                currentUserDid: agentLoose.did,
                cursor,
                limit,
              }),
            );
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
              const feed = await hydrateFeedReplyContext(res.data.feed, agent);
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
                  let items = res.data.posts.map((post) =>
                    postToStatus(post, agent),
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
            if (!url) return emptyCollection<AdaptedStatus>();
            return makeCollection<AdaptedStatus[]>(async (cursor) => {
              const res = await agent.app.bsky.feed.searchPosts({
                q: url,
                limit,
                cursor,
              });
              return {
                cursor: res.data.cursor,
                items: res.data.posts.map((post) => postToStatus(post, agent)),
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
                  const res = uri.includes('/app.bsky.feed.generator/')
                    ? await agent.app.bsky.feed.getFeed({
                        feed: uri,
                        limit,
                        cursor,
                      })
                    : await agent.app.bsky.feed.getListFeed({
                        list: uri,
                        limit,
                        cursor,
                      });
                  const feed = await hydrateFeedReplyContext(
                    res.data.feed,
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
              ...res.data.lists
                .filter(
                  (list) => list.purpose === 'app.bsky.graph.defs#curatelist',
                )
                .map(listToPhanpyList),
            );
            cursor = res.data.cursor;
          } while (cursor);
          const preferences = await agent.getPreferences().catch(() => null);
          const savedFeeds = preferences?.savedFeeds || [];
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
                .then((res) => res.data.feeds)
                .catch(() => [])
            : [];
          const actorFeeds: AtprotoFeedGenerator[] = await agent.app.bsky.feed
            .getActorFeeds({
              actor: agentLoose.did ?? '',
              limit: 100,
            })
            .then((res) => res.data.feeds)
            .catch(() => []);
          const savedLists = await Promise.all(
            savedFeeds
              .filter((feed) => feed.type === 'list')
              .map((feed) =>
                agent.app.bsky.graph
                  .getList({ list: feed.value, limit: 1 })
                  .then((res) => listToPhanpyList(res.data.list))
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
            const res = await agent.app.bsky.bookmark.getBookmarks({
              limit,
              cursor,
            });
            return {
              cursor: res.data.cursor,
              items: res.data.bookmarks.flatMap((bookmark) =>
                isPostView(bookmark.item)
                  ? [postToStatus(bookmark.item, agent)]
                  : [],
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
            const feed = await hydrateFeedReplyContext(res.data.feed, agent);
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
              items: res.data.mutes.map(actorToAccount),
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
              items: res.data.blocks.map(actorToAccount),
            };
          });
        },
      },
      trends: {
        tags: {
          list() {
            return emptyCollection<unknown>();
          },
        },
        links: {
          list() {
            return emptyCollection<unknown>();
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
              const feed = await hydrateFeedReplyContext(res.data.feed, agent);
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
      statuses: {
        $select: statusAPI,
        async list({ id }: { id?: string | string[] } = {}): Promise<
          AdaptedStatus[]
        > {
          const ids = Array.isArray(id)
            ? id
            : [id].filter((value): value is string => Boolean(value));
          if (!ids.length) return [];
          const uris = ids.map((value) => decodeURIComponent(value));
          const res = await agent.getPosts({ uris });
          return res.data.posts.map((post) => postToStatus(post, agent));
        },
        async create(params: AtprotoPostParams = {}): Promise<AdaptedStatus> {
          assertAtprotoPostParamsSupported(params);
          const inReplyToId = params.in_reply_to_id || params.inReplyToId;
          const quoteId =
            params.quoted_status_id || params.quote_id || params.quoteId;
          const rt = new RichText({ text: params.status || '' });
          await rt.detectFacets(agent);
          const facets = rt.facets || [];
          const record: AppBskyFeedPost.Record = {
            $type: 'app.bsky.feed.post',
            text: rt.text,
            facets,
            createdAt: new Date().toISOString(),
          };
          if (params.language) {
            record.langs = [params.language];
          }
          let quoteEmbed: TypedRecordEmbed | undefined;
          if (inReplyToId) {
            const parent = await statusAPI(inReplyToId).fetch();
            const storedRoot = parent._atproto?.root;
            const root: ComAtprotoRepoStrongRef.Main =
              !!storedRoot?.uri && !!storedRoot.cid
                ? {
                    uri: storedRoot.uri,
                    cid: storedRoot.cid,
                  }
                : {
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
            quoteEmbed = {
              $type: 'app.bsky.embed.record',
              record: {
                uri: quote.uri ?? '',
                cid: quote._atproto.cid ?? '',
              },
            };
            record.embed = quoteEmbed;
          }
          const mediaIds = params.media_ids || params.mediaIds || [];
          if (mediaIds.length) {
            const media = mediaIds
              .map((id) => uploadedMedia.get(id))
              .filter((item): item is AdaptedUploadedMedia =>
                Boolean(item?.blob),
              );
            const videos = media.filter((item) => item.type === 'video');
            const images: AppBskyEmbedImages.Image[] = media
              .filter((item) => item.type === 'image')
              .map((item) => {
                const image: AppBskyEmbedImages.Image = {
                  image: item.blob,
                  alt: item.description || '',
                };
                if (item.aspectRatio) image.aspectRatio = item.aspectRatio;
                return image;
              });
            if (videos.length && images.length) {
              throw new Error('Bluesky posts cannot mix images and video');
            }
            if (videos.length > 1) {
              throw new Error('Bluesky posts support one video');
            }
            if (videos.length) {
              const videoEmbed: TypedVideoEmbed = {
                $type: 'app.bsky.embed.video',
                video: videos[0].blob,
                alt: videos[0].description || '',
              };
              if (quoteEmbed) {
                record.embed = {
                  $type: 'app.bsky.embed.recordWithMedia',
                  record: quoteEmbed,
                  media: videoEmbed,
                } satisfies AppBskyEmbedRecordWithMedia.Main;
              } else {
                record.embed = videoEmbed;
              }
            } else if (images.length) {
              const imagesEmbed: TypedImagesEmbed = {
                $type: 'app.bsky.embed.images',
                images,
              };
              if (quoteEmbed) {
                record.embed = {
                  $type: 'app.bsky.embed.recordWithMedia',
                  record: quoteEmbed,
                  media: imagesEmbed,
                } satisfies AppBskyEmbedRecordWithMedia.Main;
              } else {
                record.embed = imagesEmbed;
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
              ? await createAtprotoExternalEmbed(agent, externalUrl)
              : null;
            if (externalEmbed) {
              record.embed = externalEmbed;
            }
          }
          const res = await agent.post(record);
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
              author: profile.data,
              record,
              reply: record.reply,
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
        async fetch(): Promise<Record<string, unknown>> {
          const preferences = await agent.getPreferences().catch(() => null);
          const labelerDids = preferences
            ? getAtprotoLabelerDids(preferences, agent)
            : [];
          if (preferences) configureAgentLabelers(agent, labelerDids);
          const labelerMetadata = await fetchAtprotoLabelerMetadata(
            agent,
            labelerDids,
          );
          return {
            atprotoLabelerDids: labelerDids,
            atprotoLabelDefs: labelerMetadata.labelDefs,
            atprotoLabelers: labelerMetadata.labelers,
          };
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
          let subject: ComAtprotoModerationCreateReport.InputSchema['subject'] =
            {
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
          });
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
          sort?: 'top' | 'latest' | (string & {});
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
              results.accounts = res.data.actors.map(actorToAccount);
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
              });
              results.statuses = res.data.posts.map((post) =>
                postToStatus(post, agent),
              );
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
        imageSizeLimit: 2_000_000,
        videoSizeLimit: 100_000_000,
        descriptionLimit: 1_000,
      },
      polls: {
        maxOptions: 0,
      },
    },
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
    actor: agent.did ?? '',
  });
  return {
    agent,
    account: actorToAccount(profile.data),
    session: agent.session,
    service,
  };
}

// Best-effort server-side logout for app-password sessions. OAuth sessions are
// revoked separately via the OAuth client. Like that path, this is resilient:
// the caller clears local storage regardless of whether this network call
// succeeds (e.g. the session already expired server-side).
export async function logoutAtprotoSession(
  accessToken: string | null | undefined,
): Promise<void> {
  if (!accessToken) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(accessToken);
  } catch {
    return;
  }
  if (!isRecord(parsed) || parsed.type !== 'atproto') return;
  const session = toAtpSessionData(parsed.session);
  if (!session) return;
  // Session deletion targets the account's PDS (stored per-account in
  // parsed.service for app-password logins), NOT the AppView. Fall back to the
  // entryway PDS — never the AppView URL — for tokens missing a stored service.
  const service =
    typeof parsed.service === 'string' && parsed.service
      ? parsed.service
      : BSKY_PDS;
  try {
    const agent = new AtpAgent({ service });
    await agent.resumeSession(session);
    await agent.logout();
  } catch (error) {
    console.error('Failed to delete ATProto app-password session:', error);
  }
}

export function createPublicAtprotoClient() {
  return createAtprotoClient({ service: getActiveAppviewConfig().url });
}

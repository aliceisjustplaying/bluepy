import type { mastodon } from 'masto';
import type { ComponentChildren } from 'preact';

import type { api } from '../utils/api';

export type AnyAccount = mastodon.v1.Account & Record<string, unknown>;

export type AnyPoll = mastodon.v1.Poll & {
  emojis?: mastodon.v1.CustomEmoji[];
} & Record<string, unknown>;

export type AnyPreviewCard = Omit<
  mastodon.v1.PreviewCard,
  | 'authorName'
  | 'authorUrl'
  | 'authors'
  | 'blurhash'
  | 'description'
  | 'embedUrl'
  | 'html'
  | 'image'
  | 'imageDescription'
  | 'language'
  | 'providerName'
  | 'providerUrl'
  | 'publishedAt'
  | 'title'
  | 'type'
  | 'url'
  | 'width'
  | 'height'
> & {
  authors?: Array<
    {
      account?: { id?: string } & Record<string, unknown>;
    } & Record<string, unknown>
  >;
  authorName?: string;
  authorUrl?: string;
  blurhash?: string;
  description?: string;
  embedUrl?: string;
  html?: string;
  image?: string;
  imageDescription?: string;
  language?: string;
  providerName?: string;
  providerUrl?: string;
  publishedAt?: string;
  title?: string;
  type?: string;
  url?: string;
  width?: number;
  height?: number;
} & Record<string, unknown>;

export type AnyMediaAttachment = Omit<
  mastodon.v1.MediaAttachment,
  | 'blurhash'
  | 'description'
  | 'meta'
  | 'previewRemoteUrl'
  | 'previewUrl'
  | 'remoteUrl'
  | 'type'
  | 'url'
> & {
  blurhash?: string;
  description?: string;
  meta?: {
    original?: { width?: number; height?: number; duration?: number };
    small?: { width?: number; height?: number };
    focus?: { x: number; y: number };
  };
  previewRemoteUrl?: string;
  previewUrl: string;
  remoteUrl?: string;
  type: mastodon.v1.MediaAttachment['type'];
  url: string;
} & Record<string, unknown>;

interface AnyQuote {
  quotedStatus?: AnyStatus;
  state?: string;
}

export interface StatusAtprotoMeta {
  replyParentAccount?: AnyAccount | null;
  replyParentUnavailable?: boolean;
}

export interface StatusQuoteApproval {
  currentUser?: string;
  automatic?: readonly string[];
  manual?: readonly string[];
}

// Loose status type: some non-API extension fields (e.g. `_atproto`, `_deleted`,
// `_pinned`, `emojiReactions`, `quoteApproval`) are added at runtime. Keep the
// Mastodon base shape but override status-rendering fields that the app mutates.
export type AnyStatus = Omit<
  mastodon.v1.Status,
  | 'account'
  | 'card'
  | 'editedAt'
  | 'language'
  | 'mediaAttachments'
  | 'poll'
  | 'quote'
  | 'reblog'
  | 'url'
> & {
  account: AnyAccount;
  card?: AnyPreviewCard | null;
  editedAt: string;
  language?: string;
  mediaAttachments: AnyMediaAttachment[];
  poll?: AnyPoll;
  quote?: AnyQuote | null;
  reblog?: AnyStatus | null;
  url?: string;
  __replies?: AnyStatus[];
  _atproto?: StatusAtprotoMeta;
  _deleted?: boolean;
  _pinned?: boolean;
  emojiReactions?: readonly Record<string, unknown>[];
  quoteApproval?: StatusQuoteApproval;
} & Record<string, unknown>;

export type StatusSize = 's' | 'm' | 'l';

export interface StatusRenderProps extends Record<string, unknown> {
  statusID?: string | null;
  status?: AnyStatus | null;
  instance?: string;
  size?: StatusSize;
  contentTextWeight?: boolean;
  readOnly?: boolean;
  mediaFirst?: boolean;
  enableCommentHint?: boolean;
  showCommentCount?: boolean | ((count?: number) => boolean);
  showQuoteCount?: boolean | ((count?: number) => boolean);
  level?: number;
  quoted?: number | boolean;
  quoteDomain?: string;
}

export type RenderStatus = (props: StatusRenderProps) => ComponentChildren;

export interface GhostInfo {
  inReplyToAccountId?: string | null;
}

// The project-local MastoClient interface is intentionally narrow. The runtime
// instance is the full mastodon REST client, so cast back through the masto
// types for richer call signatures.
export type FullMasto = mastodon.rest.Client;
export type MastoClientFromApi = ReturnType<typeof api>['masto'];

// Permissive event shim for menu-item / button onClick handlers. The runtime
// always provides at least the modifier-key flags and an optional
// `syntheticEvent` proxy for menu adapters.
export type LooseClickEvent = {
  shiftKey?: boolean;
  syntheticEvent?: { shiftKey?: boolean };
  preventDefault?: () => void;
  stopPropagation?: () => void;
  target?: EventTarget | null;
  currentTarget?: EventTarget | null;
  key?: string;
  keyCode?: number;
};

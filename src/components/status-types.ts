import type { mastodon } from 'masto';
import type { ReactNode } from 'react';

import type { api } from '../utils/api';
import type { AtprotoLabel } from '../utils/atproto-labels';

export type AnyAccount = mastodon.v1.Account & Record<string, unknown>;

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
  url?: string | null;
} & Record<string, unknown>;

interface AnyQuote {
  quotedStatus?: AnyStatus;
  state?: string;
}

export interface StatusAtprotoMeta {
  uri?: string;
  cid?: string;
  labels?: AtprotoLabel[];
  replyParentAccount?: AnyAccount | null;
  replyParentUnavailable?: boolean;
  mutedAuthor?: boolean;
}

interface StatusQuoteApproval {
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
  editedAt: string | null;
  language?: string;
  mediaAttachments: AnyMediaAttachment[];
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

interface StatusRenderProps extends Record<string, unknown> {
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

export type RenderStatus = (props: StatusRenderProps) => ReactNode;

export interface GhostInfo {
  inReplyToAccountId?: string | null;
}

export type MastoClientFromApi = ReturnType<typeof api>['masto'];

type StatusReactionList = (opts?: { limit: number }) => {
  values(): AsyncIterator<AnyAccount[], undefined>;
};

export interface StatusContentMasto {
  v1: {
    statuses: {
      $select(id: string): {
        unreblog(): Promise<mastodon.v1.Status>;
        reblog(): Promise<mastodon.v1.Status>;
        unfavourite(): Promise<mastodon.v1.Status>;
        favourite(): Promise<mastodon.v1.Status>;
        unbookmark(): Promise<mastodon.v1.Status>;
        bookmark(): Promise<mastodon.v1.Status>;
        unmute(): Promise<mastodon.v1.Status>;
        mute(): Promise<mastodon.v1.Status>;
        unpin(): Promise<mastodon.v1.Status>;
        pin(): Promise<mastodon.v1.Status>;
        remove(): Promise<unknown>;
        quotes: {
          $select(id: string): {
            revoke: { create(): Promise<unknown> };
          };
        };
        rebloggedBy: { list: StatusReactionList };
        favouritedBy: { list: StatusReactionList };
      };
    };
  };
}

// Permissive event shim for menu-item / button onClick handlers. The runtime
// always provides at least the modifier-key flags and an optional
// `syntheticEvent` proxy for menu adapters.
export type LooseClickEvent = {
  shiftKey?: boolean;
  syntheticEvent?: { shiftKey?: boolean };
  preventDefault?: () => void;
  stopPropagation?: (() => void) | boolean;
  target?: EventTarget | null;
  currentTarget?: EventTarget | null;
  key?: string;
  keyCode?: number;
};

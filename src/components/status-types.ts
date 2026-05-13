import type { mastodon } from 'masto';
import type { ComponentChildren } from 'preact';

import type { api } from '../utils/api';

// Loose status type: some non-API extension fields (e.g. `_atproto`, `_deleted`,
// `_pinned`, `emojiReactions`, `quoteApproval`) are added at runtime. We keep
// the mastodon shape as a base and treat the runtime additions as untyped.
export type AnyStatus = mastodon.v1.Status & Record<string, unknown>;

export type AnyAccount = mastodon.v1.Account & Record<string, unknown>;

export type AnyPoll = mastodon.v1.Poll & {
  emojis?: mastodon.v1.CustomEmoji[];
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

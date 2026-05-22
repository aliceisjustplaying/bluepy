import type { mastodon } from 'masto';
import type { ReactNode } from 'react';

import type {
  AnyStatus,
  LooseClickEvent,
  StatusContentMasto,
} from './status-types';

export interface StatusMenuPartsArgs {
  accountId?: string | null;
  mentions?: mastodon.v1.StatusMention[];
  repliesCount?: number;
  username?: string;
  acct?: string;
  replyStatus: (e?: LooseClickEvent) => void;
  isSizeLarge: boolean;
  sameInstance: boolean;
  showActionsBar?: boolean;
  reblogged?: boolean | null;
  quoteDisabled?: boolean | null;
  status: AnyStatus;
  quoteMetaText?: string | null;
  quoteText?: string;
  url?: string | null;
  menuFooter: ReactNode;
  canBoost?: boolean;
  confirmBoostStatus: () => Promise<boolean>;
  canQuote?: boolean;
  reblogsCount?: number;
  quotesCount?: number;
  favouriteStatusNotify: () => Promise<void>;
  favourited?: boolean | null;
  favouritesCount?: number;
  bookmarked?: boolean | null;
  bookmarkStatusNotify: () => Promise<void>;
  setShowQuotes: (value: boolean) => void;
  quote?: unknown;
  setShowQuoteChain: (value: boolean) => void;
  setShowEmbed: (value: boolean) => void;
  mediaFirst?: boolean;
  enableTranslate?: boolean;
  language?: string | null;
  differentLanguage?: boolean;
  forceTranslate?: boolean;
  setForceTranslate: (value: boolean) => void;
  instance: string;
  id: string;
  onStatusLinkClick: (
    e: React.MouseEvent | KeyboardEvent,
    status: AnyStatus,
  ) => void;
  createdDateText?: string | false | null;
  isPublic: boolean;
  authenticated?: boolean;
  isSelf?: boolean | string | null;
  mentionSelf?: unknown;
  masto: StatusContentMasto;
  muted?: boolean | null;
  pinned?: boolean | null;
  isPinnable: boolean;
  visibility: 'direct' | 'local' | 'private' | 'public' | 'unlisted';
  sKey: string;
  fetchBoostedLikedByAccounts: (
    firstLoad?: boolean,
  ) => Promise<{ value: unknown[]; done?: boolean }>;
}

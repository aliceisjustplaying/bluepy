import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ReactNode } from 'react';

import RTF from '../utils/relative-time-format';

import Icon from './icon';
import useStatusMenuParts from './status-menu';
import type { AnyStatus, StatusContentMasto } from './status-types';

interface StatusMenuStateArgs {
  mediaNoDesc: boolean;
  reblogged?: boolean | null;
  statusMonthsAgo: number;
  accountId?: string | null;
  mentions?: mastodon.v1.StatusMention[];
  repliesCount?: number;
  username?: string;
  acct?: string;
  replyStatus: Parameters<typeof useStatusMenuParts>[0]['replyStatus'];
  isSizeLarge: boolean;
  sameInstance: boolean;
  showActionsBar?: boolean;
  quoteDisabled?: boolean | null;
  status: AnyStatus;
  quoteMetaText?: string | null;
  quoteText?: string;
  url?: string | null;
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
  visibility: Parameters<typeof useStatusMenuParts>[0]['visibility'];
  sKey: string;
  fetchBoostedLikedByAccounts: Parameters<
    typeof useStatusMenuParts
  >[0]['fetchBoostedLikedByAccounts'];
}

export default function useStatusMenuState({
  mediaNoDesc,
  reblogged,
  statusMonthsAgo,
  accountId,
  mentions,
  repliesCount,
  username,
  acct,
  replyStatus,
  isSizeLarge,
  sameInstance,
  showActionsBar,
  quoteDisabled,
  status,
  quoteMetaText,
  quoteText,
  url,
  canBoost,
  confirmBoostStatus,
  canQuote,
  reblogsCount,
  quotesCount,
  favouriteStatusNotify,
  favourited,
  favouritesCount,
  bookmarked,
  bookmarkStatusNotify,
  setShowQuotes,
  quote,
  setShowQuoteChain,
  setShowEmbed,
  mediaFirst,
  enableTranslate,
  language,
  differentLanguage,
  forceTranslate,
  setForceTranslate,
  instance,
  id,
  onStatusLinkClick,
  createdDateText,
  isPublic,
  authenticated,
  isSelf,
  mentionSelf,
  masto,
  muted,
  pinned,
  visibility,
  sKey,
  fetchBoostedLikedByAccounts,
}: StatusMenuStateArgs) {
  const { i18n } = useLingui();
  const rtf = RTF(i18n.locale);
  const isPinnable = ['public', 'unlisted', 'private'].includes(visibility);
  const menuFooter: ReactNode =
    mediaNoDesc && !reblogged ? (
      <div className="footer">
        <Icon icon="alert" />
        <Trans>Some media have no descriptions.</Trans>
      </div>
    ) : (
      statusMonthsAgo >= 3 && (
        <div className="footer">
          <Icon icon="info" />
          <span>
            <Trans>
              Old post (<strong>{rtf.format(-statusMonthsAgo, 'month')}</strong>
              )
            </Trans>
          </span>
        </div>
      )
    );
  const { statusMenuItems: StatusMenuItems } = useStatusMenuParts({
    accountId,
    mentions,
    repliesCount,
    username,
    acct,
    replyStatus,
    isSizeLarge,
    sameInstance,
    showActionsBar,
    reblogged,
    quoteDisabled,
    status,
    quoteMetaText,
    quoteText,
    url,
    menuFooter,
    canBoost,
    confirmBoostStatus,
    canQuote,
    reblogsCount,
    quotesCount,
    favouriteStatusNotify,
    favourited,
    favouritesCount,
    bookmarked,
    bookmarkStatusNotify,
    setShowQuotes,
    quote,
    setShowQuoteChain,
    setShowEmbed,
    mediaFirst,
    enableTranslate,
    language,
    differentLanguage,
    forceTranslate,
    setForceTranslate,
    instance,
    id,
    onStatusLinkClick,
    createdDateText,
    isPublic,
    authenticated,
    isSelf,
    mentionSelf,
    masto,
    muted,
    pinned,
    isPinnable,
    visibility,
    sKey,
    fetchBoostedLikedByAccounts,
  });

  return { menuFooter, StatusMenuItems };
}

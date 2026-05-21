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
  currentAccount?: string | null;
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
  setShowQuoteSettings: (value: boolean) => void;
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
  editedAt?: string | null;
  setShowEdited: (value: string | false) => void;
  editedDateText?: string | false | null;
  isPublic: boolean;
  authenticated?: boolean;
  isSelf?: boolean | string | null;
  mentionSelf?: unknown;
  masto: StatusContentMasto;
  muted?: boolean | null;
  pinned?: boolean | null;
  quoteApprovalPolicyMessages: Parameters<
    typeof useStatusMenuParts
  >[0]['quoteApprovalPolicyMessages'];
  postQuoteApprovalPolicy?: string | null;
  visibility: Parameters<typeof useStatusMenuParts>[0]['visibility'];
  sKey: string;
  fetchBoostedLikedByAccounts: Parameters<
    typeof useStatusMenuParts
  >[0]['fetchBoostedLikedByAccounts'];
}

function isAcceptedQuoteFromCurrentAccount(
  quote: unknown,
  currentAccount: string | null | undefined,
): boolean {
  return (
    !!quote &&
    typeof quote === 'object' &&
    'state' in quote &&
    quote.state === 'accepted' &&
    'quotedStatus' in quote &&
    !!quote.quotedStatus &&
    typeof quote.quotedStatus === 'object' &&
    'account' in quote.quotedStatus &&
    !!quote.quotedStatus.account &&
    typeof quote.quotedStatus.account === 'object' &&
    'id' in quote.quotedStatus.account &&
    quote.quotedStatus.account.id === currentAccount
  );
}

export default function useStatusMenuState({
  mediaNoDesc,
  reblogged,
  statusMonthsAgo,
  accountId,
  mentions,
  currentAccount,
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
  setShowQuoteSettings,
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
  editedAt,
  setShowEdited,
  editedDateText,
  isPublic,
  authenticated,
  isSelf,
  mentionSelf,
  masto,
  muted,
  pinned,
  quoteApprovalPolicyMessages,
  postQuoteApprovalPolicy,
  visibility,
  sKey,
  fetchBoostedLikedByAccounts,
}: StatusMenuStateArgs) {
  const { i18n } = useLingui();
  const rtf = RTF(i18n.locale);
  const isQuotingMyPost = isAcceptedQuoteFromCurrentAccount(
    quote,
    currentAccount,
  );
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
    currentAccount,
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
    setShowQuoteSettings,
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
    editedAt,
    setShowEdited,
    editedDateText,
    isPublic,
    authenticated,
    isSelf,
    mentionSelf,
    masto,
    muted,
    pinned,
    isPinnable,
    quoteApprovalPolicyMessages,
    postQuoteApprovalPolicy,
    visibility,
    isQuotingMyPost,
    sKey,
    fetchBoostedLikedByAccounts,
  });

  return { menuFooter, StatusMenuItems };
}

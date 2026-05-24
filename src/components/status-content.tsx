import { useLingui } from '@lingui/react/macro';
import { ControlledMenu } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { ReactNode, RefObject } from 'react';
import { useCallback, use, useMemo, useReducer, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import { api, getMastoV1Resource } from '../utils/api';
import {
  buildBskyPostPermalink,
  buildAtprotoPostPermalink,
  isAtprotoPostURI,
} from '../utils/atproto-route';
import FilterContext from '../utils/filter-context';
import { isFiltered } from '../utils/filters';
import niceDateTime from '../utils/nice-date-time';
import safeBoundingBoxPadding from '../utils/safe-bounding-box-padding';
import states from '../utils/states';
import { getCurrentAccID } from '../utils/store-utils';
import useTruncated from '../utils/useTruncated';

import AtprotoLabels from './atproto-labels';
import Avatar from './avatar';
import useStatusCommentIndicators from './status-comment-indicators';
import StatusCompact from './status-compact';
import useStatusContextMenu from './status-context-menu';
import useStatusDisplayState from './status-display-state';
import StatusHeader from './status-header';
import { SIZE_CLASS } from './status-helpers';
import StatusInlineControls from './status-inline-controls';
import useStatusInteractions from './status-interactions';
import StatusLargeFooter from './status-large-footer';
import useStatusMediaCaptions from './status-media-captions';
import useStatusMenuState from './status-menu-state';
import StatusModals from './status-modals';
import StatusPostBody from './status-post-body';
import useStatusReplyParent from './status-reply-parent';
import type {
  AnyMediaAttachment,
  AnyStatus,
  StatusContentMasto,
  StatusAtprotoMeta,
} from './status-types';
import type { StatusComponentProps, StatusRouterProps } from './status-view';

const EMPTY_MEDIA_ATTACHMENTS: AnyMediaAttachment[] = [];
Object.freeze(EMPTY_MEDIA_ATTACHMENTS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function getAccountAtprotoLabels(account: unknown): unknown {
  if (!isRecord(account) || !isRecord(account._atproto)) return undefined;
  return account._atproto.labels;
}

function mergeAtprotoLabels(...values: unknown[]): unknown[] {
  return values.flatMap((value) => (isUnknownArray(value) ? value : []));
}

type StatusContentMediaAttachment = AnyMediaAttachment &
  mastodon.v1.MediaAttachment;

interface StatusContentProps extends StatusRouterProps {
  renderStatus: (props: StatusComponentProps) => ReactNode;
}

export default function StatusContent({
  statusID,
  status,
  resolvedSKey,
  instance: propInstance,
  size = 'm',
  contentTextWeight,
  readOnly,
  enableCommentHint,
  withinContext,
  enableTranslate,
  forceTranslate: _forceTranslate,
  previewMode,
  allowFilters,
  onMediaClick,
  quoted,
  quoteDomain,
  onStatusLinkClick = () => {},
  allowContextMenu,
  showActionsBar,
  showReplyParent,
  hideReplyBadge,
  mediaFirst,
  showCommentCount: forceShowCommentCount,
  showQuoteCount: forceShowQuoteCount,
  renderStatus,
}: StatusContentProps) {
  const { t } = useLingui();
  const apiResult = api({ instance: propInstance });
  const instance = apiResult.instance;
  const authenticated = apiResult.authenticated;
  const statusesResource = useMemo(
    () =>
      getMastoV1Resource<StatusContentMasto['v1']['statuses']>(
        apiResult.masto,
        'statuses',
      ),
    [apiResult.masto],
  );
  const masto: StatusContentMasto = useMemo(
    () => ({
      v1: {
        statuses: statusesResource,
      },
    }),
    [statusesResource],
  );
  const { instance: currentInstance } = api();
  const sameInstance = instance === currentInstance;
  const snapStates = useSnapshot(states);
  const sKey = resolvedSKey;
  const liveStatus = (snapStates.statuses[sKey] as AnyStatus | undefined) || status;

  const {
    account,
    id,
    repliesCount,
    reblogged,
    reblogsCount,
    favourited,
    favouritesCount,
    quotesCount,
    bookmarked,
    muted,
    sensitive,
    spoilerText,
    visibility, // public, unlisted, private, direct
    language: _language,
    editedAt,
    filtered,
    card,
    createdAt,
    inReplyToId,
    inReplyToAccountId,
    content,
    mentions,
    mediaAttachments: statusMediaAttachments,
    quote,
    uri: _uri,
    url,
    emojis,
    tags,
    pinned,
    // Non-API props
    _deleted,
    _pinned,
    // _filtered,
  } = liveStatus;
  const statusDataHref =
    typeof _uri === 'string' && isAtprotoPostURI(_uri) ? `/${_uri}` : undefined;
  const {
    acct,
    avatar,
    avatarStatic,
    id: accountId,
    url: accountURL,
    displayName,
    username,
    emojis: _accountEmojis,
    bot,
  } = account || {};
  const mediaAttachments = (statusMediaAttachments ||
    EMPTY_MEDIA_ATTACHMENTS) as StatusContentMediaAttachment[];
  const accountAtprotoLabels = getAccountAtprotoLabels(account);
  const statusAtprotoLabels = status._atproto?.labels;
  const atprotoLabels = useMemo(
    () => mergeAtprotoLabels(accountAtprotoLabels, statusAtprotoLabels),
    [accountAtprotoLabels, statusAtprotoLabels],
  );

  // if (!mediaAttachments?.length) mediaFirst = false;
  const hasMediaAttachments = !!mediaAttachments?.length;
  if (mediaFirst && hasMediaAttachments) size = 's';

  const currentAccount = getCurrentAccID();
  const isSelf = currentAccount && currentAccount == accountId;
  const filterContext = use(FilterContext);
  type FilterInfoShape = {
    action: 'hide' | 'blur' | 'warn';
    titles?: string[];
    titlesStr?: string;
  };
  const filterInfo = (!isSelf &&
    ((!readOnly && !previewMode) || allowFilters) &&
    isFiltered(filtered, filterContext as string)) as
    | FilterInfoShape
    | false
    | undefined;
  const filterInfoMaybe = filterInfo || undefined;

  const debugHover = useCallback(
    (e: React.MouseEvent) => {
      if (e.shiftKey) {
        console.log({
          ...status,
        });
      }
    },
    [status],
  );

  const createdAtDate = new Date(createdAt);
  const editedAtDate = editedAt ? new Date(editedAt) : createdAtDate;

  const atproto: StatusAtprotoMeta | undefined = status._atproto;
  const bluepyPermalink = isAtprotoPostURI(atproto?.uri)
    ? buildAtprotoPostPermalink(atproto.uri)
    : url;
  const bskyPermalink = isAtprotoPostURI(atproto?.uri)
    ? buildBskyPostPermalink(atproto.uri)
    : url;
  const permalink =
    snapStates.settings.shareLinkTarget === 'bsky'
      ? bskyPermalink
      : bluepyPermalink;
  const { inReplyToAccount, mentionSelf, showReplyBadge } =
    useStatusReplyParent({
      instance,
      withinContext,
      inReplyToId,
      inReplyToAccountId,
      currentAccount,
      accountURL,
      username,
      displayName,
      statusID: id,
      spoilerText,
      mentions,
      masto: apiResult.masto,
      atproto,
    });

  const isSizeLarge = size === 'l';

  const {
    StatusParent,
    contentLength,
    forceTranslate,
    setForceTranslate,
    enableTranslate: resolvedEnableTranslate,
    inlineTranslate,
    language,
    languageAutoDetected,
    differentLanguage,
    readingExpandSpoilers,
    readingExpandMedia,
    showSpoiler,
    showSpoilerMedia,
  } = useStatusDisplayState({
    id,
    content,
    language: _language,
    emojis,
    readOnly,
    withinContext,
    isSizeLarge,
    previewMode,
    spoilerText,
    sensitive,
    card,
    filterInfoMaybe,
    enableTranslate,
    forceTranslate: _forceTranslate,
  });
  enableTranslate = resolvedEnableTranslate;

  const [showEmbed, setShowEmbed] = useState(false);
  const [showQuotes, setShowQuotes] = useState(false);
  const [showQuoteChain, setShowQuoteChain] = useState(false);

  // `useTruncated` exposes `Ref<HTMLElement>` but JSX targets are usually
  // narrower (HTMLDivElement, HTMLSpanElement). Cast at the boundary.
  const spoilerContentRef = useTruncated() as RefObject<HTMLDivElement>;
  const contentRef = useTruncated() as RefObject<HTMLDivElement>;
  const mediaContainerRef = useTruncated() as RefObject<HTMLDivElement>;

  const statusRef = useRef<HTMLElement | null>(null);
  const [reloadPostContentCount, reloadPostContent] = useReducer(
    (c) => c + 1,
    0,
  );

  const textWeight = useCallback(
    () =>
      Math.max(
        Math.round(((spoilerText?.length || 0) + contentLength) / 140) || 1,
        1,
      ),
    [spoilerText, contentLength],
  );

  const createdDateText = createdAt && niceDateTime(createdAtDate);
  const editedDateText = editedAt && niceDateTime(editedAtDate);

  // Can boost if:
  // - authenticated AND
  // - visibility != direct OR
  // - visibility = private AND isSelf
  const isPublic = ['public', 'unlisted'].includes(visibility);
  let canBoost = authenticated && isPublic;
  if (visibility === 'private' && isSelf) {
    canBoost = true;
  }

  // ATProto-only: quotes are always available. Mastodon per-post quote-approval
  // semantics are gone; postgate-based controls are a later round.
  const quoteDisabled = false;
  const quoteText = t`Quote`;
  const quoteMetaText: string | undefined = undefined;
  const canQuote = true;

  const {
    unauthInteractionErrorMessage,
    mediaNoDesc,
    statusMonthsAgo,
    replyStatus,
    confirmBoostStatus,
    favouriteStatus,
    favouriteStatusNotify,
    bookmarkStatus,
    bookmarkStatusNotify,
    fetchBoostedLikedByAccounts,
  } = useStatusInteractions({
    statusID,
    status,
    sKey,
    id,
    instance,
    masto,
    sameInstance,
    authenticated,
    isSizeLarge,
    username,
    acct,
    reblogged,
    reblogsCount,
    favourited,
    favouritesCount,
    bookmarked,
    mediaAttachments,
    createdAt,
  });

  const actionsRef = useRef<HTMLDivElement | null>(null);
  const { menuFooter, StatusMenuItems } = useStatusMenuState({
    mediaNoDesc,
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
    reblogged,
    quoteDisabled,
    status,
    quoteMetaText,
    quoteText,
    url: permalink,
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
  });

  const {
    contextMenuRef,
    isContextMenuOpen,
    setIsContextMenuOpen,
    contextMenuProps,
    setContextMenuProps,
    showContextMenu,
    bindLongPressContext,
    bindHotkeyRefs,
  } = useStatusContextMenu({
    allowContextMenu,
    isSizeLarge,
    previewMode,
    readOnly,
    deleted: _deleted,
    quoted,
    statusRef,
    replyStatus,
    favouriteStatusNotify,
    bookmarkStatusNotify,
    confirmBoostStatus,
    canBoost,
    reblogged,
    username,
    acct,
    sameInstance,
    authenticated,
    unauthInteractionErrorMessage,
    quoteDisabled,
    quoteMetaText,
    status,
    url: permalink,
    boostToast: (rebloggedValue, usernameValue, acctValue) =>
      rebloggedValue
        ? t`Removed repost of @${usernameValue || acctValue}'s post`
        : t`Reposted @${usernameValue || acctValue}'s post`,
  });

  const {
    displayedMediaAttachments,
    showMultipleMediaCaptions,
    captionChildren,
  } = useStatusMediaCaptions({
    mediaAttachments,
    isSizeLarge,
    language,
  });

  const statusAccountId = status.account?.id;
  const { isThread, showCommentHint, showCommentCount, showQuoteCount } =
    useStatusCommentIndicators({
      enableCommentHint,
      withinContext,
      inReplyToId,
      inReplyToAccountId,
      statusAccountId,
      statusThreadNumber: snapStates.statusThreadNumber[sKey],
      visibility,
      repliesCount,
      forceShowCommentCount,
      forceShowQuoteCount,
      quotesCount,
      card,
      sensitive,
      spoilerText,
      mediaCount: mediaAttachments.length,
      content,
      contentLength,
    });

  return (
    <StatusParent>
      {showReplyParent && !!(inReplyToId && inReplyToAccountId) && (
        <StatusCompact sKey={sKey} />
      )}
      <article
        data-state-post-id={sKey}
        data-href={statusDataHref}
        ref={(node: HTMLElement | null) => {
          statusRef.current = node;
          // Use parent node if it's in focus
          // Use case: <a><status /></a>
          // When navigating (j/k), the <a> is focused instead of <status />
          // Hotkey binding doesn't bubble up thus this hack
          const nodeRef =
            node?.closest?.(
              '.timeline-item, .timeline-item-alt, .status-link, .status-focus',
            ) || node;
          bindHotkeyRefs(nodeRef);
        }}
        tabIndex={-1}
        className={`status ${
          !withinContext && inReplyToId && inReplyToAccount
            ? 'status-reply-to'
            : ''
        } visibility-${visibility} ${_pinned ? 'status-pinned' : ''} ${
          SIZE_CLASS[size]
        } ${_deleted ? 'status-deleted' : ''} ${quoted ? 'status-card' : ''} ${
          isContextMenuOpen ? 'status-menu-open' : ''
        } ${mediaFirst && hasMediaAttachments ? 'status-media-first' : ''}`}
        onMouseEnter={debugHover}
        onContextMenu={(e: React.MouseEvent) => {
          if (!showContextMenu) return;
          if (e.metaKey) return;
          // console.log('context menu', e);
          const link = (e.target as Element).closest('a');
          const href = link?.getAttribute('href');
          if (
            link &&
            statusRef.current?.contains(link) &&
            href &&
            !href.startsWith('#')
          )
            return;

          // If there's selected text, don't show custom context menu
          const selection = window.getSelection?.();
          if (selection?.toString().length) {
            const { anchorNode } = selection;
            if (statusRef.current?.contains(anchorNode)) {
              return;
            }
          }
          e.preventDefault();
          setContextMenuProps({
            anchorPoint: {
              x: e.clientX,
              y: e.clientY,
            },
            direction: 'right',
          });
          setIsContextMenuOpen(true);
        }}
        {...(showContextMenu ? bindLongPressContext() : {})}
      >
        {showContextMenu && (
          <ControlledMenu
            ref={contextMenuRef}
            state={isContextMenuOpen ? 'open' : undefined}
            {...(contextMenuProps as object)}
            onClose={(e?: { reason?: string }) => {
              setIsContextMenuOpen(false);
              // statusRef.current?.focus?.();
              if (e?.reason === 'click') {
                (
                  statusRef.current?.closest('[tabindex]') as HTMLElement | null
                )?.focus?.();
              }
            }}
            portal={{
              target: document.body,
            }}
            containerProps={{
              style: {
                // Higher than the backdrop
                zIndex: 1001,
              },
              onClick: () => {
                contextMenuRef.current?.closeMenu?.();
              },
            }}
            overflow="auto"
            boundingBoxPadding={safeBoundingBoxPadding()}
            unmountOnClose
          >
            {StatusMenuItems}
          </ControlledMenu>
        )}
        <StatusInlineControls
          showActionsBar={showActionsBar}
          size={size}
          previewMode={previewMode}
          readOnly={readOnly}
          deleted={_deleted}
          isContextMenuOpen={isContextMenuOpen}
          actionsRef={actionsRef}
          setContextMenuProps={setContextMenuProps}
          setIsContextMenuOpen={setIsContextMenuOpen}
          replyStatus={replyStatus}
          favourited={favourited}
          favouritesCount={favouritesCount}
          favouriteStatusNotify={favouriteStatusNotify}
          reblogged={reblogged}
          bookmarked={bookmarked}
          pinned={_pinned}
        />
        {size !== 's' && (
          <a
            href={accountURL ?? undefined}
            tabIndex={-1}
            title={`@${acct}`}
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              states.showAccount = {
                account,
                instance,
              };
            }}
          >
            <Avatar
              url={(avatarStatic || avatar) ?? undefined}
              size="xxl"
              squircle={bot ?? undefined}
            />
          </a>
        )}
        <div className="container">
          <StatusHeader
            size={size}
            status={status}
            instance={instance}
            quoteDomain={quoteDomain}
            createdAt={createdAt}
            isSizeLarge={isSizeLarge}
            withinContext={withinContext}
            isThread={isThread}
            threadNumber={
              snapStates.statusThreadNumber[sKey] as number | undefined
            }
            sKey={sKey}
            deleted={_deleted}
            url={permalink}
            previewMode={previewMode}
            readOnly={readOnly}
            quoted={quoted}
            id={id}
            onStatusLinkClick={onStatusLinkClick}
            setContextMenuProps={setContextMenuProps}
            setIsContextMenuOpen={setIsContextMenuOpen}
            isContextMenuOpen={isContextMenuOpen}
            contextMenuProps={contextMenuProps}
            showCommentHint={!!showCommentHint}
            showCommentCount={showCommentCount}
            repliesCount={repliesCount}
            editedAt={editedAt}
            createdAtDate={createdAtDate}
            inReplyToAccount={inReplyToAccount as AnyStatus['account'] | null}
            showReplyBadge={showReplyBadge && !hideReplyBadge}
          />
          <AtprotoLabels labels={atprotoLabels} sourceProfiles={account} />
          <StatusPostBody
            mediaFirst={mediaFirst}
            hasMediaAttachments={hasMediaAttachments}
            spoilerText={spoilerText}
            sensitive={sensitive}
            filterInfoMaybe={filterInfoMaybe}
            readingExpandMedia={readingExpandMedia}
            showSpoiler={showSpoiler}
            showSpoilerMedia={showSpoilerMedia}
            contentTextWeight={contentTextWeight}
            textWeight={textWeight}
            isSizeLarge={isSizeLarge}
            readingExpandSpoilers={readingExpandSpoilers}
            language={language}
            spoilerContentRef={spoilerContentRef}
            emojis={emojis}
            id={id}
            mediaAttachments={mediaAttachments}
            instance={instance}
            content={content}
            contentRef={contentRef}
            status={status}
            previewMode={previewMode}
            reloadPostContentCount={reloadPostContentCount}
            reloadPostContent={reloadPostContent as () => void}
            enableTranslate={enableTranslate}
            inlineTranslate={inlineTranslate}
            differentLanguage={differentLanguage}
            forceTranslate={forceTranslate}
            withinContext={withinContext}
            languageAutoDetected={!!languageAutoDetected}
            displayedMediaAttachments={
              displayedMediaAttachments as StatusContentMediaAttachment[]
            }
            showMultipleMediaCaptions={showMultipleMediaCaptions}
            captionChildren={captionChildren}
            mediaContainerRef={mediaContainerRef}
            onMediaClick={onMediaClick}
            quoted={quoted}
            quote={quote}
            renderStatus={renderStatus}
            card={card}
            statusQuoteState={snapStates.statusQuotes[sKey]}
            accountURL={accountURL}
            size={size}
            tags={tags}
            showCommentCount={showCommentCount}
            showQuoteCount={showQuoteCount}
            repliesCount={repliesCount}
            quotesCount={quotesCount}
          />
          {isSizeLarge && (
            <StatusLargeFooter
              deleted={_deleted}
              url={permalink}
              createdAt={createdAt}
              createdAtDate={createdAtDate}
              createdDateText={createdDateText}
              editedAt={editedAt}
              editedAtDate={editedAtDate}
              editedDateText={editedDateText}
              repliesCount={repliesCount}
              replyStatus={replyStatus}
              canQuote={canQuote}
              reblogsCount={reblogsCount}
              quotesCount={quotesCount}
              canBoost={canBoost}
              confirmBoostStatus={confirmBoostStatus}
              reblogged={reblogged}
              quoteDisabled={quoteDisabled}
              quoteText={quoteText}
              quoteMetaText={quoteMetaText}
              status={status}
              menuFooter={menuFooter}
              favourited={favourited}
              favouritesCount={favouritesCount}
              favouriteStatus={favouriteStatus}
              bookmarked={bookmarked}
              bookmarkStatus={bookmarkStatus}
              menuItems={StatusMenuItems}
            />
          )}
        </div>
        <StatusModals
          showEmbed={showEmbed}
          setShowEmbed={setShowEmbed}
          showQuotes={showQuotes}
          setShowQuotes={setShowQuotes}
          showQuoteChain={showQuoteChain}
          setShowQuoteChain={setShowQuoteChain}
          status={status}
          id={id}
          instance={instance}
          renderStatus={(statusProps) => renderStatus(statusProps)}
        />
      </article>
    </StatusParent>
  );
}

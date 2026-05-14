import { useLingui } from '@lingui/react/macro';
import { ControlledMenu } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { ComponentChildren, RefObject } from 'preact';
import {
  useCallback,
  useContext,
  useReducer,
  useRef,
  useState,
} from 'preact/hooks';
import { useSnapshot } from 'valtio';

import { api } from '../utils/api';
import FilterContext from '../utils/filter-context';
import { isFiltered } from '../utils/filters';
import niceDateTime from '../utils/nice-date-time';
import safeBoundingBoxPadding from '../utils/safe-bounding-box-padding';
import states from '../utils/states';
import { getCurrentAccID } from '../utils/store-utils';
import useTruncated from '../utils/useTruncated';

import Avatar from './avatar';
import { SIZE_CLASS } from './status-helpers';
import useStatusContextMenu from './status-context-menu';
import useStatusDisplayState from './status-display-state';
import StatusHeader from './status-header';
import useStatusInteractions from './status-interactions';
import StatusInlineControls from './status-inline-controls';
import useStatusCommentIndicators from './status-comment-indicators';
import StatusLargeFooter from './status-large-footer';
import useStatusMediaCaptions from './status-media-captions';
import useStatusMenuState from './status-menu-state';
import StatusModals from './status-modals';
import StatusPostBody from './status-post-body';
import useStatusQuotePolicy from './status-quote-policy';
import useStatusReplyParent from './status-reply-parent';
import type {
  AnyMediaAttachment,
  AnyStatus,
  FullMasto,
  StatusAtprotoMeta,
} from './status-types';
import type { StatusComponentProps, StatusRouterProps } from './status-view';
import StatusCompact from './status-compact';

const EMPTY_MEDIA_ATTACHMENTS: AnyMediaAttachment[] = [];
Object.freeze(EMPTY_MEDIA_ATTACHMENTS);

type StatusContentMediaAttachment = AnyMediaAttachment &
  mastodon.v1.MediaAttachment;

interface StatusContentProps extends StatusRouterProps {
  renderStatus: (props: StatusComponentProps) => ComponentChildren;
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
  showFollowedTags,
  allowContextMenu,
  showActionsBar,
  showReplyParent,
  mediaFirst,
  showCommentCount: forceShowCommentCount,
  showQuoteCount: forceShowQuoteCount,
  renderStatus,
}: StatusContentProps) {
  const { t } = useLingui();
  const apiResult = api({ instance: propInstance });
  const instance = apiResult.instance;
  const authenticated = apiResult.authenticated;
  // The project-local MastoClient is intentionally narrow; cast the runtime
  // client to the full mastodon REST client for the rich endpoints below.
  const masto = apiResult.masto as unknown as FullMasto;
  const { instance: currentInstance } = api();
  const sameInstance = instance === currentInstance;
  const snapStates = useSnapshot(states);
  const sKey = resolvedSKey;

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
    poll,
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
    quoteApproval,
    // Non-API props
    _deleted,
    _pinned,
    // _filtered,
    // Non-Mastodon
    emojiReactions,
  } = status;
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

  // if (!mediaAttachments?.length) mediaFirst = false;
  const hasMediaAttachments = !!mediaAttachments?.length;
  if (mediaFirst && hasMediaAttachments) size = 's';

  const currentAccount = getCurrentAccID();
  const isSelf = currentAccount && currentAccount == accountId;
  const filterContext = useContext(FilterContext);
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
    (e: MouseEvent) => {
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
      masto,
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
    sKey,
    instance,
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
    poll,
    card,
    filterInfoMaybe,
    showFollowedTags,
    enableTranslate,
    forceTranslate: _forceTranslate,
    debugHover,
  });
  enableTranslate = resolvedEnableTranslate;

  const [showEdited, setShowEdited] = useState<string | false>(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [showQuoteSettings, setShowQuoteSettings] = useState(false);
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

  const {
    quoteDisabled,
    quoteText,
    quoteMetaText,
    canQuote,
    postQuoteApprovalPolicy,
    quoteApprovalPolicyMessages,
  } = useStatusQuotePolicy({
    quoteApproval,
    isPublic,
    isSelf,
    visibility,
  });

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
  const {
    menuFooter,
    replyModeMenuItems,
    StatusMenuItems,
    tooManyMentions,
  } = useStatusMenuState({
    mediaNoDesc,
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
    reblogged,
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
    url,
    boostToast: (rebloggedValue, usernameValue, acctValue) =>
      rebloggedValue
        ? t`Unboosted @${usernameValue || acctValue}'s post`
        : t`Boosted @${usernameValue || acctValue}'s post`,
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
  const {
    isThread,
    showCommentHint,
    showCommentCount,
    showQuoteCount,
  } = useStatusCommentIndicators({
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
    poll,
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
        tabindex={-1}
        class={`status ${
          !withinContext && inReplyToId && inReplyToAccount
            ? 'status-reply-to'
            : ''
        } visibility-${visibility} ${_pinned ? 'status-pinned' : ''} ${
          SIZE_CLASS[size]
        } ${_deleted ? 'status-deleted' : ''} ${quoted ? 'status-card' : ''} ${
          isContextMenuOpen ? 'status-menu-open' : ''
        } ${mediaFirst && hasMediaAttachments ? 'status-media-first' : ''}`}
        onMouseEnter={debugHover}
        onContextMenu={(e: MouseEvent) => {
          if (!showContextMenu) return;
          if (e.metaKey) return;
          // console.log('context menu', e);
          const link = (e.target as Element).closest('a');
          if (
            link &&
            statusRef.current!.contains(link) &&
            !link.getAttribute('href')!.startsWith('#')
          )
            return;

          // If there's selected text, don't show custom context menu
          const selection = window.getSelection?.();
          if (selection!.toString().length > 0) {
            const { anchorNode } = selection!;
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
            {...contextMenuProps}
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
          tooManyMentions={tooManyMentions}
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
            tabindex={-1}
            title={`@${acct}`}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              states.showAccount = {
                account: status.account,
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
        <div class="container">
          <StatusHeader
            size={size}
            status={status}
            instance={instance}
            quoteDomain={quoteDomain}
            createdAt={createdAt}
            isSizeLarge={isSizeLarge}
            withinContext={withinContext}
            isThread={isThread}
            threadNumber={snapStates.statusThreadNumber[sKey] as number | undefined}
            sKey={sKey}
            deleted={_deleted}
            url={url}
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
            visibility={visibility}
            editedAt={editedAt}
            createdAtDate={createdAtDate}
            inReplyToAccount={inReplyToAccount as unknown as AnyStatus['account'] | null}
            showReplyBadge={showReplyBadge}
          />
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
            poll={poll}
            readOnly={readOnly}
            sameInstance={sameInstance}
            authenticated={authenticated}
            masto={masto}
            sKey={sKey}
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
            currentInstance={currentInstance}
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
              visibility={visibility}
              url={url}
              createdAt={createdAt}
              createdAtDate={createdAtDate}
              createdDateText={createdDateText}
              editedAt={editedAt}
              editedAtDate={editedAtDate}
              editedDateText={editedDateText}
              id={id}
              setShowEdited={setShowEdited}
              emojiReactions={emojiReactions}
              emojis={emojis}
              tooManyMentions={tooManyMentions}
              repliesCount={repliesCount}
              replyModeMenuItems={replyModeMenuItems}
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
          showEdited={showEdited}
          setShowEdited={setShowEdited}
          showEmbed={showEmbed}
          setShowEmbed={setShowEmbed}
          showQuoteSettings={showQuoteSettings}
          setShowQuoteSettings={setShowQuoteSettings}
          showQuotes={showQuotes}
          setShowQuotes={setShowQuotes}
          showQuoteChain={showQuoteChain}
          setShowQuoteChain={setShowQuoteChain}
          status={status}
          id={id}
          instance={instance}
          fetchStatusHistory={
            ((historyStatusID: string) =>
              masto.v1.statuses
                .$select(historyStatusID)
                .history.list()) as unknown as (
              historyStatusID: string,
            ) => Promise<AnyStatus[] | undefined>
          }
          renderHistoryStatus={(historyStatus, historyInstance) =>
            renderStatus({
              status: historyStatus,
              instance: historyInstance,
              size: 's',
              withinContext: true,
              readOnly: true,
              previewMode: true,
            })
          }
          statusRef={statusRef}
          postQuoteApprovalPolicy={postQuoteApprovalPolicy}
          renderStatus={(statusProps) =>
            renderStatus(statusProps)
          }
        />
      </article>
      </StatusParent>
    );
}

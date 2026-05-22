import './status.css';

import { shallowEqual } from 'fast-equals';
import { memo } from 'react';
import { use, useCallback, useMemo } from 'react';
import { useSnapshot } from 'valtio';

import { api } from '../utils/api';
import FilterContext from '../utils/filter-context';
import { isFiltered } from '../utils/filters';
import {
  getMutedPostVisibility,
  shouldCollapseMutedStatus,
  shouldHideMutedStatus,
} from '../utils/muted-post-visibility';
import states, { statusKey } from '../utils/states';
import { getCurrentAccID } from '../utils/store-utils';

import FilteredStatus from './filtered-status';
import MutedStatus from './muted-status';
import StatusContent from './status-content';
import { StatusGhost, StatusSkeleton } from './status-placeholders';
import StatusReblog, { type RenderReblogStatusArgs } from './status-reblog';
import type {
  AnyMediaAttachment,
  AnyStatus,
  GhostInfo,
  StatusSize,
} from './status-types';

const EMPTY_MEDIA_ATTACHMENTS: AnyStatus['mediaAttachments'] = [];
Object.freeze(EMPTY_MEDIA_ATTACHMENTS);

export interface StatusComponentProps {
  statusID?: string | null;
  status?: AnyStatus | null;
  instance?: string;
  size?: StatusSize;
  contentTextWeight?: boolean;
  readOnly?: boolean;
  enableCommentHint?: boolean;
  withinContext?: boolean;
  skeleton?: boolean;
  enableTranslate?: boolean;
  forceTranslate?: boolean;
  previewMode?: boolean;
  allowFilters?: boolean;
  onMediaClick?: (
    e: React.MouseEvent,
    i: number,
    media: AnyMediaAttachment,
    status: AnyStatus,
  ) => void;
  quoted?: number | boolean;
  quoteDomain?: string;
  onStatusLinkClick?: (
    e: React.MouseEvent | KeyboardEvent,
    status: AnyStatus,
  ) => void;
  allowContextMenu?: boolean;
  showActionsBar?: boolean;
  showReplyParent?: boolean;
  hideReplyBadge?: boolean;
  mediaFirst?: boolean;
  showCommentCount?: boolean | ((count?: number) => boolean);
  showQuoteCount?: boolean | ((count?: number) => boolean);
  ghost?: GhostInfo | null;
  forceShowMuted?: boolean;
}

function Status(props: StatusComponentProps) {
  // Render ghost/skeleton variants from this outer wrapper so the hook-using
  // body (StatusInner) is only mounted when there's a real status to render.
  // This keeps hook order stable across renders (react-hooks/rules-of-hooks).
  const { ghost, skeleton, mediaFirst, size = 'm' } = props;

  if (ghost) {
    return <StatusGhost ghost={ghost} mediaFirst={mediaFirst} size={size} />;
  }

  if (skeleton) {
    return <StatusSkeleton mediaFirst={mediaFirst} size={size} />;
  }

  return <StatusShell {...props} />;
}

function StatusShell(props: StatusComponentProps) {
  const { statusID, status: propStatus, instance: propInstance } = props;
  const { instance } = api({ instance: propInstance });
  let sKeyMaybe: string | undefined = statusKey(
    statusID || propStatus?.id,
    instance,
  );
  const snapStates = useSnapshot(states);
  let status = propStatus;
  if (!status) {
    status = ((sKeyMaybe ? snapStates.statuses[sKeyMaybe] : undefined) ||
      (statusID ? snapStates.statuses[statusID] : undefined)) as
      | AnyStatus
      | null
      | undefined;
    sKeyMaybe = statusKey(status?.id, instance);
  }
  if (!status || !sKeyMaybe) {
    return null;
  }

  return <StatusRouter {...props} status={status} resolvedSKey={sKeyMaybe} />;
}

export interface StatusRouterProps extends StatusComponentProps {
  status: AnyStatus;
  resolvedSKey: string;
}

function StatusRouter({
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
  forceShowMuted,
}: StatusRouterProps) {
  const apiResult = api({ instance: propInstance });
  const instance = apiResult.instance;
  const snapStates = useSnapshot(states);
  const sKey = resolvedSKey;

  const {
    account,
    id,
    filtered,
    mediaAttachments: statusMediaAttachments,
    reblog,
  } = status;
  const accountId = account?.id;
  const group = account?.group;
  const mediaAttachments = statusMediaAttachments || EMPTY_MEDIA_ATTACHMENTS;

  // if (!mediaAttachments?.length) mediaFirst = false;
  const requestedSize = size;
  const hasMediaAttachments = !!mediaAttachments?.length;
  if (mediaFirst && hasMediaAttachments) size = 's';

  const currentAccount = getCurrentAccID();
  const isSelf = currentAccount && currentAccount == accountId;
  const mutedPostVisibility = getMutedPostVisibility(snapStates.settings);
  const directContext = withinContext || requestedSize === 'l';

  const filterContext = use(FilterContext);
  // The short-circuited `&&` chain narrows to `false | FilterState`; in
  // practice JS treated the boolean fall-through as a falsy value. The cast
  // surfaces the FilterState shape for the optional property accesses below.
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
  // Narrowed accessor for `?.action` style reads — boolean fall-through is
  // treated as no filter at all (matches JS runtime).
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
  const hoverContainerProps = useMemo(
    () => ({
      onMouseEnter: debugHover,
    }),
    [debugHover],
  );
  const renderPeekStatus = useCallback(
    (peekStatus: AnyStatus, peekInstance: string | undefined) => (
      <Status status={peekStatus} instance={peekInstance} size="s" readOnly />
    ),
    [],
  );
  const renderExpandedStatus = useCallback(
    (expandedStatus: AnyStatus, expandedInstance: string | undefined) => (
      <Status
        status={expandedStatus}
        instance={expandedInstance}
        size={size}
        contentTextWeight={contentTextWeight}
        readOnly={readOnly}
        enableCommentHint={enableCommentHint}
        withinContext={withinContext}
        enableTranslate={enableTranslate}
        forceTranslate={_forceTranslate}
        previewMode={previewMode}
        allowFilters={allowFilters}
        onMediaClick={onMediaClick}
        quoted={quoted}
        quoteDomain={quoteDomain}
        onStatusLinkClick={onStatusLinkClick}
        allowContextMenu={allowContextMenu}
        showActionsBar={showActionsBar}
        showReplyParent={showReplyParent}
        hideReplyBadge={hideReplyBadge}
        mediaFirst={mediaFirst}
        showCommentCount={forceShowCommentCount}
        showQuoteCount={forceShowQuoteCount}
        forceShowMuted
      />
    ),
    [
      _forceTranslate,
      allowContextMenu,
      allowFilters,
      contentTextWeight,
      enableCommentHint,
      enableTranslate,
      forceShowCommentCount,
      forceShowQuoteCount,
      hideReplyBadge,
      mediaFirst,
      onMediaClick,
      onStatusLinkClick,
      previewMode,
      quoteDomain,
      quoted,
      readOnly,
      showActionsBar,
      showReplyParent,
      size,
      withinContext,
    ],
  );
  const renderReblogStatus = useCallback(
    (args: RenderReblogStatusArgs) => <Status {...args} />,
    [],
  );
  const renderContentStatus = useCallback(
    (statusProps: StatusComponentProps) => <Status {...statusProps} />,
    [],
  );

  if (filterInfoMaybe && filterInfoMaybe.action === 'hide') {
    return null;
  }

  if (
    shouldHideMutedStatus({
      status,
      currentAccountID: currentAccount,
      visibility: mutedPostVisibility,
      forceShowMuted,
      directContext,
    })
  ) {
    return null;
  }

  console.debug('RENDER Status', id, status?.account?.displayName, quoted);

  if (
    (allowFilters || size !== 'l') &&
    filterInfo &&
    filterInfo.action !== 'blur'
  ) {
    return (
      <FilteredStatus
        status={status}
        filterInfo={filterInfo}
        instance={instance}
        containerProps={hoverContainerProps}
        quoted={quoted}
        renderPeekStatus={renderPeekStatus}
      />
    );
  }

  if (
    shouldCollapseMutedStatus({
      status,
      currentAccountID: currentAccount,
      visibility: mutedPostVisibility,
      forceShowMuted,
      directContext,
    })
  ) {
    return (
      <MutedStatus
        status={status}
        instance={instance}
        containerProps={hoverContainerProps}
        quoted={quoted}
        renderExpandedStatus={renderExpandedStatus}
      />
    );
  }

  if (reblog) {
    return (
      <StatusReblog
        wrapperStatus={status}
        reblog={reblog}
        statusID={statusID}
        stateKey={sKey}
        instance={instance}
        size={size}
        contentTextWeight={contentTextWeight}
        readOnly={readOnly}
        mediaFirst={mediaFirst}
        group={group}
        onMouseEnter={debugHover}
        renderStatus={renderReblogStatus}
      />
    );
  }

  return (
    <StatusContent
      statusID={statusID}
      status={status}
      resolvedSKey={sKey}
      instance={propInstance}
      size={size}
      contentTextWeight={contentTextWeight}
      readOnly={readOnly}
      enableCommentHint={enableCommentHint}
      withinContext={withinContext}
      enableTranslate={enableTranslate}
      forceTranslate={_forceTranslate}
      previewMode={previewMode}
      allowFilters={allowFilters}
      onMediaClick={onMediaClick}
      quoted={quoted}
      quoteDomain={quoteDomain}
      onStatusLinkClick={onStatusLinkClick}
      allowContextMenu={allowContextMenu}
      showActionsBar={showActionsBar}
      showReplyParent={showReplyParent}
      hideReplyBadge={hideReplyBadge}
      mediaFirst={mediaFirst}
      showCommentCount={forceShowCommentCount}
      showQuoteCount={forceShowQuoteCount}
      renderStatus={renderContentStatus}
    />
  );
}

export default memo(Status, (oldProps, newProps) => {
  // Shallow equal all props except 'status'
  // This will be pure static until status ID changes
  const { status, ...restOldProps } = oldProps;
  const { status: newStatus, ...restNewProps } = newProps;
  return (
    status?.id === newStatus?.id && shallowEqual(restOldProps, restNewProps)
  );
});

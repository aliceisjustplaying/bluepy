import './media-post.css';

import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ReactNode, ComponentType, JSX } from 'react';
import { memo } from 'react';
import { use, useMemo } from 'react';
import { useSnapshot } from 'valtio';

import { getPreferences } from '../utils/api';
import FilterContext from '../utils/filter-context';
import { isFiltered } from '../utils/filters';
import states, { statusKey } from '../utils/states';
import { getCurrentAccountID } from '../utils/store-utils';

import Media from './media';

type FilterResult = mastodon.v1.FilterResult;

interface MediaAttachmentLike {
  id: string;
  [key: string]: unknown;
}

interface StatusLike {
  id: string;
  account: {
    acct?: string;
    avatar?: string;
    avatarStatic?: string;
    id?: string;
    url?: string;
    displayName?: string;
    username?: string;
    emojis?: unknown;
    bot?: boolean;
    group?: boolean;
  };
  mediaAttachments?: MediaAttachmentLike[];
  sensitive?: boolean;
  spoilerText?: string;
  language?: string;
  filtered?: readonly FilterResult[] | null;
  [key: string]: unknown;
}

type ParentTag = keyof JSX.IntrinsicElements;

interface MediaPostProps {
  class?: string;
  className?: string;
  statusID?: string;
  status?: StatusLike;
  instance?: string;
  parent?: ParentTag | ComponentType<Record<string, unknown>>;
  onMediaClick?: (
    e: React.MouseEvent,
    i: number,
    media: MediaAttachmentLike,
    status: StatusLike,
  ) => void;
}

function MediaPost({
  class: classProp,
  className = classProp,
  statusID,
  status,
  instance,
  parent,
  // allowFilters,
  onMediaClick,
}: MediaPostProps): ReactNode | ReactNode[] {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const currentAccount = useMemo(() => {
    return getCurrentAccountID();
  }, []);
  const filterContext = use(FilterContext);

  let sKey = statusKey(statusID, instance);
  if (!status) {
    const fromSKey = sKey ? snapStates.statuses[sKey] : undefined;
    const fromID = statusID ? snapStates.statuses[statusID] : undefined;
    // Snapshot returns a readonly view of the proxy. Mirror the JS behavior
    // by allowing the resolved status to be reassigned into our local
    // mutable view. Narrower `Status` typing lives with the `states.ts` work.
    status = (fromSKey || fromID) as StatusLike | undefined;
    sKey = statusKey(status?.id, instance);
  }
  if (!status) {
    return null;
  }

  const {
    account: { id: accountId },
    id,
    sensitive,
    spoilerText,
    language,
    filtered,
    mediaAttachments,
  } = status;

  const isSelf = currentAccount && currentAccount === accountId;

  if (!mediaAttachments?.length) {
    return null;
  }

  const debugHover = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      console.log({
        ...status,
      });
    }
  };

  // `isFiltered`'s typed signature requires a string context, but the JS
  // original calls it with `undefined` when no FilterContext is provided and
  // `_isFiltered` short-circuits to `false`. The `as string` shim mirrors
  // existing call sites in `src/utils/filters.ts` and preserves that
  // behavior; tightening the type lives with the `filters` typing work.
  const filterInfo = !isSelf && isFiltered(filtered, filterContext as string);

  if (filterInfo && filterInfo.action === 'hide') {
    return null;
  }

  console.debug('RENDER Media post', id, status?.account.displayName);

  const hasSpoiler = sensitive;
  const prefs = getPreferences();
  const readingExpandMediaRaw = prefs['reading:expand:media'];
  const readingExpandMedia =
    (typeof readingExpandMediaRaw === 'string'
      ? readingExpandMediaRaw.toLowerCase()
      : '') || 'default';
  const showSpoilerMedia = readingExpandMedia === 'show_all';

  const Parent = parent || 'div';

  return mediaAttachments.map((media, i) => {
    const mediaKey = `${sKey}-${media.id}`;
    // After the `filterInfo.action === 'hide'` early return, only `blur` /
    // `warn` shapes (which carry `titlesStr`) or `false` remain.
    const filterTitleStr = filterInfo ? filterInfo.titlesStr : undefined;
    return (
      <Parent
        data-state-post-id={sKey}
        onMouseEnter={debugHover}
        key={mediaKey}
        data-spoiler-text={
          spoilerText || (sensitive ? t`Sensitive media` : undefined)
        }
        data-filtered-text={
          filterInfo
            ? filterTitleStr
              ? t`Filtered: ${filterTitleStr}`
              : t`Filtered`
            : undefined
        }
        className={`
          media-post
          ${filterInfo ? 'filtered' : ''}
          ${hasSpoiler ? 'has-spoiler' : ''}
          ${showSpoilerMedia ? 'show-media' : ''}
        `}
      >
        <Media
          className={className}
          media={media}
          lang={language}
          to={`/${instance}/s/${id}?media-only=${i + 1}`}
          onClick={
            onMediaClick
              ? (e) => {
                  onMediaClick(e, i, media, status);
                }
              : () => {
                  window.sessionStorage.setItem(
                    'bluepy:last-feed-path',
                    `${window.location.pathname}${window.location.search}`,
                  );
                  const listPage =
                    document.querySelector<HTMLElement>('#list-page');
                  if (listPage) {
                    window.sessionStorage.setItem(
                      `bluepy:feed-scroll:${window.location.pathname}${window.location.search}`,
                      String(listPage.scrollTop),
                    );
                    window.sessionStorage.setItem(
                      'bluepy:last-feed-scroll',
                      String(listPage.scrollTop),
                    );
                  }
                  states.prevLocation = {
                    pathname: window.location.pathname,
                    search: window.location.search,
                    hash: window.location.hash,
                  };
                }
          }
        />
      </Parent>
    );
  });
}

export default memo(MediaPost);

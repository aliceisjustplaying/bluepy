import './media-post.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentChild, ComponentType, JSX } from 'preact';
import { memo } from 'preact/compat';
import { useContext, useMemo } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import { getPreferences } from '../utils/api';
import FilterContext from '../utils/filter-context';
import { isFiltered } from '../utils/filters';
import states, { statusKey } from '../utils/states';
import store from '../utils/store';
import { getCurrentAccountID } from '../utils/store-utils';

import MediaRaw from './media';

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

const Media = MediaRaw as unknown as ComponentType<{
  class?: string;
  media: MediaAttachmentLike;
  lang?: string;
  to?: string;
  onClick?: (e: MouseEvent) => void;
}>;

type ParentTag = keyof JSX.IntrinsicElements;

interface MediaPostProps {
  class?: string;
  statusID?: string;
  status?: StatusLike;
  instance?: string;
  parent?: ParentTag | ComponentType<Record<string, unknown>>;
  onMediaClick?: (
    e: MouseEvent,
    i: number,
    media: MediaAttachmentLike,
    status: StatusLike,
  ) => void;
}

function MediaPost({
  class: className,
  statusID,
  status,
  instance,
  parent,
  // allowFilters,
  onMediaClick,
}: MediaPostProps): ComponentChild | ComponentChild[] {
  const { t } = useLingui();
  let sKey = statusKey(statusID, instance);
  const snapStates = useSnapshot(states);
  if (!status) {
    const fromSKey = sKey ? snapStates.statuses[sKey] : undefined;
    const fromID = statusID ? snapStates.statuses[statusID] : undefined;
    // Snapshot returns a readonly view of the proxy. Mirror the JS behavior
    // by allowing the resolved status to be reassigned into our local
    // mutable view via the unknown-to-mutable shim used elsewhere in this
    // file. Narrower `Status` typing lives with the `states.ts` work.
    status = (fromSKey || fromID) as unknown as StatusLike | undefined;
    sKey = statusKey(status?.id, instance);
  }
  if (!status) {
    return null;
  }

  const {
    account: {
      acct,
      avatar,
      avatarStatic,
      id: accountId,
      url: accountURL,
      displayName,
      username,
      emojis: accountEmojis,
      bot,
      group,
    },
    id,
    repliesCount,
    reblogged,
    reblogsCount,
    favourited,
    favouritesCount,
    bookmarked,
    poll,
    muted,
    sensitive,
    spoilerText,
    visibility, // public, unlisted, private, direct
    language,
    editedAt,
    filtered,
    card,
    createdAt,
    inReplyToId,
    inReplyToAccountId,
    content,
    mentions,
    mediaAttachments,
    reblog,
    uri,
    url,
    emojis,
    // Non-API props
    _deleted,
    _pinned,
    // _filtered,
  } = status;

  if (!mediaAttachments?.length) {
    return null;
  }

  const debugHover = (e: MouseEvent) => {
    if (e.shiftKey) {
      console.log({
        ...status,
      });
    }
  };

  const currentAccount = useMemo(() => {
    return getCurrentAccountID();
  }, []);
  const isSelf = useMemo(() => {
    return currentAccount && currentAccount === accountId;
  }, [accountId, currentAccount]);

  const filterContext = useContext(FilterContext);
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
        class={`
          media-post
          ${filterInfo ? 'filtered' : ''}
          ${hasSpoiler ? 'has-spoiler' : ''}
          ${showSpoilerMedia ? 'show-media' : ''}
        `}
      >
        <Media
          class={className}
          media={media}
          lang={language}
          to={`/${instance}/s/${id}?media-only=${i + 1}`}
          onClick={
            onMediaClick ? (e) => onMediaClick(e, i, media, status) : undefined
          }
        />
      </Parent>
    );
  });
}

export default memo(MediaPost);

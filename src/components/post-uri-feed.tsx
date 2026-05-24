import type { AppBskyFeedDefs } from '@atproto/api';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { MouseEvent, ReactNode, UIEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  groupBoostItems,
  isReasonRepost,
  normalizeTimelineFeedItem,
} from '../data/_internal/group-boost-items';
import type { TimelineFeedItem } from '../data/feeds';
import { usePost } from '../data/posts';
import FilterContext from '../utils/filter-context';
import { canonicalizeAppPath, navigatePath } from '../utils/router';
import states from '../utils/states';
import useTitle from '../utils/useTitle';

import Icon from './icon';
import Link from './link';
import Loader from './loader';
import NavMenu from './nav-menu';
import PostByUri, { isReasonPin } from './post-by-uri';
import { StatusCarousel } from './timeline';

function isModifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function rememberFeedScroll(locationKey: string, scrollTop: number): void {
  const canonicalLocationKey = canonicalizeAppPath(locationKey);
  for (const key of new Set([locationKey, canonicalLocationKey])) {
    window.sessionStorage.setItem(
      `bluepy:feed-scroll:${key}`,
      String(scrollTop),
    );
  }
  window.sessionStorage.setItem('bluepy:last-feed-scroll', String(scrollTop));
  window.sessionStorage.setItem('bluepy:last-feed-path', canonicalLocationKey);
}

function getSavedFeedScroll(locationKey: string): number {
  const canonicalLocationKey = canonicalizeAppPath(locationKey);
  const savedScroll = Math.max(
    ...[locationKey, canonicalLocationKey].map((key) =>
      Number(window.sessionStorage.getItem(`bluepy:feed-scroll:${key}`) ?? 0),
    ),
  );
  const lastFeedPath = window.sessionStorage.getItem('bluepy:last-feed-path');
  const lastFeedScroll =
    lastFeedPath === canonicalLocationKey
      ? Number(window.sessionStorage.getItem('bluepy:last-feed-scroll') ?? 0)
      : 0;
  return Math.max(savedScroll, lastFeedScroll);
}

function getPathScrollKey(path: string | string[]): string {
  if (Array.isArray(path)) return path.join('|');
  return path;
}

function getCurrentLocationKey(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function getFeedScrollLocationKey(path: string | string[]): string {
  const scrollKey = getPathScrollKey(path);
  return scrollKey || getCurrentLocationKey();
}

function getFeedScrollRestoreValue(path: string | string[]): number {
  const locationKey = getFeedScrollLocationKey(path);
  return Math.max(
    getSavedFeedScroll(locationKey),
    locationKey === getCurrentLocationKey()
      ? getSavedFeedScroll(getCurrentLocationKey())
      : 0,
  );
}

function restoreFeedScroll(scrollTop: number): void {
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) return;
  let attempts = 0;
  const restoreScroll = () => {
    const listPage = document.querySelector<HTMLElement>('#list-page');
    const timelineList =
      listPage?.querySelector<HTMLElement>('.timeline-list');
    if (listPage && timelineList) {
      timelineList.style.minHeight = `${scrollTop + listPage.clientHeight + 800}px`;
    }
    if (listPage) listPage.scrollTop = scrollTop;
    attempts += 1;
    if (attempts < 30) requestAnimationFrame(restoreScroll);
  };
  requestAnimationFrame(restoreScroll);
}

export interface PostUriFeedSource {
  items: readonly (TimelineFeedItem | string)[];
  loadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoading: boolean;
  error: Error | null;
}

export interface PostUriFeedProps {
  source: PostUriFeedSource;
  title?: string;
  titleComponent?: ReactNode;
  path?: string | string[];
  id?: string;
  headerStart?: ReactNode | false;
  headerEnd?: ReactNode;
  timelineStart?: ReactNode;
  emptyText?: string;
  errorText?: string;
  filterContext?: string;
  boostsCarousel?: boolean;
}

function RepostHeader({ reason }: { reason: AppBskyFeedDefs.ReasonRepost }) {
  const handle = reason.by.handle || reason.by.did;
  return (
    <div className="status-reblog-line">
      <Icon icon="rocket" size="s" alt="" />
      <span>
        <Trans>
          Reposted by{' '}
          <Link to={`/at://${reason.by.did}/app.bsky.actor.profile/self`}>
            {handle}
          </Link>
        </Trans>
      </span>
    </div>
  );
}

function normalizeItem(item: TimelineFeedItem | string): TimelineFeedItem {
  return normalizeTimelineFeedItem(item);
}

function itemKey(item: TimelineFeedItem | string): string {
  const normalized = normalizeItem(item);
  let reason = 'post';
  if (normalized.reason && isReasonRepost(normalized.reason)) {
    const repost = normalized.reason as AppBskyFeedDefs.ReasonRepost;
    reason = `repost:${repost.by.did}:${repost.indexedAt}`;
  }
  return `${normalized.uri}:${reason}`;
}

function shouldLetStatusLinkTargetHandleEvent(
  target: EventTarget | null,
  currentTarget: Element,
): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'a, button, input, textarea, select, summary, [role="button"], [data-menu-trigger]',
  );
  return !!interactive && interactive !== currentTarget;
}

function FeedStatusLink({
  uri,
  label,
  children,
}: {
  uri: string;
  label: string;
  children: ReactNode;
}) {
  const href = canonicalizeAppPath(`/${uri}`);
  const currentLocationKey = `${window.location.pathname}${window.location.search}`;
  const saveFeedScroll = () => {
    const listPage = document.querySelector<HTMLElement>('#list-page');
    const listPageScrollTop = listPage?.scrollTop;
    if (listPage && listPageScrollTop !== undefined) {
      const timelineList =
        listPage.querySelector<HTMLElement>('.timeline-list');
      if (timelineList) {
        timelineList.style.minHeight = `${listPageScrollTop + listPage.clientHeight + 800}px`;
      }
      rememberFeedScroll(currentLocationKey, listPageScrollTop);
    }
    return { listPage, listPageScrollTop };
  };
  const navigateFromCurrentLocation = () => {
    const { listPage, listPageScrollTop } = saveFeedScroll();
    states.prevLocation = {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    };
    navigatePath(href);
    if (listPage && listPageScrollTop !== undefined) {
      let attempts = 0;
      const restoreScroll = () => {
        const currentListPage =
          document.querySelector<HTMLElement>('#list-page') ?? listPage;
        const timelineList =
          currentListPage.querySelector<HTMLElement>('.timeline-list');
        if (timelineList) {
          timelineList.style.minHeight = `${listPageScrollTop + currentListPage.clientHeight + 800}px`;
        }
        currentListPage.scrollTop = listPageScrollTop;
        attempts += 1;
        if (attempts < 20) requestAnimationFrame(restoreScroll);
      };
      requestAnimationFrame(restoreScroll);
    }
  };

  return (
    <div
      className="status-link"
      data-href={href}
      role="link"
      tabIndex={0}
      aria-label={label}
      onPointerDownCapture={() => {
        saveFeedScroll();
      }}
      onTouchStartCapture={() => {
        saveFeedScroll();
      }}
      onClickCapture={() => {
        saveFeedScroll();
      }}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if (shouldLetStatusLinkTargetHandleEvent(e.target, e.currentTarget)) {
          const nestedLink = (e.target as Element | null)?.closest?.('a');
          if (nestedLink?.getAttribute('href')?.includes('media-only=1')) {
            saveFeedScroll();
            states.prevLocation = {
              pathname: window.location.pathname,
              search: window.location.search,
              hash: window.location.hash,
            };
          }
          return;
        }
        e.preventDefault();
        navigateFromCurrentLocation();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        navigateFromCurrentLocation();
      }}
    >
      <a
        className="status-link-native"
        href={href}
        aria-hidden="true"
        tabIndex={-1}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          if (isModifiedClick(e)) return;
          e.preventDefault();
          navigateFromCurrentLocation();
        }}
      />
      {children}
    </div>
  );
}

function PostUriFeedItemView({ item }: { item: TimelineFeedItem }) {
  const { data: post } = usePost(item.uri);
  const replies = post?.replyCount ?? 0;
  const author = post?.author.handle || post?.author.did;
  const label = author ? `Open post by ${author}` : 'Open post';

  return (
    <li className="timeline-item">
      {item.reason && isReasonRepost(item.reason) ? (
        <RepostHeader reason={item.reason as AppBskyFeedDefs.ReasonRepost} />
      ) : null}
      <FeedStatusLink uri={item.uri} label={label}>
        {replies > 0 ? (
          <span className="file-input-hidden">
            {replies} {replies === 1 ? 'reply' : 'replies'}
          </span>
        ) : null}
        <PostByUri
          uri={item.uri}
          pinned={isReasonPin(item.reason)}
          showActionsBar
          showReplyParent
        />
      </FeedStatusLink>
    </li>
  );
}

function PostUriBoostCarousel({ items }: { items: TimelineFeedItem[] }) {
  const title = plural(items.length, {
    one: '# Repost',
    other: '# Reposts',
  });

  return (
    <li className="timeline-item-carousel">
      <StatusCarousel title={title} className="boosts-carousel">
        {items.map((item) => (
          <PostUriFeedItemView key={itemKey(item)} item={item} />
        ))}
      </StatusCarousel>
    </li>
  );
}

export default function PostUriFeed({
  source,
  title,
  titleComponent,
  path = '/',
  id = 'feed',
  headerStart,
  headerEnd,
  timelineStart,
  emptyText,
  errorText,
  filterContext,
  boostsCarousel = false,
}: PostUriFeedProps) {
  const { t } = useLingui();
  const { items, loadMore, hasMore, isLoadingMore, isLoading, error } = source;
  const pageRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () =>
      boostsCarousel
        ? groupBoostItems(items)
        : items.map(
            (item) => ({ type: 'item', item: normalizeItem(item) }) as const,
          ),
    [boostsCarousel, items],
  );

  useTitle(title || t`Home`, path);

  const onScroll = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    const remaining =
      document.documentElement.scrollHeight -
      window.scrollY -
      window.innerHeight;
    if (remaining < 800) {
      loadMore();
    }
  }, [hasMore, isLoadingMore, loadMore]);

  const onContainerScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const locationKey = `${window.location.pathname}${window.location.search}`;
      rememberFeedScroll(locationKey, element.scrollTop);
      if (!hasMore || isLoadingMore) return;
      const remaining =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining < 800) {
        loadMore();
      }
    },
    [hasMore, isLoadingMore, loadMore],
  );

  useEffect(() => {
    const element = pageRef.current;
    if (!element || !hasMore || isLoading || isLoadingMore) return;
    const remaining =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 800) {
      loadMore();
    }
  }, [hasMore, isLoading, isLoadingMore, items.length, loadMore]);

  useEffect(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [onScroll]);

  const scrollRestoreKey = getPathScrollKey(path);
  useEffect(() => {
    restoreFeedScroll(getFeedScrollRestoreValue(path));
    const restoreAfterRouteChange = () => {
      const nextLocationKey = getCurrentLocationKey();
      restoreFeedScroll(getSavedFeedScroll(nextLocationKey));
    };
    window.addEventListener('popstate', restoreAfterRouteChange);
    return () => {
      window.removeEventListener('popstate', restoreAfterRouteChange);
    };
  }, [path, scrollRestoreKey]);

  const content = (
    <div
      ref={pageRef}
      id={`${id}-page`}
      className="timeline-page deck-container"
      data-timeline-id={id}
      tabIndex={-1}
      onScroll={onContainerScroll}
    >
      <div className="timeline-deck deck">
        <header className="timeline-header">
          <div className="header-grid">
            <div className="header-side">
              <NavMenu />
              {headerStart === false ? null : (headerStart ?? (
                <Link to="/" className="button plain home-button">
                  <Icon icon="home" size="l" alt={t`Home`} />
                </Link>
              ))}
            </div>
            {titleComponent ?? <h1>{title || t`Home`}</h1>}
            <div className="header-side">{headerEnd}</div>
          </div>
        </header>
        {timelineStart}
        {error ? (
          <p className="error-message">{errorText || error.message}</p>
        ) : isLoading && items.length === 0 ? (
          <Loader />
        ) : items.length === 0 ? (
          <p className="timeline-empty">
            {emptyText || t`Nothing to see here.`}
          </p>
        ) : (
          <ul className="timeline timeline-list">
            {rows.map((row) =>
              row.type === 'boosts' ? (
                <PostUriBoostCarousel
                  key={`boosts:${row.items[0]?.uri}`}
                  items={row.items}
                />
              ) : (
                <PostUriFeedItemView key={itemKey(row.item)} item={row.item} />
              ),
            )}
          </ul>
        )}
        {isLoadingMore ? <Loader /> : null}
        {!hasMore && items.length > 0 ? (
          <p className="timeline-end">
            <Trans>That&apos;s all for now.</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );

  return (
    <FilterContext.Provider value={filterContext}>
      {content}
    </FilterContext.Provider>
  );
}

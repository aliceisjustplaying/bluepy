import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type {
  ComponentChildren,
  ComponentType,
  RefObject,
  TargetedMouseEvent,
  VNode,
} from 'preact';
import { memo } from 'preact/compat';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { useDebouncedCallback } from 'use-debounce';
import { useSnapshot } from 'valtio';

import FilterContext from '../utils/filter-context';
import { filteredItems, isFiltered } from '../utils/filters';
import isRTL from '../utils/is-rtl';
import showToast from '../utils/show-toast';
import states, { statusKey } from '../utils/states';
import statusPeek from '../utils/status-peek';
import { isMediaFirstInstance } from '../utils/store-utils';
import {
  filterHiddenStatuses,
  groupBoosts,
  groupContext,
} from '../utils/timeline-utils';
import useInterval from '../utils/useInterval';
import usePageVisibility from '../utils/usePageVisibility';
import useScrollFn from '../utils/useScrollFn';

import Icon from './icon';
import Link from './link';
import MediaPost from './media-post';
import NavMenu from './nav-menu';
import StatusRaw from './status';
import ThreadBadge from './thread-badge';

// `status.jsx` is still JS; shim the prop surface used in this file. The
// runtime component accepts many more props than this; we only declare the
// ones the timeline reaches for.
interface StatusComponentProps {
  status?: TimelineEntry | null;
  statusID?: string | null;
  instance?: string;
  size?: 's' | 'm' | 'l';
  skeleton?: boolean;
  mediaFirst?: boolean;
  contentTextWeight?: boolean;
  enableCommentHint?: boolean;
  showFollowedTags?: boolean;
  showReplyParent?: boolean;
}
const Status = StatusRaw as unknown as ComponentType<StatusComponentProps>;

// `react-intersection-observer`'s `InView` ships without working JSX
// component typings under our preact compat resolution. Re-type as a
// preact component with the props this file actually uses.
const InView = InViewUntyped as unknown as ComponentType<{
  root?: Element | null;
  rootMargin?: string;
  class?: string;
  onChange?: (inView: boolean) => void;
  children?: ComponentChildren;
}>;

// Mirrors the timeline entry union: either a flat status (augmented with the
// timeline-pipeline mutation flags) or a group wrapper with nested items.
type TimelineStatusEntry = mastodon.v1.Status & {
  _pinned?: unknown;
  _differentAuthor?: boolean;
};

type TimelineGroupType = 'boosts' | 'thread' | 'conversation' | 'pinned';

interface TimelineGroupEntry {
  id: string | string[];
  items: TimelineItemEntry[];
  type: TimelineGroupType;
  _pinned?: unknown;
}

// `filteredItems` post-processing may decorate an entry with a `_grouped`
// wrapper containing nested posts (created inline below).
interface TimelineFilteredGroup {
  _grouped: true;
  posts: TimelineItemEntry[];
  id?: string;
  filtered?: TimelineStatusEntry['filtered'];
}

type TimelineEntry = TimelineStatusEntry | TimelineGroupEntry;
type TimelineItemEntry =
  | TimelineStatusEntry
  | TimelineGroupEntry
  | TimelineFilteredGroup;

function hasItems(entry: TimelineEntry): entry is TimelineGroupEntry {
  return Array.isArray((entry as TimelineGroupEntry).items);
}

function isFilteredGroup(
  entry: TimelineItemEntry,
): entry is TimelineFilteredGroup {
  return (entry as TimelineFilteredGroup)._grouped ?? false;
}

const scrollIntoViewOptions: ScrollIntoViewOptions = {
  block: 'start',
  inline: 'center',
  behavior: 'instant',
};

interface TimelineCacheEntry {
  items: TimelineEntry[];
  showMore: boolean;
  scrollTop?: number;
  ts: number;
}

const timelineCache = new Map<string, TimelineCacheEntry>();
const TIMELINE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// paginationItemsSelector is for Timeline2
const paginationPrevSelector =
  '.timeline-pagination button[data-pagination-trigger="prev"]';
const paginationNextSelector =
  '.timeline-pagination button[data-pagination-trigger="next"]';
const itemsSelector = '.timeline-item, .timeline-item-alt';

type ScrollableRef = RefObject<HTMLDivElement | null>;

// Standalone hotkey hooks for timeline navigation
export function useJHotkeys(scrollableRef: ScrollableRef) {
  return useHotkeys<HTMLDivElement>(
    'j, shift+j',
    (e, handler) => {
      // Fix bug: shift+j is fired even when j is pressed due to useKey: true
      if (e.shiftKey !== handler.shift) return;

      // focus on next status after active item
      const activeItem = document.activeElement?.closest(
        itemsSelector,
      ) as HTMLElement | null;
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current?.querySelectorAll<HTMLElement>(itemsSelector) ||
          [],
      ).filter((item) => !!item.offsetHeight);
      if (
        activeItem &&
        activeItemRect &&
        scrollableRef.current &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let nextItem: HTMLElement | undefined = allItems[activeItemIndex + 1];
        if (handler.shift) {
          // get next status that's not .timeline-item-alt
          nextItem = allItems.find(
            (item, index) =>
              index > activeItemIndex &&
              !item.classList.contains('timeline-item-alt'),
          );
        }
        if (nextItem) {
          nextItem.focus();
          nextItem.scrollIntoView(scrollIntoViewOptions);
        } else {
          const nextPaginationButton =
            scrollableRef.current.querySelector<HTMLButtonElement>(
              paginationNextSelector,
            );
          if (nextPaginationButton) {
            nextPaginationButton.click();
          }
        }
      } else {
        // If active status is not in viewport, get the topmost status-link in viewport
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0; // 44 is the magic number for header height, not real
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e: KeyboardEvent) =>
        e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'j',
    },
  );
}

export function useKHotkeys(scrollableRef: ScrollableRef) {
  return useHotkeys<HTMLDivElement>(
    'k, shift+k',
    (e, handler) => {
      // Fix bug: shift+k is fired even when k is pressed due to useKey: true
      if (e.shiftKey !== handler.shift) return;

      const activeItem = document.activeElement?.closest(
        itemsSelector,
      ) as HTMLElement | null;
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current?.querySelectorAll<HTMLElement>(itemsSelector) ||
          [],
      ).filter((item) => !!item.offsetHeight);
      if (
        activeItem &&
        activeItemRect &&
        scrollableRef.current &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let prevItem: HTMLElement | undefined = allItems[activeItemIndex - 1];
        if (handler.shift) {
          // get prev status that's not .timeline-item-alt
          prevItem = allItems.findLast(
            (item, index) =>
              index < activeItemIndex &&
              !item.classList.contains('timeline-item-alt'),
          );
        }
        if (prevItem) {
          prevItem.focus();
          prevItem.scrollIntoView(scrollIntoViewOptions);
        } else {
          const prevPaginationButton =
            scrollableRef.current.querySelector<HTMLButtonElement>(
              paginationPrevSelector,
            );
          if (prevPaginationButton) {
            prevPaginationButton.click();
          }
        }
      } else {
        // If active status is not in viewport, get the topmost status-link in viewport
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0; // 44 is the magic number for header height, not real
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e: KeyboardEvent) =>
        e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'k',
    },
  );
}

export function useOHotkeys() {
  return useHotkeys<HTMLDivElement>(
    ['enter', 'o'],
    (e, handler) => {
      // open active status
      const activeItem = document.activeElement as HTMLElement | null;
      if (activeItem?.matches(itemsSelector)) {
        // find first media link and click it (not inside status-card)
        const isO = handler.keys?.join('') === 'o';
        if (isO) {
          const mediaLink = activeItem.querySelector<HTMLAnchorElement>(
            'a.media:not(.status-card a.media)',
          );
          if (mediaLink) {
            // if link is ?media-only=1, change to media=1 and go to it
            const url = mediaLink.getAttribute('href');
            if (url && /media-only=/i.test(url)) {
              const newURL = url.replace(/media-only=/i, 'media=');
              setTimeout(() => {
                // Need timeout to prevent propagate to the o key handler in pages/status.jsx
                location.hash = newURL;
              }, 100);
            } else {
              mediaLink.click();
            }
          } else {
            activeItem.click();
          }
        } else {
          activeItem.click();
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e: KeyboardEvent) => {
        // 'enter' doesn't need key validation (physical key, layout-independent)
        if (e.key === 'Enter') return false;
        return (
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey ||
          e.key.toLowerCase() !== 'o'
        );
      },
    },
  );
}

type UIState = 'start' | 'loading' | 'default' | 'error';

interface FetchItemsResult {
  done?: boolean;
  value?: unknown;
}

interface TimelineProps {
  title?: string;
  titleComponent?: ComponentChildren;
  id: string;
  timelineKey?: string;
  instance?: string;
  emptyText?: ComponentChildren;
  errorText?: string;
  useItemID?: boolean;
  boostsCarousel?: boolean;
  fetchItems?: (firstLoad?: boolean) => Promise<FetchItemsResult>;
  checkForUpdates?: () => Promise<boolean> | boolean | undefined;
  checkForUpdatesInterval?: number;
  headerStart?: ComponentChildren;
  headerEnd?: ComponentChildren;
  timelineStart?: ComponentChildren;
  refresh?: unknown;
  view?: string;
  filterContext?: string;
  showFollowedTags?: boolean;
  showReplyParent?: boolean;
  clearWhenRefresh?: boolean;
}

function Timeline({
  title,
  titleComponent,
  id,
  timelineKey,
  instance,
  emptyText,
  errorText,
  useItemID, // use statusID instead of status object, assuming it's already in states
  boostsCarousel,
  fetchItems = () => Promise.resolve({} as FetchItemsResult),
  checkForUpdates = () => undefined,
  checkForUpdatesInterval = 15_000, // 15 seconds
  headerStart,
  headerEnd,
  timelineStart,
  // allowFilters,
  refresh,
  view,
  filterContext,
  showFollowedTags,
  showReplyParent,
  clearWhenRefresh,
}: TimelineProps) {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);

  const cacheKey = timelineKey || id;
  const [cachedData] = useState<TimelineCacheEntry | null>(() => {
    const cached = timelineCache.get(cacheKey);
    return cached && Date.now() - cached.ts <= TIMELINE_CACHE_TTL
      ? cached
      : null;
  });

  const [items, setItems] = useState<TimelineEntry[]>(cachedData?.items || []);
  const [uiState, setUIState] = useState<UIState>(
    cachedData ? 'default' : 'start',
  );
  const [showMore, setShowMore] = useState<boolean>(
    cachedData?.showMore ?? false,
  );
  const [showNew, setShowNew] = useState(false);
  const [visible, setVisible] = useState(true);
  const scrollableRef = useRef<HTMLDivElement | null>(null);

  // Updated every render so the cleanup fn always sees the latest values
  const cachePayloadRef = useRef<{
    cacheKey: string;
    items: TimelineEntry[];
    showMore: boolean;
  } | null>(null);
  cachePayloadRef.current = { cacheKey, items, showMore };

  console.debug('RENDER Timeline', id, refresh);
  __BENCHMARK.start(`timeline-${id}-load`);

  const mediaFirst = useMemo(() => isMediaFirstInstance(), []);

  const allowGrouping = view !== 'media';
  const loadItemsTS = useRef(0); // Ensures only one loadItems at a time
  const loadItems = useDebouncedCallback(
    (firstLoad?: boolean) => {
      setShowNew(false);
      // if (uiState === 'loading') return;
      setUIState('loading');
      void (async () => {
        try {
          const ts = (loadItemsTS.current = Date.now());
          let { done, value } = await fetchItems(firstLoad);
          if (ts !== loadItemsTS.current) return;
          if (Array.isArray(value)) {
            const rawValue = value as TimelineStatusEntry[];
            // Avoid grouping for pinned posts
            const [pinnedPosts, otherPosts] = rawValue.reduce<
              [TimelineStatusEntry[], TimelineStatusEntry[]]
            >(
              (acc, item) => {
                if (item._pinned) {
                  acc[0].push(item);
                } else {
                  acc[1].push(item);
                }
                return acc;
              },
              [[], []],
            );
            let processed: TimelineEntry[] = otherPosts;
            processed = filterHiddenStatuses(
              processed as TimelineStatusEntry[],
              filterContext,
            ) as TimelineEntry[];
            if (allowGrouping) {
              if (boostsCarousel) {
                processed = groupBoosts(
                  processed as TimelineStatusEntry[],
                ) as TimelineEntry[];
              }
              // groupContext expects `instance: string`; the JS caller passed
              // through whatever value the prop held (including undefined).
              // Preserve that behavior with a non-null assertion shim.
              processed = groupContext(
                processed as TimelineStatusEntry[],
                instance!,
              ) as TimelineEntry[];
            }
            if (pinnedPosts.length) {
              processed = (pinnedPosts as TimelineEntry[]).concat(processed);
            }
            console.log(processed);
            if (firstLoad) {
              setItems(processed);
            } else {
              setItems((prev) => [...prev, ...processed]);
            }
            if (!processed.length) done = true;
            setShowMore(!done);
          } else {
            setShowMore(false);
          }
          setUIState('default');
          __BENCHMARK.end(`timeline-${id}-load`);
        } catch (e) {
          console.error(e);
          setUIState('error');
          if (firstLoad && !items.length && errorText) {
            showToast(errorText);
          }
        } finally {
          loadItems.cancel();
        }
      })();
    },
    1_000,
    {
      leading: true,
      // trailing: false,
    },
  );

  const jRef = useJHotkeys(scrollableRef);
  const kRef = useKHotkeys(scrollableRef);
  const oRef = useOHotkeys();

  const showNewPostsIndicator =
    items.length > 0 && uiState !== 'loading' && showNew;
  const handleLoadNewPosts = useCallback(() => {
    if (showNewPostsIndicator) loadItems(true);
    scrollableRef.current?.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, [loadItems, showNewPostsIndicator]);
  const dotRef = useHotkeys<HTMLDivElement>('.', handleLoadNewPosts, {
    useKey: true,
    ignoreEventWhen: (e: KeyboardEvent) => {
      // Allow '.' even with Shift (some keyboard layouts require Shift for '.')
      if (e.key === '.') return false;
      return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
    },
  });

  // const {
  //   scrollDirection,
  //   nearReachStart,
  //   nearReachEnd,
  //   reachStart,
  //   reachEnd,
  // } = useScroll({
  //   scrollableRef,
  //   distanceFromEnd: 2,
  //   scrollThresholdStart: 44,
  // });
  const headerRef = useRef<HTMLElement | null>(null);
  // const [hiddenUI, setHiddenUI] = useState(false);
  const [nearReachStart, setNearReachStart] = useState(false);
  interface ScrollFnArgs {
    scrollDirection: 'end' | 'start' | null;
    nearReachStart: boolean;
    reachStart: boolean;
  }
  const scrollFnCallback = useCallback(
    ({
      scrollDirection,
      nearReachStart: nearReachStartArg,
      reachStart,
    }: ScrollFnArgs) => {
      if (headerRef.current) {
        const hiddenUI = scrollDirection === 'end' && !nearReachStartArg;
        headerRef.current.hidden = hiddenUI;
      }
      setNearReachStart(nearReachStartArg);
      if (reachStart) {
        loadItems(true);
      }
    },
    [setNearReachStart, loadItems],
  );
  const scrollFn = useScrollFn(
    {
      scrollableRef: scrollableRef as RefObject<HTMLElement>,
      distanceFromEnd: 2,
      scrollThresholdStart: 44,
    },
    scrollFnCallback,
  );
  const resetScrollDirection = scrollFn?.resetScrollDirection;

  useEffect(() => {
    if (cachedData?.scrollTop && scrollableRef.current) {
      scrollableRef.current.scrollTop = cachedData.scrollTop;
    } else {
      scrollableRef.current?.scrollTo({ top: 0 });
    }
    if (!cachedData?.items?.length) loadItems(true);
    return () => {
      loadItems.cancel?.();
      if (!cachePayloadRef.current) return;
      const {
        cacheKey: cachedCacheKey,
        items: cachedItems,
        showMore: cachedShowMore,
      } = cachePayloadRef.current;
      if (cachedItems?.length) {
        timelineCache.set(cachedCacheKey, {
          items: cachedItems,
          showMore: cachedShowMore,
          scrollTop: scrollableRef.current?.scrollTop ?? 0,
          ts: Date.now(),
        });
      }
    };
    // TODO(oxlint:react-hooks/exhaustive-deps): mount-only effect to restore
    // cached scroll position and seed initial items. Adding `loadItems` or
    // `cachedData.*` would loop.
  }, []);
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    if (clearWhenRefresh && items?.length) {
      loadItems.cancel?.();
      setItems([]);
    }
    loadItems(true);
    // TODO(oxlint:react-hooks/exhaustive-deps): only reacts to refresh-trigger
    // changes; `loadItems` is recreated each render and `items.length` change
    // would refetch on every append.
  }, [clearWhenRefresh, refresh]);

  // useEffect(() => {
  //   if (reachStart) {
  //     loadItems(true);
  //   }
  // }, [reachStart]);

  // useEffect(() => {
  //   if (nearReachEnd || (reachEnd && showMore)) {
  //     loadItems();
  //   }
  // }, [nearReachEnd, showMore]);

  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current !== view) {
      prevView.current = view;
      setItems([]);
    }
  }, [view]);

  interface LoadOrCheckUpdatesParams {
    disableIdleCheck?: boolean;
  }
  const loadOrCheckUpdates = useCallback(
    async ({ disableIdleCheck = false }: LoadOrCheckUpdatesParams = {}) => {
      const noPointers = scrollableRef.current
        ? getComputedStyle(scrollableRef.current).pointerEvents === 'none'
        : false;
      console.log('✨ Load or check updates', id, {
        autoRefresh: snapStates.settings.autoRefresh,
        scrollTop: scrollableRef.current?.scrollTop,
        disableIdleCheck,
        idle: window.__IDLE__,
        inBackground: inBackground(),
        noPointers,
      });
      if (
        snapStates.settings.autoRefresh &&
        scrollableRef.current &&
        scrollableRef.current.scrollTop < 16 &&
        (disableIdleCheck || window.__IDLE__) &&
        !inBackground() &&
        !noPointers
      ) {
        console.log('✨ Load updates', id, snapStates.settings.autoRefresh);
        loadItems(true);
      } else {
        console.log('✨ Check updates', id, snapStates.settings.autoRefresh);
        const hasUpdate = await checkForUpdates();
        if (hasUpdate) {
          console.log('✨ Has new updates', id);
          setShowNew(true);
        }
      }
    },
    [id, loadItems, checkForUpdates, snapStates.settings.autoRefresh],
  );

  const lastHiddenTime = useRef<number | undefined>(undefined);
  usePageVisibility(
    (isVisible) => {
      if (isVisible) {
        const timeDiff = Date.now() - (lastHiddenTime.current ?? 0);
        if (!lastHiddenTime.current || timeDiff > 1000 * 3) {
          // 3 seconds
          void loadOrCheckUpdates({
            disableIdleCheck: true,
          });
        }
      } else {
        lastHiddenTime.current = Date.now();
      }
      setVisible(isVisible);
    },
    [checkForUpdates, loadOrCheckUpdates, snapStates.settings.autoRefresh],
  );

  // checkForUpdates interval
  useInterval(
    () => {
      void loadOrCheckUpdates();
    },
    visible && !showNew
      ? checkForUpdatesInterval * (nearReachStart ? 1 : 2)
      : null,
  );

  // const hiddenUI = scrollDirection === 'end' && !nearReachStart;

  return (
    <FilterContext.Provider value={filterContext}>
      {/* TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
          the deck container click handler is a side-channel for unhiding the
          header when the user clicks a timeline item; it is not a primary
          control. Keyboard interaction on timeline items is handled by their
          own focusable controls. */}
      <div
        id={`${id}-page`}
        class={`deck-container ${
          mediaFirst ? 'deck-container-media-first' : ''
        }`}
        ref={(node) => {
          scrollableRef.current = node;
          jRef.current = node;
          kRef.current = node;
          oRef.current = node;
          dotRef.current = node;
        }}
        tabIndex={-1}
        onClick={(e: TargetedMouseEvent<HTMLDivElement>) => {
          // If click on timeline item, unhide header
          const target = e.target as Element | null;
          if (
            headerRef.current &&
            target?.closest('.timeline-item, .timeline-item-alt')
          ) {
            setTimeout(() => {
              if (headerRef.current) headerRef.current.hidden = false;
              resetScrollDirection?.();
            }, 250);
          }
        }}
      >
        <div class="timeline-deck deck">
          {/* TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
              click-to-scroll-to-top on the timeline header is a navigational
              convenience, not a primary control; keyboard equivalent is the
              standard Home key on the focusable timeline container. */}
          <header
            ref={headerRef}
            // hidden={hiddenUI}
            onClick={(e: TargetedMouseEvent<HTMLElement>) => {
              const target = e.target as Element | null;
              if (!target?.closest('a, button')) {
                scrollableRef.current?.scrollTo({
                  top: 0,
                  behavior: 'smooth',
                });
              }
            }}
            onDblClick={(e: TargetedMouseEvent<HTMLElement>) => {
              const target = e.target as Element | null;
              if (!target?.closest('a, button')) {
                loadItems(true);
              }
            }}
            class={uiState === 'loading' ? 'loading' : ''}
          >
            <div class="header-grid">
              <div class="header-side">
                <NavMenu />
                {headerStart !== null && headerStart !== undefined ? (
                  headerStart
                ) : (
                  <Link to="/" class="button plain home-button">
                    <Icon icon="home" size="l" alt={t`Home`} />
                  </Link>
                )}
              </div>
              {title && (titleComponent ? titleComponent : <h1>{title}</h1>)}
              <div class="header-side">
                {/* <Loader hidden={uiState !== 'loading'} /> */}
                {!!headerEnd && headerEnd}
              </div>
            </div>
            {showNewPostsIndicator && (
              <button
                class="updates-button shiny-pill"
                type="button"
                onClick={handleLoadNewPosts}
              >
                <Icon icon="arrow-up" /> <Trans>New posts</Trans>
              </button>
            )}
          </header>
          {!!timelineStart && (
            <div
              class={`timeline-start ${uiState === 'loading' ? 'loading' : ''}`}
            >
              {timelineStart}
            </div>
          )}
          {items.length ? (
            <>
              <ul class={`timeline ${view ? `timeline-${view}` : ''}`}>
                {items.map((status) => (
                  <TimelineItem
                    status={status}
                    instance={instance}
                    useItemID={useItemID}
                    // allowFilters={allowFilters}
                    filterContext={filterContext}
                    key={`${
                      Array.isArray(status.id) ? status.id.join(',') : status.id
                    }${String((status as TimelineStatusEntry)._pinned)}${view}`}
                    view={view}
                    showFollowedTags={showFollowedTags}
                    showReplyParent={showReplyParent}
                    mediaFirst={mediaFirst}
                  />
                ))}
                {showMore &&
                  uiState === 'loading' &&
                  (view === 'media' ? null : (
                    <>
                      <li
                        style={{
                          height: '20vh',
                        }}
                      >
                        <Status skeleton mediaFirst={mediaFirst} />
                      </li>
                      <li
                        style={{
                          height: '25vh',
                        }}
                      >
                        <Status skeleton mediaFirst={mediaFirst} />
                      </li>
                    </>
                  ))}
              </ul>
              {uiState === 'default' &&
                (showMore ? (
                  <InView
                    root={scrollableRef.current}
                    rootMargin={`0px 0px ${screen.height * 1.5}px 0px`}
                    onChange={(inView) => {
                      if (inView) {
                        loadItems();
                      }
                    }}
                  >
                    <button
                      type="button"
                      class="plain block"
                      onClick={() => loadItems()}
                      style={{ marginBlockEnd: '6em' }}
                    >
                      <Trans>Show more…</Trans>
                    </button>
                  </InView>
                ) : (
                  <p class="ui-state insignificant">
                    <Trans>The end.</Trans>
                  </p>
                ))}
            </>
          ) : uiState === 'loading' ? (
            <ul class="timeline">
              {Array.from({ length: 5 }).map((_, i) =>
                view === 'media' ? (
                  <div
                    key={i}
                    style={{
                      height: '50vh',
                    }}
                  />
                ) : (
                  <li key={i}>
                    <Status skeleton mediaFirst={mediaFirst} />
                  </li>
                ),
              )}
            </ul>
          ) : (
            uiState !== 'error' &&
            uiState !== 'start' && <p class="ui-state">{emptyText}</p>
          )}
          {uiState === 'error' && (
            <p class="ui-state">
              {errorText}
              <br />
              <br />
              <button type="button" onClick={() => loadItems(!items.length)}>
                <Trans>Try again</Trans>
              </button>
            </p>
          )}
        </div>
      </div>
    </FilterContext.Provider>
  );
}

interface TimelineItemProps {
  status: TimelineEntry;
  instance?: string;
  useItemID?: boolean;
  filterContext?: string;
  view?: string;
  showFollowedTags?: boolean;
  showReplyParent?: boolean;
  mediaFirst?: boolean;
}

export const TimelineItem = memo(
  ({
    status,
    instance,
    useItemID,
    // allowFilters,
    filterContext,
    view,
    showFollowedTags,
    showReplyParent,
    mediaFirst,
  }: TimelineItemProps): VNode | VNode[] | null => {
    const { t } = useLingui();
    console.debug(
      'RENDER TimelineItem',
      Array.isArray(status.id) ? status.id.join(',') : status.id,
    );
    const groupView = hasItems(status);
    const statusID = (status as TimelineStatusEntry).id;
    const reblog = (status as TimelineStatusEntry).reblog;
    const _pinned = status._pinned;
    if (_pinned) useItemID = false;
    const actualStatusID = reblog?.id || statusID;
    const url = instance
      ? `/${instance}/s/${actualStatusID}`
      : `/s/${actualStatusID}`;

    if (groupView) {
      const groupEntry = status;
      const type = groupEntry.type;
      let fItems = filteredItems(
        groupEntry.items as readonly TimelineStatusEntry[],
        filterContext,
      ) as TimelineItemEntry[];
      let title: string | VNode = '';
      if (type === 'boosts') {
        title = plural(fItems.length, {
          one: '# Boost',
          other: '# Boosts',
        });
      } else if (type === 'pinned') {
        title = t`Pinned posts`;
      }
      const isCarousel = type === 'boosts' || type === 'pinned';
      if (isCarousel) {
        const filteredItemsIDs = new Set<string>();
        // Here, we don't hide filtered posts, but we sort them last
        (fItems as TimelineStatusEntry[]).sort((a, b) => {
          // if (a._filtered && !b._filtered) {
          //   return 1;
          // }
          // if (!a._filtered && b._filtered) {
          //   return -1;
          // }
          const aFiltered = isFiltered(a.filtered, filterContext as string);
          const bFiltered = isFiltered(b.filtered, filterContext as string);
          if (aFiltered && aFiltered?.action !== 'blur') {
            filteredItemsIDs.add(a.id);
          }
          if (bFiltered && bFiltered?.action !== 'blur') {
            filteredItemsIDs.add(b.id);
          }
          if (aFiltered && !bFiltered) {
            return 1;
          }
          if (!aFiltered && bFiltered) {
            return -1;
          }
          return 0;
        });

        if (filteredItemsIDs.size >= 2) {
          const GROUP_SIZE = 5;
          // If 2 or more, group filtered items into one, limit to GROUP_SIZE in a group
          const unfiltered: TimelineStatusEntry[] = [];
          const filtered: TimelineStatusEntry[] = [];
          (fItems as TimelineStatusEntry[]).forEach((item) => {
            if (filteredItemsIDs.has(item.id)) {
              filtered.push(item);
            } else {
              unfiltered.push(item);
            }
          });
          const filteredGrouped: TimelineFilteredGroup[] = [];
          for (let i = 0; i < filtered.length; i += GROUP_SIZE) {
            filteredGrouped.push({
              _grouped: true,
              posts: filtered.slice(i, i + GROUP_SIZE),
            });
          }
          fItems = (unfiltered as TimelineItemEntry[]).concat(filteredGrouped);
        }

        return (
          <li key={`timeline-${statusID}`} class="timeline-item-carousel">
            <StatusCarousel title={title} class={`${type}-carousel`}>
              {fItems.map((item) => {
                if (isFilteredGroup(item)) {
                  const grouped = item;
                  const firstPost = grouped.posts[0] as
                    | TimelineStatusEntry
                    | undefined;
                  return (
                    <li
                      key={firstPost?.id}
                      class="timeline-item-carousel-group"
                    >
                      {grouped.posts.map((inner) => {
                        const innerStatus = inner as TimelineStatusEntry;
                        const innerID = innerStatus.id;
                        const innerReblog = innerStatus.reblog;
                        const innerPinned = innerStatus._pinned;
                        const innerActualID = innerReblog?.id || innerID;
                        const innerURL = instance
                          ? `/${instance}/s/${innerActualID}`
                          : `/s/${innerActualID}`;
                        if (innerPinned) useItemID = false;
                        return (
                          <Link
                            key={innerID}
                            class="status-carousel-link timeline-item-alt"
                            to={innerURL}
                          >
                            {useItemID ? (
                              <Status
                                statusID={innerID}
                                instance={instance}
                                size="s"
                              />
                            ) : (
                              <Status
                                status={innerStatus}
                                instance={instance}
                                size="s"
                              />
                            )}
                          </Link>
                        );
                      })}
                    </li>
                  );
                }

                const itemStatus = item as TimelineStatusEntry;
                const itemID = itemStatus.id;
                const itemReblog = itemStatus.reblog;
                const itemPinned = itemStatus._pinned;
                const itemActualID = itemReblog?.id || itemID;
                const itemURL = instance
                  ? `/${instance}/s/${itemActualID}`
                  : `/s/${itemActualID}`;
                if (itemPinned) useItemID = false;
                return (
                  <li key={itemID}>
                    <Link
                      class="status-carousel-link timeline-item-alt"
                      to={itemURL}
                    >
                      {useItemID ? (
                        <Status
                          statusID={itemID}
                          instance={instance}
                          size="s"
                          contentTextWeight
                          enableCommentHint
                          // allowFilters={allowFilters}
                          mediaFirst={mediaFirst}
                        />
                      ) : (
                        <Status
                          status={itemStatus}
                          instance={instance}
                          size="s"
                          contentTextWeight
                          enableCommentHint
                          // allowFilters={allowFilters}
                          mediaFirst={mediaFirst}
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </StatusCarousel>
          </li>
        );
      }
      const manyItems = fItems.length > 3;
      return (fItems as TimelineStatusEntry[]).map((item, i, arr) => {
        const itemStatusID = item.id;
        const _differentAuthor = item._differentAuthor;
        const itemURL = instance
          ? `/${instance}/s/${itemStatusID}`
          : `/s/${itemStatusID}`;
        const isMiddle = i > 0 && i < arr.length - 1;
        const isSpoiler = item.sensitive && !!item.spoilerText;
        const showCompact =
          (!_differentAuthor && isSpoiler && i > 0) ||
          (manyItems &&
            isMiddle &&
            (type === 'thread' ||
              (type === 'conversation' &&
                !_differentAuthor &&
                !arr[i - 1]._differentAuthor &&
                !arr[i + 1]._differentAuthor)));
        const isStart = i === 0;
        const isEnd = i === arr.length - 1;
        return (
          <li
            key={`timeline-${itemStatusID}`}
            class={`timeline-item-container timeline-item-container-type-${type} timeline-item-container-${
              isStart ? 'start' : isEnd ? 'end' : 'middle'
            } ${_differentAuthor ? 'timeline-item-diff-author' : ''}`}
          >
            <Link class="status-link timeline-item" to={itemURL}>
              {showCompact ? (
                <TimelineStatusCompact
                  status={item}
                  instance={instance}
                  filterContext={filterContext}
                />
              ) : useItemID ? (
                <Status
                  statusID={itemStatusID}
                  instance={instance}
                  enableCommentHint={isEnd}
                  showFollowedTags={showFollowedTags}
                  // allowFilters={allowFilters}
                />
              ) : (
                <Status
                  status={item}
                  instance={instance}
                  enableCommentHint={isEnd}
                  showFollowedTags={showFollowedTags}
                  // allowFilters={allowFilters}
                />
              )}
            </Link>
          </li>
        );
      });
    }

    const itemKey = `timeline-${statusID}${String(_pinned)}`;

    if (view === 'media') {
      return useItemID ? (
        <MediaPost
          class="timeline-item"
          parent="li"
          key={itemKey}
          statusID={statusID}
          instance={instance}
          // allowFilters={allowFilters}
        />
      ) : (
        <MediaPost
          class="timeline-item"
          parent="li"
          key={itemKey}
          status={
            status as unknown as Parameters<typeof MediaPost>[0]['status']
          }
          instance={instance}
          // allowFilters={allowFilters}
        />
      );
    }

    return (
      <li key={itemKey}>
        <Link class="status-link timeline-item" to={url}>
          {useItemID ? (
            <Status
              statusID={statusID}
              instance={instance}
              enableCommentHint
              showFollowedTags={showFollowedTags}
              showReplyParent={showReplyParent}
              // allowFilters={allowFilters}
              mediaFirst={mediaFirst}
            />
          ) : (
            <Status
              status={status}
              instance={instance}
              enableCommentHint
              showFollowedTags={showFollowedTags}
              showReplyParent={showReplyParent}
              // allowFilters={allowFilters}
              mediaFirst={mediaFirst}
            />
          )}
        </Link>
      </li>
    );
  },
  (oldProps, newProps) => {
    const oldID =
      (oldProps.status as TimelineStatusEntry | undefined)?.id || '';
    const newID =
      (newProps.status as TimelineStatusEntry | undefined)?.id || '';
    return (
      oldID === newID &&
      oldProps.instance === newProps.instance &&
      oldProps.view === newProps.view
    );
  },
);

interface StatusCarouselProps {
  title: string | VNode;
  class: string;
  children: ComponentChildren;
}

function StatusCarousel({
  title,
  class: className,
  children,
}: StatusCarouselProps) {
  const { t } = useLingui();
  const carouselRef = useRef<HTMLUListElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);
  const endButtonRef = useRef<HTMLButtonElement | null>(null);

  const [render, setRender] = useState(false);
  useEffect(() => {
    setTimeout(() => {
      setRender(true);
    }, 1);
  }, []);

  // `children` is the `.map(...)` array produced by TimelineItem above; the
  // JS original indexes into it directly. Preserve that shape exactly.
  const childrenArray = children as ComponentChildren[];

  return (
    <div class={`status-carousel ${className}`}>
      <header>
        <h3>{title}</h3>
        <span>
          <button
            ref={startButtonRef}
            type="button"
            class="small plain2"
            // disabled={reachStart}
            onClick={() => {
              const left =
                Math.min(320, carouselRef.current?.offsetWidth ?? 0) *
                (isRTL() ? 1 : -1);
              carouselRef.current?.scrollBy({
                left,
                behavior: 'smooth',
              });
            }}
          >
            <Icon icon="chevron-left" alt={t`Previous`} />
          </button>{' '}
          <button
            ref={endButtonRef}
            type="button"
            class="small plain2"
            // disabled={reachEnd}
            onClick={() => {
              const left =
                Math.min(320, carouselRef.current?.offsetWidth ?? 0) *
                (isRTL() ? -1 : 1);
              carouselRef.current?.scrollBy({
                left,
                behavior: 'smooth',
              });
            }}
          >
            <Icon icon="chevron-right" alt={t`Next`} />
          </button>
        </span>
      </header>
      <ul ref={carouselRef}>
        <InView
          class="status-carousel-beacon"
          onChange={(inView) => {
            if (startButtonRef.current)
              startButtonRef.current.disabled = inView;
          }}
        />
        {childrenArray[0]}
        {render && childrenArray.slice(1)}
        <InView
          class="status-carousel-beacon"
          onChange={(inView) => {
            if (endButtonRef.current) endButtonRef.current.disabled = inView;
          }}
        />
      </ul>
    </div>
  );
}

interface TimelineStatusCompactProps {
  status: TimelineStatusEntry;
  instance?: string;
  filterContext?: string;
}

export function TimelineStatusCompact({
  status,
  instance,
  filterContext,
}: TimelineStatusCompactProps) {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const { id, visibility, language } = status;
  const statusPeekText = statusPeek(
    status as unknown as Parameters<typeof statusPeek>[0],
  );
  const sKey = statusKey(id, instance);
  const filterInfo = isFiltered(status.filtered, filterContext as string);
  return (
    <article
      class={`status compact-thread ${
        visibility === 'direct' ? 'visibility-direct' : ''
      }`}
      tabindex={-1}
    >
      <div class="status-thread-badge-container">
        <ThreadBadge
          index={sKey ? snapStates.statusThreadNumber[sKey] : undefined}
        />
      </div>
      <div
        class="content-compact"
        title={statusPeekText}
        lang={language ?? undefined}
        dir="auto"
      >
        {!!filterInfo && filterInfo?.action !== 'blur' ? (
          <b
            class="status-filtered-badge badge-meta horizontal"
            title={
              ('titlesStr' in filterInfo ? filterInfo.titlesStr : '') || ''
            }
          >
            {'titlesStr' in filterInfo && filterInfo.titlesStr ? (
              <Trans>
                <span>Filtered</span>: <span>{filterInfo.titlesStr}</span>
              </Trans>
            ) : (
              <span>
                <Trans>Filtered</Trans>
              </span>
            )}
          </b>
        ) : (
          <>
            {statusPeekText}
            {status.sensitive && status.spoilerText && (
              <>
                {' '}
                <span class="spoiler-badge">
                  <Icon icon="eye-close" size="s" alt={t`Content warning`} />
                </span>
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function inBackground(): boolean {
  return !!document.querySelector('.deck-backdrop, #modal-container > *');
}

export default Timeline;

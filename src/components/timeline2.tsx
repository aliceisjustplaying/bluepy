import './timeline2.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type {
  ComponentChildren,
  ComponentType,
  RefObject,
  TargetedMouseEvent,
} from 'preact';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'preact/hooks';
import { useDebouncedCallback, useThrottledCallback } from 'use-debounce';

import { api } from '../utils/api';
import FilterContext from '../utils/filter-context';
import states, { saveStatus, statusKey } from '../utils/states';
import store from '../utils/store';
import {
  dedupeBoosts,
  filterHiddenStatuses,
  groupContext,
} from '../utils/timeline-utils';
import useInterval from '../utils/useInterval';
import usePageVisibility from '../utils/usePageVisibility';
import useScrollFn from '../utils/useScrollFn';

import Icon from './icon';
import Link from './link';
import Loader from './loader';
import NavMenu from './nav-menu';
import Status from './status';
import {
  TimelineItem,
  useJHotkeys,
  useKHotkeys,
  useOHotkeys,
} from './timeline';

// `timeline.jsx` is still JS; cast to ComponentType so we can pass typed props.
interface TimelineItemProps {
  status: TimelineEntry;
  instance?: string;
  useItemID?: boolean;
  filterContext?: string;
  showFollowedTags?: boolean;
  showReplyParent?: boolean;
}
const TimelineItemTyped =
  TimelineItem as unknown as ComponentType<TimelineItemProps>;

// `status.jsx` is still JS; we only use the skeleton variant here.
const StatusTyped = Status as unknown as ComponentType<{ skeleton?: boolean }>;

// `icon.jsx` is still JS; minimal prop shape covers all usages in this file.
interface IconProps {
  icon: string;
  size?: string;
  alt?: string;
}
const IconTyped = Icon as unknown as ComponentType<IconProps>;

// `loader.jsx` is still JS.
const LoaderTyped = Loader as unknown as ComponentType<{ abrupt?: boolean }>;

// `link.jsx` is still JS; we only need `to`, `class`, and children.
interface LinkProps {
  to: string;
  class?: string;
  children?: ComponentChildren;
}
const LinkTyped = Link as unknown as ComponentType<LinkProps>;

// `nav-menu.jsx` is still JS; takes no props in this usage.
const NavMenuTyped = NavMenu as unknown as ComponentType<Record<string, never>>;

// Batch size (Mastodon API limit is around 20-40)
const BATCH_SIZE = 20;
const TIMELINE_LIMIT = 50;
const CACHE_AGE = 1000 * 60 * 15; // 15 minutes

// Mirrors the `TimelineItem` union in `timeline-utils.ts`: either a flat
// status augmented with mutation flags, or a grouping wrapper that carries
// nested statuses under `items`.
type TimelineStatusEntry = mastodon.v1.Status & {
  _pinned?: unknown;
  _differentAuthor?: boolean;
};

interface TimelineGroupEntry {
  id: string | string[];
  items: TimelineStatusEntry[];
  type: 'boosts' | 'thread' | 'conversation' | 'pinned';
}

type TimelineEntry = TimelineStatusEntry | TimelineGroupEntry;

function isGroupEntry(entry: TimelineEntry): entry is TimelineGroupEntry {
  return (
    Array.isArray((entry as TimelineGroupEntry).items) &&
    (entry as TimelineGroupEntry).items !== undefined
  );
}

function getLastItem(items: readonly TimelineEntry[]): TimelineStatusEntry {
  const item = items[items.length - 1];
  if (isGroupEntry(item)) {
    return item.items[item.items.length - 1];
  }
  return item;
}

function getFirstItem(items: readonly TimelineEntry[]): TimelineStatusEntry {
  const item = items[0];
  if (isGroupEntry(item)) {
    return item.items[0];
  }
  return item;
}

interface ScrollAnchor {
  itemId: string[];
  offset: number;
  direction?: 'next' | 'prev';
}

function getScrollAnchor(scrollable: HTMLElement | null): ScrollAnchor | null {
  if (!scrollable) return null;

  const containerRect = scrollable.getBoundingClientRect();
  const itemElements = scrollable.querySelectorAll<HTMLElement>(
    '[data-state-post-id]',
  );

  for (const el of itemElements) {
    const rect = el.getBoundingClientRect();
    // Check if item is visible in viewport (at least partially)
    if (
      rect.bottom > containerRect.top + 10 &&
      rect.top < containerRect.bottom - 10
    ) {
      const postID = el.dataset.statePostId?.split?.(' ');
      if (postID) {
        return {
          itemId: postID,
          offset: rect.top - containerRect.top,
        };
      }
    }
  }
  return null;
}

interface FetchItemsResult {
  done?: boolean;
  value?: TimelineStatusEntry[];
  originalValue: TimelineStatusEntry[];
}

interface FetchItemsParams {
  max_id?: string;
  min_id?: string;
}

interface CheckForUpdatesParams {
  minID?: string | null;
}

interface CachedTimelineData {
  items?: TimelineEntry[];
  minID?: string | null;
  maxID?: string | null;
  showNewer?: boolean;
  showOlder?: boolean;
  scrollAnchor?: ScrollAnchor | null;
  updatedAt?: number;
}

type LoadState = 'start' | 'next' | 'prev' | null;
type UIState = 'start' | 'loading' | 'default' | 'error';

interface Timeline2Props {
  title?: string;
  titleComponent?: ComponentChildren;
  id: string;
  instance?: string;
  emptyText?: ComponentChildren;
  errorText?: ComponentChildren;
  useItemID?: boolean;
  fetchItems?: (params?: FetchItemsParams) => Promise<FetchItemsResult>;
  checkForUpdates?: (params: CheckForUpdatesParams) => Promise<boolean>;
  checkForUpdatesInterval?: number;
  headerStart?: ComponentChildren;
  headerEnd?: ComponentChildren;
  timelineStart?: ComponentChildren;
  refresh?: unknown;
  filterContext?: string;
  showFollowedTags?: boolean;
  showReplyParent?: boolean;
  dedupeBoosts?: boolean;
  // clearWhenRefresh?: boolean;
}

function Timeline2({
  title,
  titleComponent,
  id,
  instance,
  emptyText,
  errorText,
  useItemID,
  // Match JS default: returns undefined, which then throws in destructuring
  // and falls into the error UI state. Preserving that behavior is the safest
  // surface change for this conversion.
  fetchItems = async () => undefined as unknown as FetchItemsResult,
  checkForUpdates = async () => false,
  checkForUpdatesInterval = 15_000,
  headerStart,
  headerEnd,
  timelineStart,
  refresh,
  filterContext,
  showFollowedTags,
  showReplyParent,
  dedupeBoosts: shouldDedupeBoosts,
  // clearWhenRefresh,
}: Timeline2Props) {
  const { t } = useLingui();
  const { masto } = api({ instance });

  const cacheKey = `timeline2-${id}`;
  const cachedData = useRef<CachedTimelineData | null>(null);
  if (cachedData.current === null) {
    cachedData.current =
      store.account.get<CachedTimelineData>(cacheKey) || null;
  }
  const hasCachedData = !!cachedData.current?.items?.length;
  const cachedUpdatedAt = cachedData.current?.updatedAt;
  const cacheAge = cachedUpdatedAt ? Date.now() - cachedUpdatedAt : 0;

  const loadStateRef = useRef<LoadState>(null);
  const [uiState, setUIState] = useState<UIState>(
    hasCachedData ? 'default' : 'start',
  );
  const [showNewer, setShowNewer] = useState(
    (cachedData.current?.showNewer ?? false) || cacheAge > CACHE_AGE,
  );
  const [showOlder, setShowOlder] = useState(
    cachedData.current?.showOlder ?? true,
  );
  const [visible, setVisible] = useState(true);
  const scrollableRef = useRef<HTMLDivElement | null>(null);

  const firstLoad = useRef(true);
  const [items, setItems] = useState<TimelineEntry[]>(() => {
    const cached = cachedData.current;
    console.log('🔍 Restore', {
      cached,
      itemsCount: cached?.items?.length,
    });
    const cachedItems = cached?.items;
    if (!cachedItems?.length) return [];
    // Populate statuses
    cachedItems.forEach((item) => {
      if (isGroupEntry(item)) {
        item.items.forEach((subItem) => {
          saveStatus(
            subItem as unknown as Parameters<typeof saveStatus>[0],
            instance,
            { sync: true },
          );
        });
      } else {
        saveStatus(
          item as unknown as Parameters<typeof saveStatus>[0],
          instance,
          { sync: true },
        );
      }
    });
    return cachedItems;
  });

  // Hydrate cached statuses on mount and when page becomes visible
  const hydrateCache = useCallback(() => {
    const cached = cachedData.current;
    if (!cached?.items?.length) return;
    const cachedAge = cached.updatedAt
      ? Date.now() - cached.updatedAt
      : Infinity;
    if (cachedAge <= CACHE_AGE) return;

    const statusIds: string[] = [];
    cached.items.forEach((item) => {
      if (isGroupEntry(item)) {
        item.items.forEach((subItem) => {
          if (subItem.id) statusIds.push(subItem.id);
        });
      } else if (item.id) {
        statusIds.push(item.id);
      }
    });

    if (statusIds.length === 0) return;

    const deletedStatuses: string[] = [];
    // The runtime `masto.v1.statuses` resource has a `list({ id })` batch
    // fetch that masto's TS types don't expose; mirror the same shim used in
    // timeline-utils.ts.
    interface MastoStatusesBatchList {
      list(params: { id: readonly string[] }): Promise<mastodon.v1.Status[]>;
    }
    const statusesResource = masto.v1.statuses as MastoStatusesBatchList;
    void (async () => {
      try {
        // Process in batches
        for (let i = 0; i < statusIds.length; i += BATCH_SIZE) {
          const batchIds = statusIds.slice(i, i + BATCH_SIZE);
          try {
            const hydratedStatuses = await statusesResource.list({
              id: batchIds,
            });
            const returnedIds = new Set(
              hydratedStatuses?.map((s) => s.id) || [],
            );
            // Track deleted statuses (not in returnedIds)
            batchIds.forEach((batchId) => {
              if (!returnedIds.has(batchId)) {
                deletedStatuses.push(batchId);
              }
            });
            if (hydratedStatuses?.length) {
              hydratedStatuses.forEach((status) => {
                saveStatus(
                  status as unknown as Parameters<typeof saveStatus>[0],
                  instance,
                  { sync: true },
                );
              });
            }
          } catch (e) {
            console.error('Failed to hydrate batch:', e);
          }
        }

        // Mark deleted statuses
        deletedStatuses.forEach((deletedId) => {
          const key = statusKey(deletedId, instance);
          if (key && states.statuses[key]) {
            states.statuses[key]._deleted = true;
          }
        });
        console.log('🔍 Hydrated', {
          statusIds,
          deletedStatuses,
        });
      } catch (e) {
        console.error('Failed to hydrate statuses:', e);
      }
    })();
  }, [instance, masto]);

  useEffect(() => {
    hydrateCache();
  }, [hydrateCache]);

  usePageVisibility(
    (isVisible) => {
      if (isVisible) hydrateCache();
    },
    [hydrateCache],
  );

  const scrollAnchorRef = useRef<ScrollAnchor | null>(
    cachedData.current?.scrollAnchor || null,
  );

  interface SaveScrollAnchorArgs {
    items: readonly TimelineEntry[];
    direction: 'next' | 'prev';
  }
  const saveScrollAnchor = useCallback(
    ({ items: anchorItems, direction }: SaveScrollAnchorArgs) => {
      console.log('🔍 saveScrollAnchor', {
        direction,
        items: anchorItems,
      });
      if (!anchorItems?.length) return;
      if (!scrollableRef.current) return;
      const getItem = direction === 'next' ? getLastItem : getFirstItem;
      const item = getItem(anchorItems);
      const postID = statusKey(item?.id, instance);
      if (!postID) return;
      const targetElement = scrollableRef.current.querySelector(
        `[data-state-post-id~="${postID}"]`,
      );
      console.log('🔍 saveScrollAnchor 2', {
        postID,
        targetElement,
        direction,
        items: anchorItems,
      });
      if (targetElement) {
        const containerRect = scrollableRef.current.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        scrollAnchorRef.current = {
          itemId: [postID],
          offset: targetRect.top - containerRect.top,
          direction,
        };
      } else {
        console.warn('🔍 Target element not found', {
          postID,
          targetElement,
          direction,
          items: anchorItems,
        });
      }
    },
    [instance],
  );

  console.debug('RENDER Timeline2', id, refresh);
  __BENCHMARK.start(`timeline-${id}-load`);

  const minID = useRef<string | null | undefined>(
    cachedData.current?.minID || null,
  );
  const maxID = useRef<string | null | undefined>(
    cachedData.current?.maxID || null,
  );

  const loadItems = useDebouncedCallback(
    (params: FetchItemsParams = {}) => {
      console.log('🔍 loadItems', { params });
      const { max_id, min_id } = params;
      const loadState: LoadState =
        !max_id && !min_id ? 'start' : max_id ? 'next' : min_id ? 'prev' : null;
      loadStateRef.current = loadState;
      setUIState('loading');
      void (async () => {
        try {
          const result = await fetchItems(params);

          let { value } = result;
          const { originalValue, done } = result;
          const hasOlder = !done;
          const minIDValue = originalValue[0]?.id;
          const maxIDValue = originalValue[originalValue.length - 1]?.id;
          console.log('🔍 loadItems result', result);

          if (value?.length) {
            if (shouldDedupeBoosts) {
              // dedupeBoosts requires `instance: string`; the JS caller passed
              // it through unconditionally. Preserve that exact behavior — an
              // undefined instance would have stringified into the cache key
              // there, and we mirror that with a non-null assertion rather
              // than silently skipping the dedupe step.
              value = dedupeBoosts(value, instance!);
            }
            value = filterHiddenStatuses(
              value,
              filterContext,
            ) as TimelineStatusEntry[];
            // groupContext expects `instance: string`; JS passed `undefined`
            // through when the prop was omitted (only reply-hint code paths
            // care, and they short-circuit on falsy keys). Preserve runtime
            // behavior via a non-null assertion.
            const grouped = groupContext(value, instance!) as TimelineEntry[];

            if (loadState === 'start') {
              minID.current = minIDValue;
              maxID.current = maxIDValue;
              setItems(grouped);
              setShowOlder(hasOlder);
              setShowNewer(false);
            } else if (loadState === 'next') {
              maxID.current = maxIDValue;
              scrollableRef.current?.classList.add('scrolling-next');
              setItems((prevItems) => {
                saveScrollAnchor({ items: prevItems, direction: 'next' });
                const newItems = [...prevItems, ...grouped].slice(
                  -TIMELINE_LIMIT,
                );
                minID.current = [newItems[0].id].flat()[0];
                return newItems;
              });
              setShowOlder(hasOlder);
              setShowNewer(true);
            } else if (loadState === 'prev') {
              minID.current = minIDValue;
              scrollableRef.current?.classList.add('scrolling-prev');
              setItems((prevItems) => {
                saveScrollAnchor({ items: prevItems, direction: 'prev' });
                const newItems = [...grouped, ...prevItems].slice(
                  0,
                  TIMELINE_LIMIT,
                );
                maxID.current = [newItems.at(-1)?.id].flat().at(-1);
                return newItems;
              });
              setShowOlder(true);
              // If prevItems > batch size, show newer
              setShowNewer(originalValue.length >= BATCH_SIZE);
            }
          } else {
            // No items
            if (max_id) {
              setShowOlder(false);
            }
            if (min_id) {
              setShowNewer(false);
            }
          }
          setUIState('default');
          __BENCHMARK.end(`timeline-${id}-load`);
        } catch (e) {
          console.error(e);
          setUIState('error');
        } finally {
          loadItems.cancel();
        }
      })();
    },
    300,
    { leading: true },
  );

  // `timeline.jsx` exports these hotkey hooks untyped; they return a ref-like
  // mutable container compatible with Preact's `RefObject<HTMLDivElement>`.
  interface HotkeyRef {
    current: HTMLDivElement | null;
  }
  const jRef = useJHotkeys(scrollableRef) as unknown as HotkeyRef;
  const kRef = useKHotkeys(scrollableRef) as unknown as HotkeyRef;
  const oRef = useOHotkeys() as unknown as HotkeyRef;

  const headerRef = useRef<HTMLElement | null>(null);

  // Cache items whenever they change
  useEffect(() => {
    if (firstLoad.current) return;
    if (items.length > 0) {
      console.log('🔍 Cache items', { items });
      const existing = store.account.get<CachedTimelineData>(cacheKey) || {};
      store.account.set(cacheKey, {
        ...existing,
        items,
        minID: minID.current,
        maxID: maxID.current,
        showNewer,
        showOlder,
        updatedAt: Date.now(),
      });
    } else {
      store.account.del(cacheKey);
    }
  }, [items, cacheKey, showNewer, showOlder]);

  // Throttled scroll handler to cache scroll position
  const cacheScrollAnchor = useThrottledCallback(() => {
    if (!scrollableRef.current || items.length === 0) return;

    const scrollAnchor = getScrollAnchor(scrollableRef.current);
    if (scrollAnchor) {
      const cached = store.account.get<CachedTimelineData>(cacheKey) || {};
      store.account.set(cacheKey, {
        ...cached,
        scrollAnchor,
      });
    }
  }, 500);

  interface ScrollFnArgs {
    scrollDirection: 'end' | 'start' | null;
    nearReachStart: boolean;
  }
  const scrollFnCallback = useCallback(
    ({ scrollDirection, nearReachStart }: ScrollFnArgs) => {
      if (headerRef.current) {
        console.log('🔍 scrollFnCallback', {
          scrollDirection,
          nearReachStart,
        });
        headerRef.current.hidden = scrollDirection === 'end' && !nearReachStart;
      }
      // Cache scroll position on scroll
      cacheScrollAnchor();
    },
    [cacheScrollAnchor],
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

  const checkUpdates = useCallback(async () => {
    if (!minID.current) return;
    const hasUpdates = await checkForUpdates({
      minID: minID.current,
    });
    setShowNewer(hasUpdates);
  }, [checkForUpdates]);

  // Restore from cache or load fresh items on mount
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      // If not restored from cache, load fresh items
      if (!cachedData.current?.items?.length) {
        loadItems();
      } else {
        // If from cache, check for updates
        checkUpdates().catch((err: unknown) => {
          console.error(err);
        });
      }
    }
  }, [loadItems, checkUpdates]);

  // useEffect(() => {
  //   if (firstLoad.current) return;
  //   if (clearWhenRefresh && items?.length) {
  //     loadItems.cancel?.();
  //     setItems([]);
  //   }
  //   loadItems();
  // }, [clearWhenRefresh, refresh]);

  const lastHiddenTime = useRef<number | undefined>(undefined);
  usePageVisibility(
    (isVisible) => {
      if (firstLoad.current) return;
      if (isVisible) {
        const timeDiff = Date.now() - (lastHiddenTime.current ?? 0);
        if (!lastHiddenTime.current || timeDiff > 1000 * 3) {
          checkUpdates().catch((err: unknown) => {
            console.error(err);
          });
        }
      } else {
        lastHiddenTime.current = Date.now();
      }
      setVisible(isVisible);
    },
    [checkUpdates],
  );

  useInterval(
    () => {
      checkUpdates().catch((err: unknown) => {
        console.error(err);
      });
    },
    visible && !showNewer ? checkForUpdatesInterval : null,
  );

  useLayoutEffect(() => {
    if (uiState !== 'default') return;
    console.log('🔍 Scroll', {
      scrollableRef: scrollableRef.current,
      scrollAnchorRef: scrollAnchorRef.current,
    });
    if (!scrollableRef.current || !scrollAnchorRef.current) return;

    // Clear the anchor immediately to prevent re-entrant executions
    const anchor = scrollAnchorRef.current;
    scrollAnchorRef.current = null;

    const { itemId, offset, direction } = anchor;
    const targetElement = scrollableRef.current.querySelector(
      `[data-state-post-id~="${String(itemId)}"]`,
    );
    console.log('🔍 Scroll to?', { itemId, offset, targetElement });

    if (targetElement) {
      const containerRect = scrollableRef.current.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const currentOffset = targetRect.top - containerRect.top;
      const delta = currentOffset - offset;
      console.log('Scrolling to', {
        itemId,
        offset,
        containerRect,
        targetRect,
        currentOffset,
        delta,
      });
      // Only scroll if the delta is meaningful to avoid triggering unnecessary scroll events
      if (Math.abs(delta) > 1) {
        scrollableRef.current.scrollTop += delta;
      }
      setTimeout(() => {
        if (direction) {
          scrollableRef.current?.classList.remove(`scrolling-${direction}`);
        }
      }, 300);
    } else {
      console.warn('Target element not found', {
        itemId,
        offset,
        targetElement,
      });
    }
  }, [items, uiState]);

  return (
    <FilterContext.Provider value={filterContext}>
      {/* TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
          deck container's click handler is a delegated "show header again"
          gesture triggered by clicking child timeline items, not a primary
          interactive surface. Keyboard users interact via the actual links
          and buttons inside. */}
      <div
        id={`${id}-page`}
        class="deck-container timeline-2-container"
        ref={(node) => {
          scrollableRef.current = node;
          jRef.current = node;
          kRef.current = node;
          oRef.current = node;
        }}
        tabIndex={-1}
        onClick={(e: TargetedMouseEvent<HTMLDivElement>) => {
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
              header click is a tap-to-scroll-to-top affordance for touch;
              keyboard users press Home. dblclick reloads. Real interactive
              children (links, buttons) own keyboard navigation. */}
          <header
            ref={headerRef}
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
                loadItems();
              }
            }}
            // class={uiState === 'loading' ? 'loading' : ''}
          >
            <div class="header-grid">
              <div class="header-side">
                <NavMenuTyped />
                {headerStart !== null && headerStart !== undefined ? (
                  headerStart
                ) : (
                  <LinkTyped to="/" class="button plain home-button">
                    <IconTyped icon="home" size="l" alt={t`Home`} />
                  </LinkTyped>
                )}
              </div>
              {title && (titleComponent ? titleComponent : <h1>{title}</h1>)}
              <div class="header-side">{!!headerEnd && headerEnd}</div>
            </div>
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
              {showNewer && (
                <div
                  class={`timeline-pagination timeline-pagination-top ${firstLoad.current ? '' : 'transitioning'}`}
                >
                  <button
                    type="button"
                    data-pagination-trigger="latest"
                    class={`plain4 ${uiState === 'loading' && loadStateRef.current === 'start' ? 'block' : ''}`}
                    onClick={() => {
                      // Load from top (latest)
                      loadItems();
                    }}
                    disabled={uiState === 'loading'}
                  >
                    {uiState === 'loading' &&
                    loadStateRef.current === 'start' ? (
                      <LoaderTyped abrupt />
                    ) : (
                      <IconTyped icon="arrow-up-top" size="l" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-pagination-trigger="prev"
                    class={`plain4 ${uiState === 'loading' && loadStateRef.current === 'start' ? '' : 'block'}`}
                    onClick={() => {
                      loadItems({ min_id: minID.current ?? undefined });
                    }}
                    disabled={uiState === 'loading'}
                  >
                    {uiState === 'loading' &&
                    loadStateRef.current === 'prev' ? (
                      <LoaderTyped abrupt />
                    ) : (
                      <IconTyped icon="arrow-up" size="l" />
                    )}
                  </button>
                </div>
              )}
              <ul class="timeline">
                {items.map((status) => (
                  <TimelineItemTyped
                    status={status}
                    instance={instance}
                    useItemID={useItemID}
                    filterContext={filterContext}
                    key={
                      Array.isArray(status.id) ? status.id.join(',') : status.id
                    }
                    showFollowedTags={showFollowedTags}
                    showReplyParent={showReplyParent}
                  />
                ))}
                {/* {uiState === 'loading' && (
                  <>
                    <li style={{ height: '20vh' }}>
                      <Status skeleton />
                    </li>
                    <li style={{ height: '25vh' }}>
                      <Status skeleton />
                    </li>
                  </>
                )} */}
              </ul>
              {showOlder ? (
                <div class="timeline-pagination timeline-pagination-bottom">
                  <button
                    type="button"
                    class="plain4 block"
                    data-pagination-trigger="next"
                    onClick={() => {
                      loadItems({ max_id: maxID.current ?? undefined });
                    }}
                    disabled={uiState === 'loading'}
                  >
                    {uiState === 'loading' ? (
                      <LoaderTyped abrupt />
                    ) : (
                      <IconTyped icon="arrow-down" size="l" />
                    )}
                  </button>
                </div>
              ) : uiState !== 'loading' ? (
                <p class="ui-state insignificant">
                  <Trans>The end.</Trans>
                </p>
              ) : null}
            </>
          ) : uiState === 'loading' ? (
            <ul class="timeline">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i}>
                  <StatusTyped skeleton />
                </li>
              ))}
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
              <button type="button" onClick={() => loadItems()}>
                <Trans>Try again</Trans>
              </button>
            </p>
          )}
        </div>
      </div>
    </FilterContext.Provider>
  );
}

export default Timeline2;

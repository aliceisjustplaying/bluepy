import './timeline2.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useDebouncedCallback, useThrottledCallback } from 'use-debounce';

import { api, getMastoV1Resource } from '../utils/api';
import FilterContext from '../utils/filter-context';
import states, { saveStatus, statusKey } from '../utils/states';
import store from '../utils/store';
import { dedupeTimelineContextItems } from '../utils/timeline-context';
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

interface SaveStatusInput {
  id?: string;
  account?: { id?: string } | null;
  reblog?: SaveStatusInput | null;
  quote?: SaveStatusInput | null;
  state?: unknown;
  quotedStatus?: SaveStatusInput | null;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  _pinned?: unknown;
}

interface SaveStatusPayload extends Record<string, unknown> {
  id?: string;
  account?: Record<string, unknown> & { id?: string };
  reblog?: SaveStatusPayload | null;
  quote?: SaveStatusPayload | null;
  state?: unknown;
  quotedStatus?: SaveStatusPayload | null;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  _pinned?: unknown;
}

function toSaveStatus(
  status: SaveStatusInput | null | undefined,
): SaveStatusPayload | null | undefined {
  if (!status) return status;
  return {
    ...status,
    account: status.account ? { ...status.account } : undefined,
    reblog: toSaveStatus(status.reblog),
    quote: toSaveStatus(status.quote),
    quotedStatus: toSaveStatus(status.quotedStatus),
  };
}

interface TimelineGroupEntry {
  id: string | string[];
  items: TimelineStatusEntry[];
  type: 'boosts' | 'thread' | 'conversation' | 'pinned';
  incompleteThread?: boolean;
}

type TimelineEntry = TimelineStatusEntry | TimelineGroupEntry;

function isGroupEntry(entry: TimelineEntry): entry is TimelineGroupEntry {
  return Array.isArray('items' in entry ? entry.items : undefined);
}

function isTimelineEntry(value: unknown): value is TimelineEntry {
  return !!value && typeof value === 'object' && 'id' in value;
}

function eventElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function dedupeTimelineEntries(items: readonly TimelineEntry[]) {
  return dedupeTimelineContextItems(items).filter(isTimelineEntry);
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
  titleComponent?: ReactNode;
  id: string;
  instance?: string;
  emptyText?: ReactNode;
  errorText?: ReactNode;
  useItemID?: boolean;
  fetchItems?: (
    params?: FetchItemsParams,
  ) => Promise<FetchItemsResult | undefined>;
  checkForUpdates?: (params: CheckForUpdatesParams) => Promise<boolean>;
  checkForUpdatesInterval?: number;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  timelineStart?: ReactNode;
  refresh?: unknown;
  filterContext?: string;
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
  // Match JS default: undefined still falls into the error UI state.
  fetchItems = async () => undefined,
  checkForUpdates = async () => false,
  checkForUpdatesInterval = 15_000,
  headerStart,
  headerEnd,
  timelineStart,
  refresh,
  filterContext,
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
  const [visible, setVisible] = useReducer(
    (_currentVisible: boolean, nextVisible: boolean) => nextVisible,
    true,
  );
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
          saveStatus(toSaveStatus(subItem), instance, { sync: true });
        });
      } else {
        saveStatus(toSaveStatus(item), instance, { sync: true });
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
    const statusesResource = getMastoV1Resource<MastoStatusesBatchList>(
      masto,
      'statuses',
    );
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
                saveStatus(toSaveStatus(status), instance, { sync: true });
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
          if (!result) {
            throw new TypeError('fetchItems returned undefined');
          }

          let { value } = result;
          const { originalValue, done } = result;
          const hasOlder = !done;
          const minIDValue = originalValue[0]?.id;
          const maxIDValue = originalValue[originalValue.length - 1]?.id;
          console.log('🔍 loadItems result', result);

          if (value?.length) {
            if (shouldDedupeBoosts) {
              value = dedupeBoosts(value, instance);
            }
            value = [...filterHiddenStatuses(value, filterContext)];
            const grouped = groupContext<TimelineStatusEntry, TimelineGroupEntry>(
              value,
              instance,
            );

            if (loadState === 'start') {
              minID.current = minIDValue;
              maxID.current = maxIDValue;
              setItems(dedupeTimelineEntries(grouped));
              setShowOlder(hasOlder);
              setShowNewer(false);
            } else if (loadState === 'next') {
              maxID.current = maxIDValue;
              scrollableRef.current?.classList.add('scrolling-next');
              setItems((prevItems) => {
                saveScrollAnchor({ items: prevItems, direction: 'next' });
                const newItems = dedupeTimelineEntries([
                  ...prevItems,
                  ...grouped,
                ]).slice(-TIMELINE_LIMIT);
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
                const newItems = dedupeTimelineEntries([
                  ...grouped,
                  ...prevItems,
                ]).slice(0, TIMELINE_LIMIT);
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

  const jRef = useJHotkeys(scrollableRef);
  const kRef = useKHotkeys(scrollableRef);
  const oRef = useOHotkeys();

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
      scrollableRef,
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
    if (uiState !== 'default') return undefined;
    console.log('🔍 Scroll', {
      scrollableRef: scrollableRef.current,
      scrollAnchorRef: scrollAnchorRef.current,
    });
    if (!scrollableRef.current || !scrollAnchorRef.current) return undefined;

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
      const timeoutId = window.setTimeout(() => {
        if (direction) {
          scrollableRef.current?.classList.remove(`scrolling-${direction}`);
        }
      }, 300);
      return () => {
        window.clearTimeout(timeoutId);
      };
    } else {
      console.warn('Target element not found', {
        itemId,
        offset,
        targetElement,
      });
    }
    return undefined;
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
        className="deck-container timeline-2-container"
        role="presentation"
        ref={(node) => {
          scrollableRef.current = node;
          jRef.current = node;
          kRef.current = node;
          oRef.current = node;
        }}
        tabIndex={-1}
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          const target = eventElement(e.target);
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
        <div className="timeline-deck deck">
          {/* TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
              header click is a tap-to-scroll-to-top affordance for touch;
              keyboard users press Home. dblclick reloads. Real interactive
              children (links, buttons) own keyboard navigation. */}
          <header
            ref={headerRef}
            role="presentation"
            onClick={(e: React.MouseEvent<HTMLElement>) => {
              const target = eventElement(e.target);
              if (!target?.closest('a, button')) {
                scrollableRef.current?.scrollTo({
                  top: 0,
                  behavior: 'smooth',
                });
              }
            }}
            onDoubleClick={(e: React.MouseEvent<HTMLElement>) => {
              const target = eventElement(e.target);
              if (!target?.closest('a, button')) {
                loadItems();
              }
            }}
            // className={uiState === 'loading' ? 'loading' : ''}
          >
            <div className="header-grid">
              <div className="header-side">
                <NavMenu />
                {headerStart !== null && headerStart !== undefined ? (
                  headerStart
                ) : (
                  <Link to="/" className="button plain home-button">
                    <Icon icon="home" size="l" alt={t`Home`} />
                  </Link>
                )}
              </div>
              {title && (titleComponent ? titleComponent : <h1>{title}</h1>)}
              <div className="header-side">{!!headerEnd && headerEnd}</div>
            </div>
          </header>
          {!!timelineStart && (
            <div
              className={`timeline-start ${uiState === 'loading' ? 'loading' : ''}`}
            >
              {timelineStart}
            </div>
          )}
          {items.length ? (
            <>
              {showNewer && (
                <div
                  className={`timeline-pagination timeline-pagination-top ${firstLoad.current ? '' : 'transitioning'}`}
                >
                  <button
                    type="button"
                    data-pagination-trigger="latest"
                    className={`plain4 ${uiState === 'loading' && loadStateRef.current === 'start' ? 'block' : ''}`}
                    onClick={() => {
                      // Load from top (latest)
                      loadItems();
                    }}
                    disabled={uiState === 'loading'}
                  >
                    {uiState === 'loading' &&
                    loadStateRef.current === 'start' ? (
                      <Loader abrupt />
                    ) : (
                      <Icon icon="arrow-up-top" size="l" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-pagination-trigger="prev"
                    className={`plain4 ${uiState === 'loading' && loadStateRef.current === 'start' ? '' : 'block'}`}
                    onClick={() => {
                      loadItems({ min_id: minID.current ?? undefined });
                    }}
                    disabled={uiState === 'loading'}
                  >
                    {uiState === 'loading' &&
                    loadStateRef.current === 'prev' ? (
                      <Loader abrupt />
                    ) : (
                      <Icon icon="arrow-up" size="l" />
                    )}
                  </button>
                </div>
              )}
              <ul className="timeline">
                {items.map((status) => (
                  <TimelineItem
                    status={status}
                    instance={instance}
                    useItemID={useItemID}
                    filterContext={filterContext}
                    key={
                      Array.isArray(status.id) ? status.id.join(',') : status.id
                    }
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
                <div className="timeline-pagination timeline-pagination-bottom">
                  <button
                    type="button"
                    className="plain4 block"
                    data-pagination-trigger="next"
                    onClick={() => {
                      loadItems({ max_id: maxID.current ?? undefined });
                    }}
                    disabled={uiState === 'loading'}
                  >
                    {uiState === 'loading' ? (
                      <Loader abrupt />
                    ) : (
                      <Icon icon="arrow-down" size="l" />
                    )}
                  </button>
                </div>
              ) : uiState !== 'loading' ? (
                <p className="ui-state insignificant">
                  <Trans>The end.</Trans>
                </p>
              ) : null}
            </>
          ) : uiState === 'loading' ? (
            <ul className="timeline">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i}>
                  <Status skeleton />
                </li>
              ))}
            </ul>
          ) : (
            uiState !== 'error' &&
            uiState !== 'start' && <p className="ui-state">{emptyText}</p>
          )}
          {uiState === 'error' && (
            <p className="ui-state">
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

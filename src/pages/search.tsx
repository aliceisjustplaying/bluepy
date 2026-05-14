import './search.css';

import { useAutoAnimate } from '@formkit/auto-animate/preact';
import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType, ComponentChildren } from 'preact';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { useParams, useSearchParams } from 'react-router-dom';

import AccountBlock from '../components/account-block';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import NavMenu from '../components/nav-menu';
import RecentSearches from '../components/recent-searches';
import SearchForm from '../components/search-form';
import StatusComponent, {
  type StatusComponentProps,
} from '../components/status';
import { api } from '../utils/api';
import { fetchRelationships } from '../utils/relationships';
import shortenNumber from '../utils/shorten-number';
import usePageVisibility from '../utils/usePageVisibility';
import useTitle from '../utils/useTitle';

const SHORT_LIMIT = 5;
const LIMIT = 40;
const emptySearchParams = new URLSearchParams();

const scrollIntoViewOptions: ScrollIntoViewOptions = {
  block: 'start',
  inline: 'center',
  behavior: 'instant' as ScrollBehavior,
};

function Status(props: {
  status: mastodon.v1.Status;
}) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
}
function InView(props: {
  onChange?: (inView: boolean) => void;
  children?: ComponentChildren;
}) {
  const Inner = InViewUntyped as unknown as ComponentType<{
    onChange?: (inView: boolean) => void;
    children?: ComponentChildren;
  }>;
  return <Inner {...props} />;
}

interface SearchFormHandle {
  setValue: (value: string) => void;
  focus: () => void;
  select: () => void;
  blur: () => void;
}

interface SearchProps {
  columnMode?: boolean;
  query?: string;
  type?: string;
  [key: string]: unknown;
}

interface SearchListParams {
  q: string;
  resolve: boolean;
  limit: number;
  type?: string;
  cursor?: string;
  offset?: number;
}

interface SearchResultsLike {
  statuses?: mastodon.v1.Status[];
  accounts?: mastodon.v1.Account[];
  hashtags?: mastodon.v1.Tag[];
  _pagination?: Record<string, string | undefined>;
  [key: string]: unknown;
}

interface SearchApi {
  list(params: SearchListParams): Promise<SearchResultsLike>;
}

type ResultsTypeKey = 'statuses' | 'accounts' | 'hashtags';

function Search({ columnMode, ...props }: SearchProps) {
  const { t } = useLingui();
  const routeParams = useParams() as { instance?: string };
  const [routeSearchParams] = useSearchParams();
  const params: { instance?: string } = columnMode ? {} : routeParams;
  const { masto, instance, authenticated, client } = api({
    instance: params.instance,
  });
  const atproto = !!client?.atproto;
  const [uiState, setUIState] = useState('default');
  const searchParams = columnMode ? emptySearchParams : routeSearchParams;
  const searchFormRef = useRef<SearchFormHandle | null>(null);
  const q = props?.query || searchParams.get('q');
  const type: string | null = columnMode
    ? 'statuses'
    : props?.type || searchParams.get('type');
  let title = t`Search`;
  if (q) {
    switch (type) {
      case 'statuses':
        title = t`Search: ${q} (Posts)`;
        break;
      case 'accounts':
        title = t`Search: ${q} (Accounts)`;
        break;
      case 'hashtags':
        title = t`Search: ${q} (Hashtags)`;
        break;
      case null:
      default:
        title = t`Search: ${q}`;
    }
  }
  useTitle(title, `/search`);

  const [showMore, setShowMore] = useState(false);
  const offsetRef = useRef(0);
  const cursorRef = useRef<Record<string, string | undefined>>({});
  useEffect(() => {
    offsetRef.current = 0;
    cursorRef.current = {};
  }, [q, type]);

  const scrollableRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    scrollableRef.current?.scrollTo?.(0, 0);
  }, [q, type]);

  const [statusResults, setStatusResults] = useState<mastodon.v1.Status[]>([]);
  const [accountResults, setAccountResults] = useState<mastodon.v1.Account[]>(
    [],
  );
  const [hashtagResults, setHashtagResults] = useState<mastodon.v1.Tag[]>([]);
  useEffect(() => {
    setStatusResults([]);
    setAccountResults([]);
    setHashtagResults([]);
  }, [q]);
  type ResultsSetter = (
    value: readonly unknown[] | ((prev: readonly unknown[]) => unknown[]),
  ) => void;
  // Setters from useState are stable, so this map only needs to be created
  // once; that lets `loadResults` depend on it without churning.
  const setTypeResultsFunc = useMemo<Record<ResultsTypeKey, ResultsSetter>>(
    () => ({
      statuses: setStatusResults as unknown as ResultsSetter,
      accounts: setAccountResults as unknown as ResultsSetter,
      hashtags: setHashtagResults as unknown as ResultsSetter,
    }),
    [],
  );

  const [relationshipsMap, setRelationshipsMap] = useState<
    Record<string, unknown>
  >({});
  // Stable callback: uses the functional setter and reads the previous map
  // via a transient peek so it never needs `relationshipsMap` as a dep.
  const loadRelationships = useCallback(
    async (accounts: mastodon.v1.Account[] | undefined) => {
      if (!accounts?.length) return;
      let snapshot: Record<string, unknown> = {};
      setRelationshipsMap((prev) => {
        snapshot = prev;
        return prev;
      });
      const relationships = await fetchRelationships(
        accounts as unknown as Parameters<typeof fetchRelationships>[0],
        snapshot as unknown as Parameters<typeof fetchRelationships>[1],
      );
      if (relationships) {
        setRelationshipsMap((prev) => ({
          ...prev,
          ...relationships,
        }));
      }
    },
    [],
  );

  // Mirror the type-keyed result lists into refs so the stable
  // `loadResults` callback below can compare the previous first-id without
  // re-creating on every state update.
  const typeResultsRef = useRef<Record<ResultsTypeKey, unknown[]>>({
    statuses: statusResults,
    accounts: accountResults,
    hashtags: hashtagResults,
  });
  typeResultsRef.current = {
    statuses: statusResults,
    accounts: accountResults,
    hashtags: hashtagResults,
  };

  const loadResults = useCallback(
    (firstLoad?: boolean) => {
      if (firstLoad) {
        offsetRef.current = 0;
      }

      if (!firstLoad && !authenticated && !atproto) {
        // Search results pagination is only available to authenticated users
        return;
      }

      setUIState('loading');
      if (firstLoad && !type) {
        setStatusResults((prev) => prev.slice(0, SHORT_LIMIT));
        setAccountResults((prev) => prev.slice(0, SHORT_LIMIT));
        setHashtagResults((prev) => prev.slice(0, SHORT_LIMIT));
      }

      void (async () => {
        const searchListParams: SearchListParams = {
          q: q as string,
          resolve: authenticated,
          limit: SHORT_LIMIT,
        };
        if (type) {
          searchListParams.limit = LIMIT;
          searchListParams.type = type;
          if (atproto) {
            const cursor = cursorRef.current[type];
            if (!firstLoad && !cursor) {
              setShowMore(false);
              setUIState('default');
              return;
            }
            if (cursor) searchListParams.cursor = cursor;
          } else if (authenticated) {
            searchListParams.offset = offsetRef.current;
          }
        }

        try {
          const searchApi = masto.v2.search as unknown as SearchApi;
          const results = await searchApi.list(searchListParams);
          console.log(results);
          if (type) {
            const typedResults = results;
            const typeKey = type as ResultsTypeKey;
            const nextCursor = typedResults._pagination?.[type];
            if (firstLoad) {
              setTypeResultsFunc[typeKey](
                typedResults[type] as unknown[],
              );
              const length = (typedResults[type] as unknown[] | undefined)
                ?.length;
              offsetRef.current = LIMIT;
              cursorRef.current[type] = nextCursor;
              setShowMore(atproto ? !!nextCursor : !!length);
            } else if (atproto) {
              setTypeResultsFunc[typeKey](
                (prev: readonly unknown[]) => [
                  ...prev,
                  ...(typedResults[type] as unknown[]),
                ],
              );
              cursorRef.current[type] = nextCursor;
              setShowMore(!!nextCursor);
            } else {
              // If first item is the same, it means API doesn't support offset
              // I know this is a very basic check, but it works for now
              const currentList = typedResults[type] as
                | Array<{ id?: string }>
                | undefined;
              const existingList = typeResultsRef.current[typeKey] as
                | Array<{ id?: string }>
                | undefined;
              if (currentList?.[0]?.id === existingList?.[0]?.id) {
                setShowMore(false);
              } else {
                setTypeResultsFunc[typeKey](
                  (prev: readonly unknown[]) => [
                    ...prev,
                    ...(typedResults[type] as unknown[]),
                  ],
                );
                const length = (typedResults[type] as unknown[] | undefined)
                  ?.length;
                offsetRef.current = offsetRef.current + LIMIT;
                setShowMore(!!length);
              }
            }
          } else {
            const typedResults = results;
            setStatusResults(typedResults.statuses || []);
            setAccountResults(typedResults.accounts || []);
            setHashtagResults(typedResults.hashtags || []);
            offsetRef.current = 0;
            setShowMore(false);
          }
          if (authenticated) void loadRelationships(results.accounts);

          setUIState('default');
        } catch (err) {
          console.error(err);
          setUIState('error');
        }
      })();
    },
    [
      q,
      type,
      atproto,
      authenticated,
      masto,
      loadRelationships,
      setTypeResultsFunc,
    ],
  );

  const lastHiddenTime = useRef<number | undefined>(undefined);
  usePageVisibility((visible: boolean) => {
    const reachStart = scrollableRef.current?.scrollTop === 0;
    if (visible && reachStart) {
      const timeDiff = Date.now() - (lastHiddenTime.current as number);
      if (!lastHiddenTime.current || timeDiff > 1000 * 3) {
        // 3 seconds
        loadResults(true);
      } else {
        lastHiddenTime.current = Date.now();
      }
    }
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    searchFormRef.current?.setValue?.(q || '');
    if (q) {
      loadResults(true);
    } else {
      timer = setTimeout(() => {
        searchFormRef.current?.focus?.();
      }, 150); // Right after focusDeck runs
    }
    return () => clearTimeout(timer);
  }, [q, type, instance, loadResults]);

  useHotkeys(
    ['Slash', '/'],
    () => {
      searchFormRef.current?.focus?.();
      searchFormRef.current?.select?.();
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e: KeyboardEvent) => {
        // Allow '/' even with Shift (e.g. German keyboards)
        if (e.key === '/') return false;
        return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
    },
  );

  const itemsSelector = '.timeline > li > a, .hashtag-list > li > a';
  const jRef = useHotkeys(
    'j',
    () => {
      const activeElement = document.activeElement as HTMLElement | null;
      const activeItem = activeElement?.closest<HTMLElement>(itemsSelector);
      const activeItemRect = activeItem?.getBoundingClientRect();
      const scrollable = scrollableRef.current as HTMLDivElement;
      const allItems = Array.from(
        scrollable.querySelectorAll<HTMLElement>(itemsSelector),
      );
      if (
        activeItem &&
        (activeItemRect as DOMRect).top < scrollable.clientHeight &&
        (activeItemRect as DOMRect).bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let nextItem = allItems[activeItemIndex + 1];
        if (nextItem) {
          nextItem.focus();
          nextItem.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0;
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
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'j',
    },
  );

  const kRef = useHotkeys(
    'k',
    () => {
      // focus on previous status after active item
      const activeElement = document.activeElement as HTMLElement | null;
      const activeItem = activeElement?.closest<HTMLElement>(itemsSelector);
      const activeItemRect = activeItem?.getBoundingClientRect();
      const scrollable = scrollableRef.current as HTMLDivElement;
      const allItems = Array.from(
        scrollable.querySelectorAll<HTMLElement>(itemsSelector),
      );
      if (
        activeItem &&
        (activeItemRect as DOMRect).top < scrollable.clientHeight &&
        (activeItemRect as DOMRect).bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let prevItem = allItems[activeItemIndex - 1];
        if (prevItem) {
          prevItem.focus();
          prevItem.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0;
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
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'k',
    },
  );

  const [filterBarParent] = useAutoAnimate();

  return (
    <div
      id="search-page"
      class="deck-container"
      tabIndex={-1}
      ref={(node: HTMLDivElement | null) => {
        scrollableRef.current = node;
        (jRef as unknown as { current: HTMLDivElement | null }).current = node;
        (kRef as unknown as { current: HTMLDivElement | null }).current = node;
      }}
    >
      <div class="timeline-deck deck">
        <header class={uiState === 'loading' ? 'loading' : ''}>
          <div class="header-grid">
            <div class="header-side">
              <NavMenu />
            </div>
            <SearchForm ref={searchFormRef} />
            <div class="header-side">
              <button
                type="button"
                class="plain"
                onClick={() => {
                  loadResults(true);
                }}
                disabled={uiState === 'loading'}
              >
                <Icon icon="search" size="l" alt={t`Search`} />
              </button>
            </div>
          </div>
        </header>
        <main>
          {!!q && !columnMode && (
            <div
              ref={filterBarParent}
              class={`filter-bar ${uiState === 'loading' ? 'loading' : ''}`}
            >
              {!!type && (
                <Link to={`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
                  <Icon icon="chevron-left" /> <Trans>All</Trans>
                </Link>
              )}
              {[
                {
                  label: t`Accounts`,
                  type: 'accounts',
                  to: `/search?q=${encodeURIComponent(q)}&type=accounts`,
                },
                {
                  label: t`Hashtags`,
                  type: 'hashtags',
                  to: `/search?q=${encodeURIComponent(q)}&type=hashtags`,
                },
                {
                  label: t`Posts`,
                  type: 'statuses',
                  to: `/search?q=${encodeURIComponent(q)}&type=statuses`,
                },
              ]
                .toSorted((a, b) => {
                  if (a.type === type) return -1;
                  if (b.type === type) return 1;
                  return 0;
                })
                .map((link) => (
                  <Link to={link.to} key={link.type}>
                    {link.label}
                  </Link>
                ))}
            </div>
          )}
          {q ? (
            <>
              {(!type || type === 'accounts') && (
                <>
                  {type !== 'accounts' && (
                    <h2 class="timeline-header">
                      <Trans>Accounts</Trans>{' '}
                      <Link
                        to={`/search?q=${encodeURIComponent(q)}&type=accounts`}
                      >
                        <Icon icon="arrow-right" size="l" alt={t`See more`} />
                      </Link>
                    </h2>
                  )}
                  {accountResults.length > 0 ? (
                    <>
                      <ul class="timeline flat accounts-list">
                        {accountResults.map((account) => (
                          <li key={account.id}>
                            <AccountBlock
                              account={account}
                              instance={instance}
                              showStats
                              relationship={
                                relationshipsMap[
                                  account.id
                                ] as Partial<mastodon.v1.Relationship> | null
                              }
                            />
                          </li>
                        ))}
                      </ul>
                      {type !== 'accounts' && (
                        <div class="ui-state">
                          <Link
                            class="plain button"
                            to={`/search?q=${encodeURIComponent(
                              q,
                            )}&type=accounts`}
                          >
                            <Trans>See more accounts</Trans>{' '}
                            <Icon icon="arrow-right" />
                          </Link>
                        </div>
                      )}
                    </>
                  ) : (
                    !type &&
                    (uiState === 'loading' ? (
                      <p class="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      <p class="ui-state">
                        <Trans>No accounts found.</Trans>
                      </p>
                    ))
                  )}
                </>
              )}
              {(!type || type === 'hashtags') && (
                <>
                  {type !== 'hashtags' && (
                    <h2 class="timeline-header">
                      <Trans>Hashtags</Trans>{' '}
                      <Link
                        to={`/search?q=${encodeURIComponent(q)}&type=hashtags`}
                      >
                        <Icon icon="arrow-right" size="l" alt={t`See more`} />
                      </Link>
                    </h2>
                  )}
                  {hashtagResults.length > 0 ? (
                    <>
                      <ul class="link-list hashtag-list">
                        {hashtagResults.map((hashtag) => {
                          const { name, history } = hashtag;
                          const total = history?.reduce?.(
                            (acc, cur) => acc + +cur.uses,
                            0,
                          );
                          return (
                            <li key={`${name}-${total}`}>
                              <Link
                                to={
                                  instance
                                    ? `/${instance}/t/${name}`
                                    : `/t/${name}`
                                }
                              >
                                <Icon icon="hashtag" alt="#" />
                                <span>{name}</span>
                                {!!total && (
                                  <span class="count">
                                    {shortenNumber(total)}
                                  </span>
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                      {type !== 'hashtags' && (
                        <div class="ui-state">
                          <Link
                            class="plain button"
                            to={`/search?q=${encodeURIComponent(
                              q,
                            )}&type=hashtags`}
                          >
                            <Trans>See more hashtags</Trans>{' '}
                            <Icon icon="arrow-right" />
                          </Link>
                        </div>
                      )}
                    </>
                  ) : (
                    !type &&
                    (uiState === 'loading' ? (
                      <p class="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      <p class="ui-state">
                        <Trans>No hashtags found.</Trans>
                      </p>
                    ))
                  )}
                </>
              )}
              {(!type || type === 'statuses') && (
                <>
                  {type !== 'statuses' && (
                    <h2 class="timeline-header">
                      <Trans>Posts</Trans>{' '}
                      <Link
                        to={`/search?q=${encodeURIComponent(q)}&type=statuses`}
                      >
                        <Icon icon="arrow-right" size="l" alt={t`See more`} />
                      </Link>
                    </h2>
                  )}
                  {statusResults.length > 0 ? (
                    <>
                      <ul class="timeline">
                        {statusResults.map((status) => (
                          <li key={status.id}>
                            <Link
                              class="status-link"
                              to={
                                instance
                                  ? `/${instance}/s/${status.id}`
                                  : `/s/${status.id}`
                              }
                            >
                              <Status status={status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {type !== 'statuses' && (
                        <div class="ui-state">
                          <Link
                            class="plain button"
                            to={`/search?q=${encodeURIComponent(
                              q,
                            )}&type=statuses`}
                          >
                            <Trans>See more posts</Trans>{' '}
                            <Icon icon="arrow-right" />
                          </Link>
                        </div>
                      )}
                    </>
                  ) : (
                    !type &&
                    (uiState === 'loading' ? (
                      <p class="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      <p class="ui-state">
                        <Trans>No posts found.</Trans>
                      </p>
                    ))
                  )}
                </>
              )}
              {!!type &&
                (uiState === 'default' ? (
                  showMore ? (
                    <InView
                      onChange={(inView) => {
                        if (inView) {
                          loadResults();
                        }
                      }}
                    >
                      <button
                        type="button"
                        class="plain block"
                        onClick={() => loadResults()}
                        style={{ marginBlockEnd: '6em' }}
                      >
                        <Trans>Show more…</Trans>
                      </button>
                    </InView>
                  ) : (
                    <p class="ui-state insignificant">
                      <Trans>The end.</Trans>
                    </p>
                  )
                ) : (
                  uiState === 'loading' && (
                    <p class="ui-state">
                      <Loader abrupt />
                    </p>
                  )
                ))}
            </>
          ) : uiState === 'loading' ? (
            <p class="ui-state">
              <Loader abrupt />
            </p>
          ) : (
            <>
              <p class="ui-state insignificant">
                <Trans>
                  Enter your search term or paste a URL above to get started.
                </Trans>
              </p>
              <RecentSearches />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default Search;

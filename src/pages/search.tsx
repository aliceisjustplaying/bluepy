import './search.css';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType, ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { useParams, useSearchParams } from 'react-router-dom';

import AccountBlock from '../components/account-block';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import NavMenu from '../components/nav-menu';
import RecentSearches from '../components/recent-searches';
import SearchDataResults from '../components/search-data-results';
import SearchForm from '../components/search-form';
import StatusComponent, {
  type StatusComponentProps,
} from '../components/status';
import { api, getMastoV2Resource } from '../utils/api';
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

function Status(props: { status: mastodon.v1.Status }) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
}
type InViewProps = {
  onChange?: (inView: boolean) => void;
  children?: ReactNode;
};
const InView: ComponentType<InViewProps> =
  InViewUntyped as typeof InViewUntyped & ComponentType<InViewProps>;

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
type SearchResultsByType = {
  statuses: mastodon.v1.Status[];
  accounts: mastodon.v1.Account[];
  hashtags: mastodon.v1.Tag[];
};
type ResultsSetterMap = {
  [K in ResultsTypeKey]: (
    value:
      | SearchResultsByType[K]
      | ((prev: SearchResultsByType[K]) => SearchResultsByType[K]),
  ) => void;
};

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
  // Setters from useState are stable, so this map only needs to be created
  // once; that lets `loadResults` depend on it without churning.
  const setTypeResultsFunc = useMemo<ResultsSetterMap>(
    () => ({
      statuses: setStatusResults,
      accounts: setAccountResults,
      hashtags: setHashtagResults,
    }),
    [],
  );
  const setResultsForType = useCallback(
    <K extends ResultsTypeKey>(
      typeKey: K,
      value:
        | SearchResultsByType[K]
        | ((prev: SearchResultsByType[K]) => SearchResultsByType[K]),
    ) => {
      setTypeResultsFunc[typeKey](value);
    },
    [setTypeResultsFunc],
  );

  const [relationshipsMap, setRelationshipsMap] = useState<
    Record<string, mastodon.v1.Relationship>
  >({});
  // Stable callback: uses the functional setter and reads the previous map
  // via a transient peek so it never needs `relationshipsMap` as a dep.
  const loadRelationships = useCallback(
    async (accounts: mastodon.v1.Account[] | undefined) => {
      if (!accounts?.length) return;
      let snapshot: Record<string, mastodon.v1.Relationship> = {};
      setRelationshipsMap((prev) => {
        snapshot = prev;
        return prev;
      });
      const relationships = await fetchRelationships(accounts, snapshot);
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
          const searchApi = getMastoV2Resource<SearchApi>(masto, 'search');
          const results = await searchApi.list(searchListParams);
          console.log(results);
          if (type) {
            const typedResults = results;
            const typeKey = type as ResultsTypeKey;
            const nextCursor = typedResults._pagination?.[type];
            const nextResults = typedResults[
              typeKey
            ] as SearchResultsByType[typeof typeKey];
            if (firstLoad) {
              setResultsForType(typeKey, nextResults);
              const length = nextResults?.length;
              offsetRef.current = LIMIT;
              cursorRef.current[type] = nextCursor;
              setShowMore(atproto ? !!nextCursor : !!length);
            } else if (atproto) {
              setResultsForType(
                typeKey,
                (prev) =>
                  [
                    ...prev,
                    ...nextResults,
                  ] as SearchResultsByType[typeof typeKey],
              );
              cursorRef.current[type] = nextCursor;
              setShowMore(!!nextCursor);
            } else {
              // If first item is the same, it means API doesn't support offset
              // I know this is a very basic check, but it works for now
              const currentList = nextResults as
                | Array<{ id?: string }>
                | undefined;
              const existingList = typeResultsRef.current[typeKey] as
                | Array<{ id?: string }>
                | undefined;
              if (currentList?.[0]?.id === existingList?.[0]?.id) {
                setShowMore(false);
              } else {
                setResultsForType(
                  typeKey,
                  (prev) =>
                    [
                      ...prev,
                      ...nextResults,
                    ] as SearchResultsByType[typeof typeKey],
                );
                const length = nextResults?.length;
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
      setResultsForType,
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
      if (!atproto || type === 'hashtags') {
        loadResults(true);
      }
    } else {
      timer = setTimeout(() => {
        searchFormRef.current?.focus?.();
      }, 150); // Right after focusDeck runs
    }
    return () => {
      clearTimeout(timer);
    };
  }, [q, type, instance, loadResults, atproto]);

  useHotkeys(
    ['Slash', '/'],
    () => {
      searchFormRef.current?.focus?.();
      searchFormRef.current?.select?.();
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e) => {
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
      ignoreEventWhen: (e) =>
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
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'k',
    },
  );

  const [filterBarParent] = useAutoAnimate();
  const filterLinks = q
    ? [
        {
          label: t`All`,
          type: null,
          to: `/search?q=${encodeURIComponent(q)}`,
        },
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
    : [];
  const filterBar =
    !!q && !columnMode ? (
      <div
        ref={filterBarParent}
        className={`filter-bar search-filter-bar ${
          uiState === 'loading' ? 'loading' : ''
        }`}
      >
        {filterLinks.map((link) => (
          <Link
            to={link.to}
            key={link.type ?? 'all'}
            className={link.type === type ? 'is-active' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>
    ) : null;
  const useNestedFilterBar = atproto && type === 'statuses';

  return (
    <div
      id="search-page"
      className="deck-container"
      tabIndex={-1}
      ref={(node: HTMLDivElement | null) => {
        scrollableRef.current = node;
        jRef.current = node;
        kRef.current = node;
      }}
    >
      <div className="timeline-deck deck">
        <header className={uiState === 'loading' ? 'loading' : ''}>
          <div className="header-grid">
            <div className="header-side">
              <NavMenu />
              <Link to="/" className="button plain">
                <Icon icon="home" size="l" alt={t`Home`} />
              </Link>
            </div>
            <h1>
              <Trans>Search</Trans>
            </h1>
            <div className="header-side">
              <button
                type="button"
                className="plain"
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
        <div className="search-input-dock">
          <SearchForm ref={searchFormRef} />
          <button
            type="button"
            className="plain"
            onClick={() => {
              loadResults(true);
            }}
            disabled={uiState === 'loading'}
          >
            <Icon icon="search" size="l" alt={t`Search`} />
          </button>
        </div>
        <main>
          {useNestedFilterBar ? null : filterBar}
          {q ? (
            atproto && type !== 'hashtags' ? (
              <SearchDataResults
                query={q}
                type={type}
                instance={instance}
                headerStart={false}
                filterBar={useNestedFilterBar ? filterBar : undefined}
              />
            ) : (
            <>
              {(!type || type === 'accounts') && (
                <>
                  {type !== 'accounts' && (
                    <h2 className="timeline-header">
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
                      <ul className="timeline flat accounts-list">
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
                        <div className="ui-state">
                          <Link
                            className="plain button"
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
                      <p className="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      <p className="ui-state">
                        <Trans>No accounts found.</Trans>
                      </p>
                    ))
                  )}
                </>
              )}
              {(!type || type === 'hashtags') && (
                <>
                  {type !== 'hashtags' && (
                    <h2 className="timeline-header">
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
                      <ul className="link-list hashtag-list">
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
                                  <span className="count">
                                    {shortenNumber(total)}
                                  </span>
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                      {type !== 'hashtags' && (
                        <div className="ui-state">
                          <Link
                            className="plain button"
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
                      <p className="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      <p className="ui-state">
                        <Trans>No hashtags found.</Trans>
                      </p>
                    ))
                  )}
                </>
              )}
              {(!type || type === 'statuses') && (
                <>
                  {type !== 'statuses' && (
                    <h2 className="timeline-header">
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
                      <ul className="timeline">
                        {statusResults.map((status) => (
                          <li key={status.id}>
                            <Link
                              className="status-link"
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
                        <div className="ui-state">
                          <Link
                            className="plain button"
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
                      <p className="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      <p className="ui-state">
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
                        className="plain block"
                        onClick={() => {
                          loadResults();
                        }}
                        style={{ marginBlockEnd: '6em' }}
                      >
                        <Trans>Show more…</Trans>
                      </button>
                    </InView>
                  ) : (
                    <p className="ui-state insignificant">
                      <Trans>The end.</Trans>
                    </p>
                  )
                ) : (
                  uiState === 'loading' && (
                    <p className="ui-state">
                      <Loader abrupt />
                    </p>
                  )
                ))}
            </>
            )
          ) : uiState === 'loading' ? (
            <p className="ui-state">
              <Loader abrupt />
            </p>
          ) : (
            <>
              <p className="ui-state insignificant">
                <Trans>
                  Enter your search term or paste a URL to get started.
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

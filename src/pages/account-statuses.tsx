import './account-statuses.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type {
  TargetedEvent,
  TargetedMouseEvent,
} from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'preact/hooks';
import { toUnicode as punycodeToUnicode } from 'punycode/';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import AccountInfo, { type AccountInfoShape } from '../components/account-info';
import AccountInfoMini from '../components/account-info-mini';
import EmojiText from '../components/emoji-text';
import Icon from '../components/icon';
import Link from '../components/link';
import Menu2 from '../components/menu2';
import Timeline from '../components/timeline';
import {
  api,
  getMastoV1Resource,
  getMastoV2Resource,
  type MastoClient,
} from '../utils/api';
import isSearchEnabled from '../utils/is-search-enabled';
import mem from '../utils/mem';
import pmem from '../utils/pmem';
import showToast from '../utils/show-toast';
import { sorted } from '../utils/sorted';
import states, { saveStatus } from '../utils/states';
import {
  getCurrentAccountID,
  isMediaFirstInstance,
} from '../utils/store-utils';
import supports from '../utils/supports';
import useTitle from '../utils/useTitle';

type Status = mastodon.v1.Status;
type Account = mastodon.v1.Account;
type FeaturedTag = mastodon.v1.FeaturedTag;
type SaveStatusInput = NonNullable<Parameters<typeof saveStatus>[0]>;

interface PinnedGroup {
  id: string[];
  items: ReadonlyArray<Status & { _pinned?: boolean }>;
  type: 'pinned';
}

type TimelineItem = (Status & { _pinned?: boolean }) | PinnedGroup;
type AccountStatusesListParams = mastodon.rest.v1.ListAccountStatusesParams & {
  exclude_replies?: boolean;
  exclude_reblogs?: boolean;
  only_media?: boolean;
};

interface AccountStatusesProps {
  columnMode?: boolean;
  id?: string;
  // Forwarded via `...props` in column mode.
  [key: string]: unknown;
}

type SearchParamsObject = Record<
  string,
  string | number | boolean | null | undefined
>;
type SearchParamsUpdater =
  | SearchParamsObject
  | URLSearchParams
  | ((params: URLSearchParams) => void);
type SearchParamsSetter = (next: SearchParamsUpdater) => void;

const LIMIT = 20;
const MIN_YEAR = 1983;
const MIN_YEAR_MONTH = `${MIN_YEAR}-01`; // Birth of the Internet

function stateStatus<T extends mastodon.v1.Status>(
  status: T,
): T & SaveStatusInput {
  return status as T & SaveStatusInput;
}

function isAccountInfoShape(account: unknown): account is AccountInfoShape {
  return !!account && typeof account === 'object';
}

function applySearchParamsObject(
  params: URLSearchParams,
  obj: SearchParamsObject,
): void {
  Object.entries(obj).forEach(([key, value]) => {
    if (value) {
      params.set(key, String(value));
    } else {
      params.delete(key);
    }
  });
}

function searchParamsFromObject(obj: SearchParamsObject): URLSearchParams {
  const params = new URLSearchParams();
  applySearchParamsObject(params, obj);
  return params;
}

const supportsInputMonth = mem(() => {
  try {
    const input = document.createElement('input');
    input.setAttribute('type', 'month');
    return input.type === 'month';
  } catch {
    return false;
  }
});

function AccountStatuses({ columnMode, ...props }: AccountStatusesProps) {
  const { i18n, t } = useLingui();
  const snapStates = useSnapshot(states);
  const routeParams = useParams() as { id?: string; instance?: string };
  const [routeSearchParams, setRouteSearchParamsBase] = useSearchParams();
  const { id, ...params } = columnMode ? { id: props.id } : routeParams;

  // `URLSearchParams` accepts `Record<string, string>`; the JS `{ replies: 1 }`
  // is coerced to "1" at runtime — preserve via string init.
  const profileSearchParamsRef = useRef(new URLSearchParams({ replies: '1' }));
  const [, forceUpdate] = useReducer<number, undefined>((c) => c + 1, 0);
  const profileSetSearchParams = useCallback<SearchParamsSetter>((objOrFn) => {
    const localParams = profileSearchParamsRef.current;
    if (typeof objOrFn === 'function') {
      objOrFn(localParams);
    } else if (objOrFn instanceof URLSearchParams) {
      [...localParams.keys()].forEach((key) => localParams.delete(key));
      objOrFn.forEach((value, key) => localParams.set(key, value));
    } else {
      applySearchParamsObject(localParams, objOrFn);
    }
    forceUpdate(undefined);
  }, []);
  const setRouteSearchParams = useCallback<SearchParamsSetter>(
    (objOrFn) => {
      if (typeof objOrFn === 'function') {
        setRouteSearchParamsBase((prev) => {
          const next = new URLSearchParams(prev);
          objOrFn(next);
          return next;
        });
      } else if (objOrFn instanceof URLSearchParams) {
        setRouteSearchParamsBase(objOrFn);
      } else {
        setRouteSearchParamsBase(searchParamsFromObject(objOrFn));
      }
    },
    [setRouteSearchParamsBase],
  );
  const [searchParams, setSearchParams] = columnMode
    ? ([profileSearchParamsRef.current, profileSetSearchParams] as const)
    : ([routeSearchParams, setRouteSearchParams] as const);
  const clearAndSetParam = useCallback(
    (paramName?: string, paramValue?: string) => {
      const localParams = new URLSearchParams(
        columnMode ? { replies: '1' } : undefined,
      );
      if (paramValue !== undefined) {
        localParams.set(paramName as string, paramValue);
      }
      setSearchParams(localParams);
    },
    [setSearchParams, columnMode],
  );
  const toggleParam = useCallback(
    (paramName: string, paramValue?: string) => {
      const localParams = new URLSearchParams(searchParams.toString());
      if (localParams.get(paramName)) {
        localParams.delete(paramName);
      } else {
        localParams.set(paramName, paramValue ?? '1');
      }
      setSearchParams(localParams);
    },
    [setSearchParams, searchParams],
  );

  const month = searchParams.get('month');
  const excludeReplies = !searchParams.get('replies');
  const excludeBoosts = !!searchParams.get('boosts');
  const tagged = searchParams.get('tagged');
  const media = !!searchParams.get('media');
  const { masto, instance, authenticated } = api({
    instance: params?.instance,
  });
  const { masto: currentMasto, instance: currentInstance } = api();
  const accountStatusesIterator = useRef<AsyncIterator<Status[]> | undefined>(
    undefined,
  );

  const [account, setAccount] = useState<Account | undefined>();
  const searchOffsetRef = useRef(0);
  useEffect(() => {
    searchOffsetRef.current = 0;
  }, [month, excludeReplies, excludeBoosts, tagged, media]);

  const mediaFirst = useMemo(() => isMediaFirstInstance(), []);

  const sameCurrentInstance = useMemo(
    () => instance === currentInstance,
    [instance, currentInstance],
  );
  const [searchEnabled, setSearchEnabled] = useState(false);
  useEffect(() => {
    // Only enable for current logged-in instance
    // Most remote instances don't allow unauthenticated searches
    if (!sameCurrentInstance) return;
    if (!account?.acct) return;
    void (async () => {
      const enabled = await isSearchEnabled(instance);
      console.log({ enabled });
      setSearchEnabled(enabled);
    })();
  }, [instance, sameCurrentInstance, account?.acct]);

  async function fetchAccountStatuses(firstLoad?: boolean): Promise<{
    value: ReadonlyArray<TimelineItem>;
    done?: boolean;
  }> {
    const isValidMonth = /^\d{4}-[01]\d$/.test(month as string);
    // JS: `string >= number` coerces the string via ToNumber. Preserve via
    // explicit Number(); falls back to NaN >= MIN_YEAR (false) when month is
    // nullish, matching the original.
    const isValidYear = Number(month?.split?.('-')?.[0]) >= MIN_YEAR;
    if (isValidMonth && isValidYear) {
      if (!account) {
        return {
          value: [],
          done: true,
        };
      }
      const [_year, _month] = (month as string).split('-');
      const yearNum = parseInt(_year, 10);
      const monthIndex = parseInt(_month, 10) - 1;
      // YYYY-MM (no day)
      // Search options:
      // - from:account
      // - after:YYYY-MM-DD (non-inclusive)
      // - before:YYYY-MM-DD (non-inclusive)

      // Last day of previous month
      const after = new Date(yearNum, monthIndex, 0);
      const afterStr = `${after.getFullYear()}-${(after.getMonth() + 1)
        .toString()
        .padStart(2, '0')}-${after.getDate().toString().padStart(2, '0')}`;
      // First day of next month
      const before = new Date(yearNum, monthIndex + 1, 1);
      const beforeStr = `${before.getFullYear()}-${(before.getMonth() + 1)
        .toString()
        .padStart(2, '0')}-${before.getDate().toString().padStart(2, '0')}`;
      console.log({
        month,
        _year,
        _month,
        monthIndex,
        after,
        before,
        afterStr,
        beforeStr,
      });

      let limit: number;
      if (firstLoad) {
        limit = LIMIT + 1;
        searchOffsetRef.current = 0;
      } else {
        limit = LIMIT + searchOffsetRef.current + 1;
        searchOffsetRef.current += LIMIT;
      }

      const searchResource =
        getMastoV2Resource<mastodon.rest.v2.SearchResource>(masto, 'search');
      const searchResults = await searchResource.list({
        q: `from:${account.acct} after:${afterStr} before:${beforeStr}`,
        type: 'statuses',
        limit,
        offset: searchOffsetRef.current,
      });
      if (searchResults?.statuses?.length) {
        const value = searchResults.statuses.slice(0, LIMIT);
        value.forEach((item) => {
          saveStatus(stateStatus(item), instance);
        });
        const done = searchResults.statuses.length <= LIMIT;
        return { value, done };
      } else {
        return { value: [], done: true };
      }
    }

    let results: TimelineItem[] = [];
    const accountsResource =
      getMastoV1Resource<mastodon.rest.v1.AccountsResource>(
        masto,
        'accounts',
      );
    if (firstLoad && !columnMode) {
      const { value } = await accountsResource
        .$select(id as string)
        .statuses.list({
          pinned: true,
        })
        .values()
        .next();
      if (value?.length && !tagged && !media) {
        const pinnedStatuses = value.map((status: Status) => {
          saveStatus(stateStatus(status), instance);
          return {
            ...status,
            _pinned: true,
          };
        });
        if (pinnedStatuses.length >= 3) {
          const pinnedStatusesIds = pinnedStatuses.map(
            (status: Status) => status.id,
          );
          results.push({
            id: pinnedStatusesIds,
            items: pinnedStatuses,
            type: 'pinned',
          });
        } else {
          results.push(...pinnedStatuses);
        }
      }
    }
    if (firstLoad || !accountStatusesIterator.current) {
      const listParams: AccountStatusesListParams = {
        limit: LIMIT,
        exclude_replies: excludeReplies,
        exclude_reblogs: excludeBoosts,
        only_media: media || undefined,
        tagged,
      };
      accountStatusesIterator.current = accountsResource
        .$select(id as string)
        .statuses.list(listParams)
        .values();
    }
    const { value, done } = await accountStatusesIterator.current.next();
    if (value?.length) {
      if (!supports('@mastodon/pinned-posts')) {
        // Check if value is same as pinned post (results)
        // If the index for every post is the same, means API might not support pinned posts
        // TODO: This is a really weird check, fix this at some point
        if (results.length) {
          let pinnedStatusesIds: string[] = [];
          const first = results[0];
          if (
            first &&
            typeof first === 'object' &&
            (first as PinnedGroup).type === 'pinned'
          ) {
            pinnedStatusesIds = (first as PinnedGroup).id;
          } else {
            // TODO(oxlint:no-underscore-dangle) `_pinned` is the project-wide
            // pinned-status marker shared with timeline.tsx; renaming is out
            // of scope.
            pinnedStatusesIds = (
              results as Array<Status & { _pinned?: boolean }>
            )
              .filter((status) => status._pinned)
              .map((status) => status.id);
          }
          const containsAllPinned = pinnedStatusesIds.every((postId) =>
            value.some((status: Status) => status.id === postId),
          );
          if (containsAllPinned) {
            // Remove pinned posts
            results = [];
          }
        }
      }

      results.push(...value);

      value.forEach((item: Status) => {
        saveStatus(stateStatus(item), instance);
      });
    }
    return {
      value: results,
      done,
    };
  }

  const [featuredTags, setFeaturedTags] = useState<FeaturedTag[]>([]);

  let title = t`Account posts`;
  if (account?.acct) {
    const acctDisplay = (/@/.test(account.acct) ? '' : '@') + account.acct;
    const accountDisplay = account?.displayName
      ? `${account.displayName} (${acctDisplay})`
      : acctDisplay;
    if (tagged && media) {
      title = t`Media posts tagged #${tagged} by ${accountDisplay}`;
    } else if (tagged) {
      title = t`Posts tagged #${tagged} by ${accountDisplay}`;
    } else if (month) {
      const [y, m] = month.split('-');
      const monthYear = new Date(+y, +m - 1, 1).toLocaleString(i18n.locale, {
        month: 'long',
        year: 'numeric',
      });
      title = t`Posts in ${monthYear} by ${accountDisplay}`;
    } else if (media) {
      title = t`Media posts by ${accountDisplay}`;
    } else {
      title = accountDisplay;
    }
  }
  useTitle(title, '/:instance?/a/:id');

  const refetchAccount = useCallback(() => {
    return memFetchAccount(id as string, masto);
  }, [id, masto]);

  useEffect(() => {
    const accountsResource =
      getMastoV1Resource<mastodon.rest.v1.AccountsResource>(
        masto,
        'accounts',
      );
    void (async () => {
      try {
        const acc = await refetchAccount();
        console.log(acc);
        setAccount(acc);
      } catch (e) {
        console.error(e);
      }
      // No need, because the whole filter bar is hidden
      // TODO: Revisit this
      if (!mediaFirst) {
        try {
          const fetchedFeaturedTags = await accountsResource
            .$select(id as string)
            .featuredTags.list();
          console.log({ fetchedFeaturedTags });
          setFeaturedTags(fetchedFeaturedTags);
        } catch (e) {
          console.error(e);
        }
      }
    })();
  }, [id, mediaFirst, refetchAccount, masto]);

  const { displayName, acct, emojis } = account || ({} as Partial<Account>);

  const isSelf = useMemo(
    () => account?.id === getCurrentAccountID(),
    [account?.id],
  );

  const filterBarRef = useRef<HTMLDivElement | null>(null);
  const TimelineStart = useMemo(() => {
    const repliesFiltered = columnMode ? excludeReplies : !excludeReplies;
    const filtered =
      repliesFiltered || excludeBoosts || tagged || media || !!month;
    const cachedAccount = snapStates.accounts[`${id}@${instance}`];

    const buildParamStr = (
      updates: Record<string, string | null | undefined>,
    ): string => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val == null) {
          next.delete(key);
        } else {
          next.set(key, val);
        }
      }
      const str = next.toString();
      return str ? `?${str}` : '';
    };

    return (
      <>
        {columnMode ? (
          <AccountInfoMini account={account} instance={instance} />
        ) : (
          <AccountInfo
            instance={instance}
            account={isAccountInfoShape(cachedAccount) ? cachedAccount : id}
            fetchAccount={refetchAccount}
            authenticated={authenticated}
            standalone
            showEndorsements
          />
        )}
        {!mediaFirst && (
          <div
            class="filter-bar"
            ref={filterBarRef}
            style={{
              position: 'relative',
            }}
          >
            {filtered ? (
              <Link
                to={`/${instance}/a/${id}`}
                class="insignificant filter-clear"
                title={t`Reset filters`}
                key="clear-filters"
                onClick={(e: TargetedMouseEvent<HTMLAnchorElement>) => {
                  if (columnMode) {
                    e.preventDefault();
                    clearAndSetParam();
                  }
                }}
              >
                <Icon icon="x" size="l" alt={t`Reset filters`} />
              </Link>
            ) : (
              <Icon
                icon="filter"
                class="insignificant"
                size="l"
                alt={t`Filters`}
              />
            )}
            <div class="filter-bar-group">
              <label>
                <input
                  type="checkbox"
                  checked={!excludeReplies}
                  disabled={!!month}
                  onChange={() => {
                    toggleParam('replies', '1');
                    if (excludeReplies) {
                      showToast(t`Showing replies`);
                    } else {
                      showToast(t`Hiding replies`);
                    }
                  }}
                />
                <Trans>Replies</Trans>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!excludeBoosts}
                  disabled={!!month}
                  onChange={() => {
                    toggleParam('boosts', '0');
                    if (excludeBoosts) {
                      showToast(t`Showing boosts`);
                    } else {
                      showToast(t`Hiding boosts`);
                    }
                  }}
                />
                <Trans>Boosts</Trans>
              </label>
            </div>
            <Link
              to={`/${instance}/a/${id}${buildParamStr({
                media: media ? null : '1',
              })}`}
              onClick={(e: TargetedMouseEvent<HTMLAnchorElement>) => {
                if (columnMode) {
                  e.preventDefault();
                  toggleParam('media', '1');
                }
                if (!media) {
                  showToast(t`Showing posts with media`);
                }
              }}
              class={media ? 'is-active' : ''}
            >
              <Trans>Media</Trans>
            </Link>
            {featuredTags.length > 0 && (
              <div class="filter-bar-group">
                {sorted(featuredTags, (a, b) => {
                    if (a.name === tagged) return -1;
                    if (b.name === tagged) return 1;
                    return 0;
                  })
                  .map((tag) => (
                    <Link
                      key={tag.id}
                      to={`/${instance}/a/${id}${buildParamStr({
                        tagged: tagged === tag.name ? null : tag.name,
                      })}`}
                      onClick={(e: TargetedMouseEvent<HTMLAnchorElement>) => {
                        if (columnMode) {
                          e.preventDefault();
                          const next = new URLSearchParams(
                            searchParams.toString(),
                          );
                          if (next.get('tagged') === tag.name) {
                            next.delete('tagged');
                          } else {
                            next.set('tagged', tag.name);
                          }
                          setSearchParams(next);
                        }
                        if (tagged !== tag.name) {
                          showToast(t`Showing posts tagged with #${tag.name}`);
                        }
                      }}
                      class={tagged === tag.name ? 'is-active' : ''}
                    >
                      <span>
                        <span class="more-insignificant">#</span>
                        {tag.name}
                      </span>
                      {/* <span class="filter-count">{tag.statusesCount}</span> */}
                    </Link>
                  ))}
              </div>
            )}
            {searchEnabled && !columnMode && (
              <>
                <div class="filter-bar-separator" />
                {supportsInputMonth() ? (
                  <label class={`filter-field ${month ? 'is-active' : ''}`}>
                    <Icon icon="month" size="l" />
                    <input
                      type="month"
                      disabled={!account?.acct}
                      value={month || ''}
                      min={MIN_YEAR_MONTH}
                      max={new Date().toISOString().slice(0, 7)}
                      onInput={(e: TargetedEvent<HTMLInputElement>) => {
                        const { value, validity } = e.currentTarget;
                        if (!validity.valid) return;
                        setSearchParams(
                          value
                            ? {
                                month: value,
                              }
                            : {},
                        );
                        const [year, monthStr] = value.split('-');
                        const monthIndex = parseInt(monthStr, 10) - 1;
                        const date = new Date(parseInt(year, 10), monthIndex);
                        showToast(
                          t`Showing posts in ${date.toLocaleString(
                            i18n.locale,
                            {
                              month: 'long',
                              year: 'numeric',
                            },
                          )}`,
                        );
                      }}
                    />
                  </label>
                ) : (
                  // Fallback to <select> for month and <input type="number"> for year
                  <MonthPicker
                    class={`filter-field ${month ? 'is-active' : ''}`}
                    disabled={!account?.acct}
                    value={month || ''}
                    min={MIN_YEAR_MONTH}
                    max={new Date().toISOString().slice(0, 7)}
                    onInput={(e) => {
                      const { value, validity } = e;
                      if (!validity.valid) return;
                      setSearchParams(
                        value
                          ? {
                              month: value,
                            }
                          : {},
                      );
                    }}
                  />
                )}
                <button
                  type="button"
                  class="filter-field"
                  onClick={() => {
                    states.showSearchCommand = {
                      query: isSelf ? 'from:me ' : `from:${account?.acct} `,
                    };
                  }}
                >
                  <Icon
                    icon="search"
                    size="l"
                    alt={
                      isSelf
                        ? t`Search my posts`
                        : t`Search @${account?.username}'s posts`
                    }
                  />
                </button>
              </>
            )}
          </div>
        )}
      </>
    );
    // `TimelineStart` is a JSX expression that legitimately closes over
    // many props/state — locale, account fields, search params, and the
    // memoized callbacks. Listing them all keeps the rendered output in
    // sync with the underlying values; identity churn is fine because the
    // callbacks are stable and primitive values rarely change in lockstep.
  }, [
    id,
    instance,
    authenticated,
    featuredTags,
    refetchAccount,
    searchEnabled,
    month,
    excludeReplies,
    excludeBoosts,
    tagged,
    media,
    mediaFirst,
    searchParams,
    account,
    t,
    i18n.locale,
    columnMode,
    snapStates.accounts,
    toggleParam,
    isSelf,
    setSearchParams,
    clearAndSetParam,
  ]);
  const accountMonthKey = `${month ?? ''}${account?.acct ?? ''}`;

  useEffect(() => {
    const activeEls = [
      ...(filterBarRef.current?.querySelectorAll<HTMLElement>('.is-active') ??
        []),
    ];
    if (!activeEls.length) return;
    const barWidth = (filterBarRef.current as HTMLDivElement).offsetWidth;
    const left = Math.min(...activeEls.map((el) => el.offsetLeft));
    const right = Math.max(
      ...activeEls.map((el) => el.offsetLeft + el.offsetWidth),
    );
    const spanWidth = right - left;
    (filterBarRef.current as HTMLDivElement).scrollTo({
      behavior: 'smooth',
      left: spanWidth >= barWidth ? left : left - (barWidth - spanWidth) / 2,
    });
  }, [
    featuredTags,
    searchEnabled,
    month,
    excludeReplies,
    excludeBoosts,
    tagged,
    media,
  ]);

  const accountInstance = useMemo<string | null | undefined>(() => {
    if (!account?.url) return null;
    const domain = URL.parse(account.url)?.hostname;
    return domain;
  }, [account]);
  const sameInstance = instance === accountInstance;
  const allowSwitch = !!account && !sameInstance;

  return (
    <>
      <Timeline
        key={id}
        title={account?.acct ? `@${account.acct}` : t`Posts`}
        titleComponent={
          <h1
            class="header-double-lines header-account"
            // onClick={() => {
            //   states.showAccount = {
            //     account,
            //     instance,
            //   };
            // }}
          >
            <b>
              <EmojiText
                text={displayName}
                emojis={emojis}
                resolverURL={account?.url}
              />
            </b>
            <div>
              <span class="bidi-isolate">@{acct}</span>
            </div>
          </h1>
        }
        id="account-statuses"
        timelineKey={`account-statuses-${instance}-${id}-${[
          excludeReplies,
          excludeBoosts,
          tagged,
          media,
          accountMonthKey,
        ].toString()}`}
        instance={instance}
        emptyText={t`Nothing to see here yet.`}
        errorText={t`Unable to load posts`}
        fetchItems={fetchAccountStatuses}
        useItemID
        view={media || mediaFirst ? 'media' : undefined}
        boostsCarousel={false}
        timelineStart={TimelineStart}
        refresh={[
          excludeReplies,
          excludeBoosts,
          tagged,
          media,
          accountMonthKey,
        ].toString()}
        headerEnd={
          <Menu2
            portal
            // setDownOverflow
            overflow="auto"
            viewScroll="close"
            position="anchor"
            menuButton={
              <button type="button" class="plain">
                <Icon icon="more" size="l" alt={t`More`} />
              </button>
            }
          >
            <MenuItem
              disabled={!allowSwitch}
              onClick={() => {
                void (async () => {
                  try {
                    const { masto: instanceMasto } = api({
                      instance: accountInstance as string | undefined,
                    });
                    const accountsResource =
                      getMastoV1Resource<mastodon.rest.v1.AccountsResource>(
                        instanceMasto,
                        'accounts',
                      );
                    const acc = await accountsResource.lookup({
                      acct: (account as Account).acct,
                    });
                    const { id: lookupId } = acc;
                    location.hash = `/${accountInstance}/a/${lookupId}`;
                  } catch (e) {
                    console.error(e);
                    alert(t`Unable to fetch account info`);
                  }
                })();
              }}
            >
              <Icon icon="transfer" />{' '}
              <small class="menu-double-lines">
                <Trans>
                  Switch to account's server{' '}
                  {accountInstance ? (
                    <>
                      {' '}
                      (<b>{punycodeToUnicode(accountInstance)}</b>)
                    </>
                  ) : null}
                </Trans>
              </small>
            </MenuItem>
            {!sameCurrentInstance && (
              <MenuItem
                onClick={() => {
                  void (async () => {
                    try {
                      const accountsResource =
                        getMastoV1Resource<mastodon.rest.v1.AccountsResource>(
                          currentMasto,
                          'accounts',
                        );
                      const acc = await accountsResource.lookup({
                        acct: (account as Account).acct + '@' + instance,
                      });
                      const { id: lookupId } = acc;
                      location.hash = `/${currentInstance}/a/${lookupId}`;
                    } catch (e) {
                      console.error(e);
                      alert(t`Unable to fetch account info`);
                    }
                  })();
                }}
              >
                <Icon icon="transfer" />{' '}
                <small class="menu-double-lines">
                  <Trans>
                    Switch to my server (<b>{currentInstance}</b>)
                  </Trans>
                </small>
              </MenuItem>
            )}
          </Menu2>
        }
      />
      {acct && !isSelf && (
        <data
          class="compose-data"
          value={JSON.stringify({
            draftStatus: {
              status: `@${acct} `,
            },
          })}
        />
      )}
    </>
  );
}

interface MonthPickerChangePayload {
  value: string;
  validity: { valid: boolean };
}

interface MonthPickerProps {
  class?: string;
  disabled?: boolean;
  value?: string;
  min?: string;
  max?: string;
  onInput?: (payload: MonthPickerChangePayload) => void;
}

function MonthPicker(props: MonthPickerProps) {
  const { i18n } = useLingui();
  const {
    class: className,
    disabled,
    value,
    min,
    max,
    onInput = () => {},
  } = props;
  const [_year, _month] = value?.split('-') || [];
  const monthFieldRef = useRef<HTMLSelectElement | null>(null);
  const yearFieldRef = useRef<HTMLInputElement | null>(null);

  const checkValidity = (month: string, year: string): boolean => {
    const [minYear, minMonth] = min?.split('-') || [];
    const [maxYear, maxMonth] = max?.split('-') || [];
    if (year < minYear) return false;
    if (year > maxYear) return false;
    if (year === minYear && month < minMonth) return false;
    if (year === maxYear && month > maxMonth) return false;
    return true;
  };

  return (
    <div class={className}>
      <Icon icon="month" size="l" />
      <select
        ref={monthFieldRef}
        disabled={disabled}
        value={_month || ''}
        onInput={(e: TargetedEvent<HTMLSelectElement>) => {
          const { value: month } = e.currentTarget;
          const year = (yearFieldRef.current as HTMLInputElement).value;
          if (!checkValidity(month, year)) {
            // JS original `return { value: '', validity: { valid: false } }`
            // here, but the return value of an `onInput` handler is discarded;
            // preserve the early-exit behavior without the dead object.
            return;
          }
          onInput({
            value: month ? `${year}-${month}` : '',
            validity: {
              valid: true,
            },
          });
        }}
      >
        <option value="">
          <Trans>Month</Trans>
        </option>
        <option disabled>-----</option>
        {Array.from({ length: 12 }, (_, i) => (
          <option
            value={
              // Month is 1-indexed
              (i + 1).toString().padStart(2, '0')
            }
            key={i}
          >
            {new Date(0, i).toLocaleString(i18n.locale, {
              month: 'long',
            })}
          </option>
        ))}
      </select>{' '}
      <input
        ref={yearFieldRef}
        type="number"
        disabled={disabled}
        value={_year || new Date().getFullYear()}
        min={min?.slice(0, 4) || MIN_YEAR}
        max={max?.slice(0, 4) || new Date().getFullYear()}
        onInput={(e: TargetedEvent<HTMLInputElement>) => {
          const { value: year, validity } = e.currentTarget;
          const month = (monthFieldRef.current as HTMLSelectElement).value;
          if (!validity.valid || !checkValidity(month, year)) {
            // JS original `return { value: '', validity: { valid: false } }`
            // here, but the return value of an `onInput` handler is discarded;
            // preserve the early-exit behavior without the dead object.
            return;
          }
          onInput({
            value: year ? `${year}-${month}` : '',
            validity: {
              valid: true,
            },
          });
        }}
        style={{
          width: '4.5em',
        }}
      />
    </div>
  );
}

function fetchAccount(id: string, masto: MastoClient): Promise<Account> {
  const accountsResource =
    getMastoV1Resource<mastodon.rest.v1.AccountsResource>(masto, 'accounts');
  return accountsResource.$select(id).fetch();
}
const memFetchAccount = pmem(fetchAccount, {
  expires: 30 * 60 * 1000, // 30 minutes
});

export default AccountStatuses;

import './account-statuses.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import { toUnicode as punycodeToUnicode } from 'punycode/';
import type { SyntheticEvent } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import AccountInfo, { type AccountInfoShape } from '../components/account-info';
import AccountInfoMini from '../components/account-info-mini';
import EmojiText from '../components/emoji-text';
import Icon from '../components/icon';
import Link from '../components/link';
import Menu2 from '../components/menu2';
import ProfileFeed from '../components/profile-feed';
import { useAccountStatusesFeed } from '../data/feeds';
import type { FeedFilter } from '../data/keys';
import {
  api,
  getMastoV1Resource,
  type MastoClient,
} from '../utils/api';
import {
  getAtprotoRepo,
  isAtprotoProfileURI,
  maybeDecodeAtprotoURI,
} from '../utils/atproto-route';
import isSearchEnabled from '../utils/is-search-enabled';
import mem from '../utils/mem';
import pmem from '../utils/pmem';
import { navigatePath } from '../utils/router';
import showToast from '../utils/show-toast';
import { sorted } from '../utils/sorted';
import states from '../utils/states';
import { getCurrentAccountID } from '../utils/store-utils';

type Account = mastodon.v1.Account;
type FeaturedTag = mastodon.v1.FeaturedTag;

interface AccountStatusesProps {
  columnMode?: boolean;
  id?: string;
  instance?: string;
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

const MIN_YEAR = 1983;
const MIN_YEAR_MONTH = `${MIN_YEAR}-01`; // Birth of the Internet

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
  const id = columnMode ? props.id : props.id || routeParams.id;
  const atprotoProfileUri = maybeDecodeAtprotoURI(id);
  const actorId =
    isAtprotoProfileURI(atprotoProfileUri)
      ? (getAtprotoRepo(atprotoProfileUri) ?? id)
      : id;
  const params = columnMode
    ? { instance: props.instance }
    : { instance: props.instance || routeParams.instance };

  // `URLSearchParams` accepts `Record<string, string>`; the JS `{ replies: 1 }`
  // is coerced to "1" at runtime — preserve via string init.
  const profileSearchParamsRef = useRef(new URLSearchParams({ replies: '1' }));
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);
  const profileSetSearchParams = useCallback<SearchParamsSetter>((objOrFn) => {
    const localParams = profileSearchParamsRef.current;
    if (typeof objOrFn === 'function') {
      objOrFn(localParams);
    } else if (objOrFn instanceof URLSearchParams) {
      [...localParams.keys()].forEach((key) => {
        localParams.delete(key);
      });
      objOrFn.forEach((value, key) => {
        localParams.set(key, value);
      });
    } else {
      applySearchParamsObject(localParams, objOrFn);
    }
    forceUpdate();
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

  const [account, setAccount] = useState<Account | undefined>();

  const mediaFirst = false;

  const profileFilter = useMemo((): FeedFilter | undefined => {
    if (month || tagged) return undefined;
    if (media) return 'media';
    if (excludeReplies) return 'posts';
    return 'posts-and-replies';
  }, [month, tagged, media, excludeReplies]);

  const waitForAccountHandle = Boolean((month || tagged) && !account?.acct);
  const feedSource = useAccountStatusesFeed({
    actor: waitForAccountHandle ? undefined : actorId,
    acct: account?.acct,
    filter: profileFilter,
    month,
    tagged,
    excludeBoosts,
    media,
  });

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

  const [featuredTags, setFeaturedTags] = useState<FeaturedTag[]>([]);
  const accountFetchKeyRef = useRef<string | null>(null);

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

  const refetchAccount = useCallback(() => {
    return memFetchAccount(actorId as string, masto);
  }, [actorId, masto]);

  useEffect(() => {
    if (!actorId) return;
    const accountFetchKey = `${actorId}@${instance}`;
    if (accountFetchKeyRef.current === accountFetchKey) return;
    accountFetchKeyRef.current = accountFetchKey;
    const accountsResource =
      getMastoV1Resource<mastodon.rest.v1.AccountsResource>(masto, 'accounts');
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
            .$select(actorId)
            .featuredTags.list();
          console.log({ fetchedFeaturedTags });
          setFeaturedTags(fetchedFeaturedTags);
        } catch (e) {
          console.error(e);
        }
      }
    })();
  }, [actorId, instance, mediaFirst, refetchAccount, masto]);

  const { displayName, acct } = account || ({} as Partial<Account>);

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
            account={
              account ??
              (isAccountInfoShape(cachedAccount) ? cachedAccount : undefined)
            }
            fetchAccount={account ? refetchAccount : undefined}
            authenticated={authenticated}
            standalone
          />
        )}
        {!mediaFirst && (
          <div
            className="filter-bar"
            ref={filterBarRef}
            style={{
              position: 'relative',
            }}
          >
            {filtered ? (
              <Link
                to={`/${instance}/a/${id}`}
                className="insignificant filter-clear"
                title={t`Reset filters`}
                key="clear-filters"
                onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
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
                className="insignificant"
                size="l"
                alt={t`Filters`}
              />
            )}
            <div className="filter-bar-group">
              <label>
                <input
                  aria-label={t`Replies`}
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
                  aria-label={t`Reposts`}
                  type="checkbox"
                  checked={!excludeBoosts}
                  disabled={!!month}
                  onChange={() => {
                    toggleParam('boosts', '0');
                    if (excludeBoosts) {
                      showToast(t`Showing reposts`);
                    } else {
                      showToast(t`Hiding reposts`);
                    }
                  }}
                />
                <Trans>Reposts</Trans>
              </label>
            </div>
            <Link
              to={`/${instance}/a/${id}${buildParamStr({
                media: media ? null : '1',
              })}`}
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                if (columnMode) {
                  e.preventDefault();
                  toggleParam('media', '1');
                }
                if (!media) {
                  showToast(t`Showing posts with media`);
                }
              }}
              className={media ? 'is-active' : ''}
            >
              <Trans>Media</Trans>
            </Link>
            {featuredTags.length > 0 && (
              <div className="filter-bar-group">
                {sorted(featuredTags, (a, b) => {
                  if (a.name === tagged) return -1;
                  if (b.name === tagged) return 1;
                  return 0;
                }).map((tag) => (
                  <Link
                    key={tag.id}
                    to={`/${instance}/a/${id}${buildParamStr({
                      tagged: tagged === tag.name ? null : tag.name,
                    })}`}
                    onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
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
                    className={tagged === tag.name ? 'is-active' : ''}
                  >
                    <span>
                      <span className="more-insignificant">#</span>
                      {tag.name}
                    </span>
                    {/* <span className="filter-count">{tag.statusesCount}</span> */}
                  </Link>
                ))}
              </div>
            )}
            {searchEnabled && !columnMode && (
              <>
                <div className="filter-bar-separator" />
                {supportsInputMonth() ? (
                  <label className={`filter-field ${month ? 'is-active' : ''}`}>
                    <Icon icon="month" size="l" />
                    <input
                      aria-label={t`Month`}
                      type="month"
                      disabled={!account?.acct}
                      value={month || ''}
                      min={MIN_YEAR_MONTH}
                      max={new Date().toISOString().slice(0, 7)}
                      onInput={(e: SyntheticEvent<HTMLInputElement>) => {
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
                    className={`filter-field ${month ? 'is-active' : ''}`}
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
                  className="filter-field"
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
      <ProfileFeed
        key={id}
        actor={id}
        filter={profileFilter}
        source={feedSource}
        title={title}
        path={['/:instance/a/:id', '/a/:id', '/:scheme://*', '/:atUri']}
        titleComponent={
          <h1
            className="header-double-lines header-account"
          >
            <b>
              <EmojiText text={displayName} />
            </b>
            <div>
              <span className="bidi-isolate">@{acct}</span>
            </div>
          </h1>
        }
        id="account-statuses"
        emptyText={t`Nothing to see here yet.`}
        errorText={t`Unable to load posts`}
        timelineStart={TimelineStart}
        headerEnd={
          <Menu2
            portal
            // setDownOverflow
            overflow="auto"
            viewScroll="close"
            position="anchor"
            menuButton={
              <button type="button" className="plain">
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
                    navigatePath(`/${accountInstance}/a/${lookupId}`);
                  } catch (e) {
                    console.error(e);
                    alert(t`Unable to fetch account info`);
                  }
                })();
              }}
            >
              <Icon icon="transfer" />{' '}
              <small className="menu-double-lines">
                <Trans>
                  Switch to account's PDS{' '}
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
                      navigatePath(`/${currentInstance}/a/${lookupId}`);
                    } catch (e) {
                      console.error(e);
                      alert(t`Unable to fetch account info`);
                    }
                  })();
                }}
              >
                <Icon icon="transfer" />{' '}
                <small className="menu-double-lines">
                  <Trans>
                    Switch to my PDS (<b>{currentInstance}</b>)
                  </Trans>
                </small>
              </MenuItem>
            )}
          </Menu2>
        }
      />
      {acct && !isSelf && (
        <data
          className="compose-data"
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
  className?: string;
  disabled?: boolean;
  value?: string;
  min?: string;
  max?: string;
  onInput?: (payload: MonthPickerChangePayload) => void;
}

function MonthPicker(props: MonthPickerProps) {
  const { i18n, t } = useLingui();
  const {
    class: classProp,
    className = classProp,
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
    <div className={className}>
      <Icon icon="month" size="l" />
      <select
        aria-label={t`Month`}
        ref={monthFieldRef}
        disabled={disabled}
        value={_month || ''}
        onInput={(e: SyntheticEvent<HTMLSelectElement>) => {
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
        aria-label={t`Year`}
        ref={yearFieldRef}
        type="number"
        disabled={disabled}
        value={_year || new Date().getFullYear()}
        min={min?.slice(0, 4) || MIN_YEAR}
        max={max?.slice(0, 4) || new Date().getFullYear()}
        onInput={(e: SyntheticEvent<HTMLInputElement>) => {
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

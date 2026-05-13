import './account-info.css';

import { msg, plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'preact/hooks';

import { api } from '../utils/api';
import enhanceContent from '../utils/enhance-content';
import getDomain from '../utils/get-domain';
import handleContentLinks from '../utils/handle-content-links';
import niceDateTime from '../utils/nice-date-time';
import pmem from '../utils/pmem';
import { supportsNativeQuote } from '../utils/quote-utils';
import shortenNumber from '../utils/shorten-number';
import showToast from '../utils/show-toast';
import states, { hideAllModals } from '../utils/states';
import {
  getAccounts,
  getCurrentAccountID,
  saveAccounts,
} from '../utils/store-utils';
import supports from '../utils/supports';

import AccountBlockUntyped from './account-block';
import AccountHandleInfo from './account-handle-info';
import Avatar from './avatar';
import EditProfileSheetUntyped from './edit-profile-sheet';
import EmojiText from './emoji-text';
import Endorsements from './endorsements';
import Icon from './icon';
import Link from './link';
import Menu2 from './menu2';
import Modal from './modal';
import RelatedActions from './related-actions';

// Augmented Account shape used internally. Adds optional fields the app
// reads but the masto.v1.Account base does not declare: `_atproto` cache
// flag, `hideCollections` (Mastodon API extension surfaced by some forks),
// `roles` (server-specific), and `avatarDescription` /
// `headerDescription` (Mastodon 4.x media alt-text extensions).
export type AccountInfoShape = mastodon.v1.Account & {
  _atproto?: { hasProfileCounts?: boolean } & Record<string, unknown>;
  hideCollections?: boolean | null;
  roles?: ReadonlyArray<{ name?: string } & Record<string, unknown>>;
  avatarDescription?: string;
  headerDescription?: string;
};

// Endpoint shims for masto APIs reached through the loose ApiClient.masto
// shape. The runtime client supports `accounts.$select(id).{statuses,
// followers, following}` and `accounts.familiarFollowers.fetch(...)`; the
// declared MastoClient in utils/api.ts intentionally leaves these as
// `unknown`. We narrow locally rather than widening the shared interface.
interface FamiliarFollowersEndpoint {
  fetch(params: { id: readonly string[] }): Promise<mastodon.v1.FamiliarFollowers[]>;
}
interface AccountStatusesListParams {
  limit?: number;
  [key: string]: unknown;
}
interface AccountStatusesEndpoint {
  list(params: AccountStatusesListParams): {
    values(): AsyncIterator<mastodon.v1.Status[]>;
  };
}
interface AccountFollowersListParams {
  limit?: number;
  [key: string]: unknown;
}
interface AccountFollowersEndpoint {
  list(params: AccountFollowersListParams): {
    values(): AsyncIterator<mastodon.v1.Account[]>;
  };
}
interface AccountSelectEndpoint {
  statuses: AccountStatusesEndpoint;
  followers: AccountFollowersEndpoint;
  following: AccountFollowersEndpoint;
}
interface AccountsEndpoint {
  $select(id: string): AccountSelectEndpoint;
  familiarFollowers: FamiliarFollowersEndpoint;
}

interface MastoLike {
  v1: { accounts: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

function getAccountsEndpoint(masto: MastoLike): AccountsEndpoint {
  return masto.v1.accounts as unknown as AccountsEndpoint;
}

// Shims for still-untyped peer components. Removed when each peer
// converts to TypeScript in a later wave.
interface AccountBlockProps {
  account?: AccountInfoShape | mastodon.v1.Account | null;
  instance?: string;
  avatarSize?: string;
  avatarDescription?: string;
  skeleton?: boolean;
  internal?: boolean;
  onClick?: (e: Event) => void;
}
const AccountBlock =
  AccountBlockUntyped as unknown as ComponentType<AccountBlockProps>;

interface EditProfileSheetCloseArg {
  state?: string;
  account?: AccountInfoShape;
}
interface EditProfileSheetProps {
  onClose?: (arg?: EditProfileSheetCloseArg) => void;
}
const EditProfileSheet =
  EditProfileSheetUntyped as unknown as ComponentType<EditProfileSheetProps>;

// Posting stats are derived locally. `daysSinceLastPost` is conditionally
// set inside fetchPostingStats — keep it optional in the type.
interface PostingStats {
  total: number;
  originals: number;
  replies: number;
  boosts: number;
  quotes: number;
  daysSinceLastPost?: number;
}

// `info` updates may carry payload state for the app's flows. The QR/avatar
// modal entries assign `unknown`-typed valtio state, mirrored locally.
interface AccountIterPage {
  value: mastodon.v1.Account[] | undefined;
  done?: boolean;
}

const LIMIT = 80;

const ACCOUNT_INFO_MAX_AGE = 1000 * 60 * 10; // 10 mins

function fetchFamiliarFollowers(
  currentID: string,
  masto: MastoLike,
): Promise<mastodon.v1.FamiliarFollowers[]> {
  return getAccountsEndpoint(masto).familiarFollowers.fetch({
    id: [currentID],
  });
}
const memFetchFamiliarFollowers = pmem(fetchFamiliarFollowers, {
  expires: ACCOUNT_INFO_MAX_AGE,
});

async function fetchPostingStats(
  accountID: string,
  masto: MastoLike,
): Promise<PostingStats> {
  const fetchStatuses = getAccountsEndpoint(masto)
    .$select(accountID)
    .statuses.list({
      limit: 20,
    })
    .values()
    .next();

  const { value: statuses } = (await fetchStatuses) as {
    value: mastodon.v1.Status[];
  };
  console.log('fetched statuses', statuses);
  const stats: PostingStats = {
    total: statuses.length,
    originals: 0,
    replies: 0,
    boosts: 0,
    quotes: 0,
  };
  // Categories statuses by type
  // - Original posts (not replies to others)
  // - Threads (self-replies + 1st original post)
  // - Boosts (reblogs)
  // - Replies (not-self replies)
  // - Quotes
  // Some Mastodon forks (and Bluepy's quote-utils helper) attach a
  // non-standard `quote` field on Status. Narrow with a local shape rather
  // than widening the masto type.
  type StatusWithQuote = mastodon.v1.Status & {
    quote?: {
      id?: string;
      quotedStatus?: { id?: string } | null;
    } | null;
  };
  statuses.forEach((status: StatusWithQuote) => {
    if (status.reblog) {
      stats.boosts++;
    } else if (
      !!status.inReplyToId &&
      status.inReplyToAccountId !== status.account.id // Not self-reply
    ) {
      stats.replies++;
    } else if (
      supportsNativeQuote() &&
      (status.quote?.id || status.quote?.quotedStatus?.id)
    ) {
      stats.quotes++;
    } else {
      stats.originals++;
    }
  });

  // Count days since last post
  if (statuses.length) {
    stats.daysSinceLastPost = Math.ceil(
      (Date.now() - Date.parse(statuses[statuses.length - 1].createdAt)) /
        86400000,
    );
  }

  console.log('posting stats', stats);
  return stats;
}
const memFetchPostingStats = pmem(fetchPostingStats, {
  expires: ACCOUNT_INFO_MAX_AGE,
});

const isValidUrl = (string: string): boolean => {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
};
export const handleScannerClick = (): void => {
  states.showQrScannerModal = {
    checkValidity: isValidUrl,
    actionableText: msg`View profile`,
    onClose: ({ text }: { text?: string } = {}) => {
      if (text) {
        hideAllModals();
        location.hash = `/${text}`;
      }
    },
  };
};

type UIState = 'default' | 'loading' | 'error';

interface AccountInfoProps {
  account: AccountInfoShape | string | null | undefined;
  fetchAccount?: () => Promise<AccountInfoShape | undefined> | void;
  standalone?: boolean;
  instance?: string;
  authenticated?: boolean;
  showEndorsements?: boolean;
}

function AccountInfo({
  account,
  fetchAccount = () => {},
  standalone,
  instance,
  authenticated,
  showEndorsements = false,
}: AccountInfoProps) {
  const { i18n, t } = useLingui();
  const { masto, authenticated: currentAuthenticated } = api({
    instance,
  });
  const { masto: currentMasto, instance: currentInstance } = api();
  const [uiState, setUIState] = useState<UIState>('default');
  const isString = typeof account === 'string';
  const [info, setInfo] = useState<AccountInfoShape | null>(
    isString ? null : (account ?? null),
  );
  const [reloadCount, reload] = useReducer((c: number) => c + 1, 0);

  const sameCurrentInstance = useMemo(
    () => instance === currentInstance,
    [instance, currentInstance],
  );

  useEffect(() => {
    if (!isString) {
      setInfo(account ?? null);
      if (account?._atproto?.hasProfileCounts !== false) return;
    }
    setUIState('loading');
    (async () => {
      try {
        const result = await fetchAccount();
        if (!result) {
          if (isString) setInfo(null);
          setUIState('error');
          return;
        }
        states.accounts[`${result.id}@${instance}`] =
          result as unknown as Record<string, unknown>;
        setInfo(result);
        setUIState('default');
      } catch (e) {
        console.error(e);
        if (isString) setInfo(null);
        setUIState('error');
      }
    })();
  }, [isString, account, fetchAccount, reloadCount]);

  // `info` may be null while loading; fall back to an empty placeholder so
  // the destructure stays terse. All consumers below already guard with
  // `!!` or optional chaining before using the values, mirroring the JS
  // original. The cast keeps the inner field types non-optional so call
  // sites that need numbers (Plural, shortenNumber) don't have to invent
  // fallback values that would change message-extraction output.
  const infoFields = (info ?? ({} as AccountInfoShape)) as AccountInfoShape;
  const {
    acct,
    avatar,
    avatarStatic,
    avatarDescription,
    bot,
    createdAt,
    displayName,
    emojis,
    fields,
    followersCount,
    followingCount,
    group,
    // header,
    // headerStatic,
    headerDescription,
    id,
    lastStatusAt,
    locked,
    note,
    statusesCount,
    url,
    username,
    memorial,
    moved,
    roles,
    hideCollections,
  } = infoFields;
  let headerIsAvatar = false;
  let { header, headerStatic } = infoFields;
  if (!header || /missing\.png$/.test(header)) {
    if (avatar && !/missing\.png$/.test(avatar)) {
      header = avatar;
      headerIsAvatar = true;
      if (avatarStatic && !/missing\.png$/.test(avatarStatic)) {
        headerStatic = avatarStatic;
      }
    }
  }

  const isSelf = useMemo(() => id === getCurrentAccountID(), [id]);

  useEffect(() => {
    const infoHasEssentials = !!(
      info?.id &&
      info?.username &&
      info?.acct &&
      info?.avatar &&
      info?.avatarStatic &&
      info?.displayName &&
      info?.url
    );
    if (info && isSelf && instance && infoHasEssentials) {
      const accounts = getAccounts();
      let updated = false;
      accounts.forEach((account) => {
        if (account.info.id === info.id && account.instanceURL === instance) {
          account.info = info as unknown as typeof account.info;
          updated = true;
        }
      });
      if (updated) {
        console.log('Updated account info', info);
        saveAccounts(accounts);
      }
    }
  }, [isSelf, info, instance]);

  const accountInstance = getDomain(url ?? '');

  const [headerCornerColors, setHeaderCornerColors] = useState<string[]>([]);

  const followersIterator = useRef<
    AsyncIterator<mastodon.v1.Account[]> | undefined
  >(undefined);
  const familiarFollowersCache = useRef<mastodon.v1.Account[]>([]);
  async function fetchFollowers(
    firstLoad?: boolean,
  ): Promise<AccountIterPage | IteratorResult<mastodon.v1.Account[]>> {
    if (!id) return { value: undefined, done: true };
    const accountsEndpoint = getAccountsEndpoint(masto as unknown as MastoLike);
    if (firstLoad || !followersIterator.current) {
      followersIterator.current = accountsEndpoint
        .$select(id)
        .followers.list({
          limit: LIMIT,
        })
        .values();
    }
    const results = await followersIterator.current.next();
    if (isSelf) return results;
    if (!sameCurrentInstance) return results;

    const { value } = results;
    let newValue: mastodon.v1.Account[] = [];
    // On first load, fetch familiar followers, merge to top of results' `value`
    // Remove dups on every fetch
    if (firstLoad) {
      let familiarFollowers: mastodon.v1.FamiliarFollowers[] = [];
      try {
        familiarFollowers = await accountsEndpoint.familiarFollowers.fetch({
          id: [id],
        });
      } catch (e) {}
      familiarFollowersCache.current = familiarFollowers?.[0]?.accounts || [];
      newValue = [
        ...familiarFollowersCache.current,
        ...((value ?? []) as mastodon.v1.Account[]).filter(
          (account) =>
            !familiarFollowersCache.current.some(
              (familiar) => familiar.id === account.id,
            ),
        ),
      ];
    } else if (value?.length) {
      newValue = (value as mastodon.v1.Account[]).filter(
        (account) =>
          !familiarFollowersCache.current.some(
            (familiar) => familiar.id === account.id,
          ),
      );
    }

    return {
      ...results,
      value: newValue,
    };
  }

  const followingIterator = useRef<
    AsyncIterator<mastodon.v1.Account[]> | undefined
  >(undefined);
  async function fetchFollowing(
    firstLoad?: boolean,
  ): Promise<AccountIterPage | IteratorResult<mastodon.v1.Account[]>> {
    if (!id) return { value: undefined, done: true };
    const accountsEndpoint = getAccountsEndpoint(masto as unknown as MastoLike);
    if (firstLoad || !followingIterator.current) {
      followingIterator.current = accountsEndpoint
        .$select(id)
        .following.list({
          limit: LIMIT,
        })
        .values();
    }
    const results = await followingIterator.current.next();
    return results;
  }

  const LinkOrDiv: ComponentType<Record<string, unknown>> | 'div' = standalone
    ? 'div'
    : (Link as unknown as ComponentType<Record<string, unknown>>);
  const accountLink = instance ? `/${instance}/a/${id}` : `/a/${id}`;

  const [familiarFollowers, setFamiliarFollowers] = useState<
    mastodon.v1.Account[]
  >([]);
  const [postingStats, setPostingStats] = useState<PostingStats | undefined>();
  const [postingStatsUIState, setPostingStatsUIState] =
    useState<UIState>('default');
  const hasPostingStats = !!postingStats?.total;

  const renderFamiliarFollowers = async (currentID: string): Promise<void> => {
    try {
      const followers = await memFetchFamiliarFollowers(
        currentID,
        currentMasto as unknown as MastoLike,
      );
      console.log('fetched familiar followers', followers);
      setFamiliarFollowers(
        followers[0].accounts.slice(0, FAMILIAR_FOLLOWERS_LIMIT),
      );
    } catch (e) {
      console.error(e);
    }
  };

  const renderPostingStats = async () => {
    if (!id) return;
    setPostingStatsUIState('loading');
    try {
      const stats = await memFetchPostingStats(
        id,
        masto as unknown as MastoLike,
      );
      setPostingStats(stats);
      setPostingStatsUIState('default');
    } catch (e) {
      console.error(e);
      setPostingStatsUIState('error');
    }
  };

  const onRelationshipChange = useCallback(
    ({
      relationship,
      currentID,
    }: {
      relationship: mastodon.v1.Relationship;
      currentID: string;
    }) => {
      if (!relationship.following) {
        renderFamiliarFollowers(currentID);
        if (!standalone && statusesCount > 0) {
          // Only render posting stats if not standalone and has posts
          renderPostingStats();
        }
      }
    },
    [standalone, id, statusesCount],
  );

  const onProfileUpdate = useCallback(
    (newAccount: AccountInfoShape) => {
      if (newAccount.id === id) {
        console.log('Updated account info', newAccount);
        setInfo(newAccount);
        states.accounts[`${newAccount.id}@${instance}`] =
          newAccount as unknown as Record<string, unknown>;
      }
    },
    [id, instance],
  );

  const isStringURL = isString && account && /^https?:\/\//.test(account);

  const [showEditProfile, setShowEditProfile] = useState(false);

  const [renderEndorsements, setRenderEndorsements] = useState<
    boolean | string
  >(false);

  return (
    <>
      <div
        tabIndex={-1}
        class={`account-container ${uiState === 'loading' ? 'skeleton' : ''}`}
        style={
          {
            '--header-color-1': headerCornerColors[0],
            '--header-color-2': headerCornerColors[1],
            '--header-color-3': headerCornerColors[2],
            '--header-color-4': headerCornerColors[3],
          } as Record<string, string | undefined>
        }
      >
        {uiState === 'error' && (
          <div class="ui-state">
            <p>
              <Trans>Unable to load account.</Trans>
            </p>
            {isString ? (
              <p>
                {isStringURL ? (
                  <a href={account} target="_blank" rel="noopener">
                    {account}
                  </a>
                ) : (
                  <code class="insignificant">{account}</code>
                )}
              </p>
            ) : (
              <p>
                <a href={url} target="_blank" rel="noopener">
                  <Trans>Go to account page</Trans> <Icon icon="external" />
                </a>
              </p>
            )}
            {isString && (
              <button type="button" onClick={reload}>
                <Trans>Try again</Trans>
              </button>
            )}
          </div>
        )}
        {uiState === 'loading' ? (
          <>
            <header>
              <AccountBlock avatarSize="xxxl" skeleton />
            </header>
            <main>
              <div class="note">
                <p>███████ ████ ████</p>
                <p>████ ████████ ██████ █████████ ████ ██</p>
              </div>
              <div class="account-metadata-box">
                <div class="profile-metadata">
                  <div class="profile-field">
                    <b class="more-insignificant">███</b>
                    <p>██████</p>
                  </div>
                  <div class="profile-field">
                    <b class="more-insignificant">████</b>
                    <p>███████████</p>
                  </div>
                </div>
                <div class="stats">
                  <div>
                    <span>██</span> ██████
                  </div>
                  <div>
                    <span>██</span> ██████
                  </div>
                  <div>
                    <span>██</span> █████
                  </div>
                </div>
              </div>
              <div class="actions">
                <span />
                <span class="buttons">
                  <button type="button" class="plain4" disabled>
                    <Icon icon="more2" size="l" />
                  </button>
                </span>
              </div>
            </main>
          </>
        ) : (
          info && (
            <>
              {!!moved && (
                <div class="account-moved">
                  <p>
                    <Trans>
                      <b>{displayName}</b> has indicated that their new account
                      is now:
                    </Trans>
                  </p>
                  <AccountBlock
                    account={moved}
                    instance={instance}
                    onClick={(e) => {
                      e.stopPropagation();
                      states.showAccount = moved;
                    }}
                  />
                </div>
              )}
              {!!header && !/missing\.png$/.test(header) && (
                <img
                  src={header}
                  alt={headerDescription || ''}
                  class={`header-banner ${
                    headerIsAvatar ? 'header-is-avatar' : ''
                  }`}
                  onError={(e) => {
                    const img = e.target as HTMLImageElement | null;
                    if (!img) return;
                    if (img.crossOrigin) {
                      if (img.src !== headerStatic) {
                        if (headerStatic) img.src = headerStatic;
                      } else {
                        img.removeAttribute('crossorigin');
                        if (header) img.src = header;
                      }
                    } else if (img.src !== headerStatic) {
                      if (headerStatic) img.src = headerStatic;
                    } else {
                      img.remove();
                    }
                  }}
                  crossOrigin={
                    /\/\/cdn\.bsky\.app\//.test(header)
                      ? undefined
                      : 'anonymous'
                  }
                  onLoad={(e) => {
                    const img = e.target as HTMLImageElement | null;
                    if (!img) return;
                    img.classList.add('loaded');
                    const { width, height } = img;
                    // 25px per second (rough estimate)
                    // Clamp between 10s and 120s
                    img.style.setProperty(
                      '--anim-duration',
                      `${Math.min(
                        Math.max(Math.max(width, height) / 25, 10),
                        120,
                      )}s`,
                    );
                    try {
                      // Get color from four corners of image
                      const canvas: OffscreenCanvas | HTMLCanvasElement = window
                        .OffscreenCanvas
                        ? new OffscreenCanvas(1, 1)
                        : document.createElement('canvas');
                      const ctx = canvas.getContext('2d', {
                        willReadFrequently: true,
                      }) as
                        | CanvasRenderingContext2D
                        | OffscreenCanvasRenderingContext2D
                        | null;
                      if (!ctx) return;
                      canvas.width = width;
                      canvas.height = height;
                      ctx.imageSmoothingEnabled = false;
                      ctx.drawImage(img, 0, 0);
                      // const colors = [
                      //   ctx.getImageData(0, 0, 1, 1).data,
                      //   ctx.getImageData(e.target.width - 1, 0, 1, 1).data,
                      //   ctx.getImageData(0, e.target.height - 1, 1, 1).data,
                      //   ctx.getImageData(
                      //     e.target.width - 1,
                      //     e.target.height - 1,
                      //     1,
                      //     1,
                      //   ).data,
                      // ];
                      // Get 10x10 pixels from corners, get average color from each
                      const pixelDimension = 10;
                      const colors: number[][] = [
                        ctx.getImageData(0, 0, pixelDimension, pixelDimension)
                          .data,
                        ctx.getImageData(
                          img.width - pixelDimension,
                          0,
                          pixelDimension,
                          pixelDimension,
                        ).data,
                        ctx.getImageData(
                          0,
                          img.height - pixelDimension,
                          pixelDimension,
                          pixelDimension,
                        ).data,
                        ctx.getImageData(
                          img.width - pixelDimension,
                          img.height - pixelDimension,
                          pixelDimension,
                          pixelDimension,
                        ).data,
                      ].map((data) => {
                        let r = 0;
                        let g = 0;
                        let b = 0;
                        let a = 0;
                        for (let i = 0; i < data.length; i += 4) {
                          r += data[i];
                          g += data[i + 1];
                          b += data[i + 2];
                          a += data[i + 3];
                        }
                        const dataLength = data.length / 4;
                        return [
                          r / dataLength,
                          g / dataLength,
                          b / dataLength,
                          a / dataLength,
                        ];
                      });
                      const rgbColors = colors.map((color) => {
                        const [r, g, b, a] = lightenRGB(color);
                        return `rgba(${r}, ${g}, ${b}, ${a})`;
                      });
                      setHeaderCornerColors(rgbColors);
                      console.log({ colors, rgbColors });
                    } catch (e) {
                      // Silently fail
                    }
                  }}
                />
              )}
              <header>
                {standalone ? (
                  <Menu2
                    shift={
                      window.matchMedia('(min-width: calc(40em))').matches
                        ? 114
                        : 64
                    }
                    menuButton={
                      <div>
                        <AccountBlock
                          account={info}
                          instance={instance}
                          avatarSize="xxxl"
                          avatarDescription={avatarDescription}
                          onClick={() => {}}
                        />
                      </div>
                    }
                  >
                    <div class="szh-menu__header">
                      <AccountHandleInfo acct={acct ?? ''} instance={instance} />
                    </div>
                    <MenuItem
                      onClick={() => {
                        const acctSafe = acct ?? '';
                        const handleWithInstance = acctSafe.includes('@')
                          ? `@${acctSafe}`
                          : `@${acctSafe}@${instance}`;
                        try {
                          navigator.clipboard.writeText(handleWithInstance);
                          showToast(t`Handle copied`);
                        } catch (e) {
                          console.error(e);
                          showToast(t`Unable to copy handle`);
                        }
                      }}
                    >
                      <Icon icon="link" />
                      <span>
                        <Trans>Copy handle</Trans>
                      </span>
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        states.showQrCodeModal = {
                          text: url,
                          arena: avatarStatic,
                          backgroundMask: headerStatic,
                          caption: (acct ?? '').includes('@')
                            ? acct
                            : `${acct ?? ''}@${instance}`,
                          onScannerClick: handleScannerClick,
                        };
                      }}
                    >
                      <Icon icon="qrcode" />
                      <span>
                        <Trans>QR code</Trans>
                      </span>
                    </MenuItem>
                    <MenuItem href={url} target="_blank">
                      <Icon icon="external" />
                      <span>
                        <Trans>Go to original profile page</Trans>
                      </span>
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      onClick={() => {
                        states.showMediaModal = {
                          mediaAttachments: [
                            {
                              type: 'image',
                              url: avatarStatic,
                              description: avatarDescription,
                            },
                          ],
                        };
                      }}
                    >
                      <Icon icon="user" />
                      <span>
                        <Trans>View profile image</Trans>
                      </span>
                    </MenuItem>
                    {!!headerStatic && !headerIsAvatar && (
                      <MenuItem
                        onClick={() => {
                          states.showMediaModal = {
                            mediaAttachments: [
                              {
                                type: 'image',
                                url: headerStatic,
                                description: headerDescription,
                              },
                            ],
                          };
                        }}
                      >
                        <Icon icon="media" />
                        <span>
                          <Trans>View profile header</Trans>
                        </span>
                      </MenuItem>
                    )}
                    {currentAuthenticated &&
                      isSelf &&
                      supports('@mastodon/profile-edit') && (
                        <>
                          <MenuDivider />
                          <MenuItem
                            onClick={() => {
                              setShowEditProfile(true);
                            }}
                          >
                            <Icon icon="pencil" />
                            <span>
                              <Trans>Edit profile</Trans>
                            </span>
                          </MenuItem>
                        </>
                      )}
                  </Menu2>
                ) : (
                  <AccountBlock
                    account={info}
                    instance={instance}
                    avatarSize="xxxl"
                    internal
                  />
                )}
              </header>
              <div class="faux-header-bg" aria-hidden="true" />
              <main>
                {!!memorial && (
                  <span class="tag">
                    <Trans>In Memoriam</Trans>
                  </span>
                )}
                {!!bot && (
                  <span class="tag">
                    <Icon icon="bot" /> <Trans>Automated</Trans>
                  </span>
                )}
                {!!group && (
                  <span class="tag">
                    <Icon icon="group" /> <Trans>Group</Trans>
                  </span>
                )}
                {/* {roles?.map((role) => (
                  <span class="tag">
                    {role.name}
                    {!!accountInstance && (
                      <>
                        {' '}
                        <span class="more-insignificant">
                          {accountInstance}
                        </span>
                      </>
                    )}
                  </span>
                ))} */}
                <div
                  class="note"
                  dir="auto"
                  onClick={handleContentLinks({
                    instance: currentInstance,
                  })}
                  dangerouslySetInnerHTML={{
                    __html: enhanceContent(note, { emojis }) as string,
                  }}
                />
                <div class="account-metadata-box">
                  {!!fields?.length && (
                    <div class="profile-metadata">
                      {fields.map(({ name, value, verifiedAt }, i) => (
                        <div
                          class={`profile-field ${
                            verifiedAt ? 'profile-verified' : ''
                          }`}
                          key={name + i}
                          dir="auto"
                        >
                          <b>
                            <EmojiText text={name} emojis={emojis} />{' '}
                            {!!verifiedAt && (
                              <Icon
                                icon="check-circle"
                                size="s"
                                alt={t`Verified`}
                              />
                            )}
                          </b>
                          <p
                            dangerouslySetInnerHTML={{
                              __html: enhanceContent(value, { emojis }) as string,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div class="stats">
                    <LinkOrDiv
                      tabIndex={0}
                      to={accountLink}
                      onClick={() => {
                        // states.showAccount = false;
                        setTimeout(() => {
                          states.showGenericAccounts = {
                            id: 'followers',
                            heading: t`Followers`,
                            fetchAccounts: fetchFollowers,
                            instance,
                            excludeRelationshipAttrs: isSelf
                              ? ['followedBy']
                              : [],
                            blankCopy: hideCollections
                              ? t`This user has chosen to not make this information available.`
                              : undefined,
                          };
                        }, 0);
                      }}
                    >
                      {!!familiarFollowers.length && (
                        <span class="shazam-container-horizontal">
                          <span class="shazam-container-inner stats-avatars-bunch">
                            {familiarFollowers.map((follower) => (
                              <Avatar
                                url={follower.avatarStatic}
                                size="s"
                                alt={`${follower.displayName} @${follower.acct}`}
                                squircle={follower?.bot}
                              />
                            ))}
                          </span>
                        </span>
                      )}
                      <Plural
                        value={followersCount}
                        one={
                          <Trans>
                            <span title={String(followersCount)}>
                              {shortenNumber(followersCount)}
                            </span>{' '}
                            Follower
                          </Trans>
                        }
                        other={
                          <Trans>
                            <span title={String(followersCount)}>
                              {shortenNumber(followersCount)}
                            </span>{' '}
                            Followers
                          </Trans>
                        }
                      />
                    </LinkOrDiv>
                    <LinkOrDiv
                      class="insignificant"
                      tabIndex={0}
                      to={accountLink}
                      onClick={() => {
                        // states.showAccount = false;
                        setTimeout(() => {
                          states.showGenericAccounts = {
                            heading: t({
                              id: 'following.stats',
                              message: 'Following',
                            }),
                            fetchAccounts: fetchFollowing,
                            instance,
                            excludeRelationshipAttrs: isSelf
                              ? ['following']
                              : [],
                            blankCopy: hideCollections
                              ? t`This user has chosen to not make this information available.`
                              : undefined,
                          };
                        }, 0);
                      }}
                    >
                      <Plural
                        value={followingCount}
                        other={
                          <Trans>
                            <span title={String(followingCount)}>
                              {shortenNumber(followingCount)}
                            </span>{' '}
                            Following
                          </Trans>
                        }
                      />
                      <br />
                    </LinkOrDiv>
                    <LinkOrDiv
                      class="insignificant"
                      to={accountLink}
                      // onClick={
                      //   standalone
                      //     ? undefined
                      //     : () => {
                      //         hideAllModals();
                      //       }
                      // }
                    >
                      <Plural
                        value={statusesCount}
                        one={
                          <Trans>
                            <span title={String(statusesCount)}>
                              {shortenNumber(statusesCount)}
                            </span>{' '}
                            Post
                          </Trans>
                        }
                        other={
                          <Trans>
                            <span title={String(statusesCount)}>
                              {shortenNumber(statusesCount)}
                            </span>{' '}
                            Posts
                          </Trans>
                        }
                      />
                    </LinkOrDiv>
                    {!!createdAt && (
                      <div class="insignificant">
                        <Trans>
                          Joined{' '}
                          <time datetime={createdAt}>
                            {niceDateTime(createdAt, {
                              hideTime: true,
                            })}
                          </time>
                        </Trans>
                      </div>
                    )}
                  </div>
                </div>
                {!!postingStats && (
                  <LinkOrDiv
                    to={accountLink}
                    class="account-metadata-box"
                    // onClick={() => {
                    //   states.showAccount = false;
                    // }}
                    onClick={
                      import.meta.env.DEV && standalone
                        ? () => {
                            // Debug: undo back
                            setPostingStats(undefined);
                          }
                        : undefined
                    }
                  >
                    <div class="shazam-container">
                      <div class="shazam-container-inner">
                        {hasPostingStats ? (
                          <div
                            class="posting-stats"
                            title={
                              supportsNativeQuote()
                                ? t`${(
                                    postingStats.originals / postingStats.total
                                  ).toLocaleString(i18n.locale || undefined, {
                                    style: 'percent',
                                  })} original posts, ${(
                                    postingStats.replies / postingStats.total
                                  ).toLocaleString(i18n.locale || undefined, {
                                    style: 'percent',
                                  })} replies, ${(
                                    postingStats.quotes / postingStats.total
                                  ).toLocaleString(i18n.locale || undefined, {
                                    style: 'percent',
                                  })} quotes, ${(
                                    postingStats.boosts / postingStats.total
                                  ).toLocaleString(i18n.locale || undefined, {
                                    style: 'percent',
                                  })} boosts`
                                : t`${(
                                    postingStats.originals / postingStats.total
                                  ).toLocaleString(i18n.locale || undefined, {
                                    style: 'percent',
                                  })} original posts, ${(
                                    postingStats.replies / postingStats.total
                                  ).toLocaleString(i18n.locale || undefined, {
                                    style: 'percent',
                                  })} replies, ${(
                                    postingStats.boosts / postingStats.total
                                  ).toLocaleString(i18n.locale || undefined, {
                                    style: 'percent',
                                  })} boosts`
                            }
                          >
                            <div>
                              {postingStats.daysSinceLastPost !== undefined &&
                              postingStats.daysSinceLastPost < 365
                                ? plural(postingStats.total, {
                                    one: plural(
                                      postingStats.daysSinceLastPost,
                                      {
                                        one: `Last 1 post in the past 1 day`,
                                        other: `Last 1 post in the past ${postingStats.daysSinceLastPost} days`,
                                      },
                                    ),
                                    other: plural(
                                      postingStats.daysSinceLastPost,
                                      {
                                        one: `Last ${postingStats.total} posts in the past 1 day`,
                                        other: `Last ${postingStats.total} posts in the past ${postingStats.daysSinceLastPost} days`,
                                      },
                                    ),
                                  })
                                : plural(postingStats.total, {
                                    one: 'Last 1 post in the past year(s)',
                                    other: `Last ${postingStats.total} posts in the past year(s)`,
                                  })}
                            </div>
                            <div class="posting-stats-bar">
                              {postingStats.originals > 0 && (
                                <div
                                  class="posting-stats-bar-section posting-stats-bar-originals"
                                  style={{
                                    '--percentage': `${
                                      (postingStats.originals /
                                        postingStats.total) *
                                      100
                                    }%`,
                                  }}
                                />
                              )}
                              {postingStats.replies > 0 && (
                                <div
                                  class="posting-stats-bar-section posting-stats-bar-replies"
                                  style={{
                                    '--percentage': `${
                                      (postingStats.replies /
                                        postingStats.total) *
                                      100
                                    }%`,
                                  }}
                                />
                              )}
                              {postingStats.quotes > 0 && (
                                <div
                                  class="posting-stats-bar-section posting-stats-bar-quotes"
                                  style={{
                                    '--percentage': `${
                                      (postingStats.quotes /
                                        postingStats.total) *
                                      100
                                    }%`,
                                  }}
                                />
                              )}
                              {postingStats.boosts > 0 && (
                                <div
                                  class="posting-stats-bar-section posting-stats-bar-boosts"
                                  style={{
                                    '--percentage': `${
                                      (postingStats.boosts /
                                        postingStats.total) *
                                      100
                                    }%`,
                                  }}
                                />
                              )}
                            </div>
                            <div class="posting-stats-legends">
                              <span class="ib">
                                <span class="posting-stats-legend-item posting-stats-bar-originals" />{' '}
                                <Trans>Original</Trans>
                              </span>{' '}
                              <span class="ib">
                                <span class="posting-stats-legend-item posting-stats-bar-replies" />{' '}
                                <Trans>Replies</Trans>
                              </span>{' '}
                              {supportsNativeQuote() && (
                                <span class="ib">
                                  <span class="posting-stats-legend-item posting-stats-bar-quotes" />{' '}
                                  <Trans>Quotes</Trans>
                                </span>
                              )}
                              <span class="ib">
                                <span class="posting-stats-legend-item posting-stats-bar-boosts" />{' '}
                                <Trans>Boosts</Trans>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div class="posting-stats">
                            <Trans>Post stats unavailable.</Trans>
                          </div>
                        )}
                      </div>
                    </div>
                  </LinkOrDiv>
                )}
                {!moved && (
                  <div class="account-metadata-box">
                    <div
                      class="shazam-container no-animation"
                      hidden={!!postingStats}
                    >
                      <div class="shazam-container-inner">
                        <button
                          type="button"
                          class="posting-stats-button"
                          disabled={postingStatsUIState === 'loading'}
                          onClick={() => {
                            renderPostingStats();
                          }}
                        >
                          <div
                            class={`posting-stats-icon ${
                              postingStatsUIState === 'loading' ? 'loading' : ''
                            }`}
                          />
                          <Trans>View post stats</Trans>{' '}
                          {/* <Loader
                        abrupt
                        hidden={postingStatsUIState !== 'loading'}
                      /> */}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </main>
              <footer>
                <RelatedActions
                  info={info}
                  instance={instance}
                  standalone={standalone}
                  authenticated={authenticated}
                  onRelationshipChange={onRelationshipChange}
                  onProfileUpdate={onProfileUpdate}
                  setShowEditProfile={setShowEditProfile}
                  showEndorsements={showEndorsements}
                  renderEndorsements={renderEndorsements}
                  setRenderEndorsements={setRenderEndorsements}
                />
              </footer>
              <Endorsements
                accountID={id ?? ''}
                info={info}
                open={renderEndorsements}
                onlyOpenIfHasEndorsements={
                  renderEndorsements === 'onlyOpenIfHasEndorsements'
                }
              />
            </>
          )
        )}
      </div>
      {!!showEditProfile && (
        <Modal
          onClose={() => {
            setShowEditProfile(false);
          }}
        >
          <EditProfileSheet
            onClose={({ state, account } = {}) => {
              setShowEditProfile(false);
              if (state === 'success' && account) {
                onProfileUpdate(account);
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}

const FAMILIAR_FOLLOWERS_LIMIT = 3;

function lightenRGB([r, g, b]: readonly number[]): [number, number, number, number] {
  const luminence = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  console.log('luminence', luminence);
  let alpha: number;
  if (luminence >= 220) {
    alpha = 1;
  } else if (luminence <= 50) {
    alpha = 0.1;
  } else {
    alpha = luminence / 255;
  }
  alpha = Math.min(1, alpha);
  return [r, g, b, alpha];
}

export default AccountInfo;

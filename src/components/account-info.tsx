import './account-info.css';

import { msg, plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import type {
  AppBskyActorDefs,
  AppBskyFeedDefs,
  AppBskyRichtextFacet,
} from '@atproto/api';
import type { mastodon } from 'masto';
import type { HTMLAttributes, MouseEvent } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { feedReadMode } from '../data/_internal/dispatch';
import { getReadAgent } from '../data/clients';
import { useProfileRoute } from '../data/profiles';
import enhanceContent from '../utils/enhance-content';
import handleContentLinks from '../utils/handle-content-links';
import niceDateTime from '../utils/nice-date-time';
import { navigatePath } from '../utils/router';
import shortenNumber from '../utils/shorten-number';
import showToast from '../utils/show-toast';
import states, { hideAllModals } from '../utils/states';
import {
  type AccountInfo as StoredAccountInfo,
  getAccounts,
  saveAccounts,
} from '../utils/store-utils';
import { renderPostText } from '../render/post-text';

import AccountBlock from './account-block';
import AccountHandleInfo from './account-handle-info';
import AtprotoLabels from './atproto-labels';
import Avatar from './avatar';
import EditProfileSheetComponent, {
  type EditProfileSheetProps,
} from './edit-profile-sheet';
import EmojiText from './emoji-text';
import Icon from './icon';
import Link, { type LinkProps } from './link';
import Menu2 from './menu2';
import Modal from './modal';
import RawHtml from './raw-html';
import ProfileModerationGate from './profile-moderation-gate';
// TODO(oxlint:import/no-cycle): account-info <-> related-actions cycle is
// structural; related-actions consumes AccountInfoShape and handleScannerClick
// while account-info renders RelatedActions. Breaking it requires extracting
// scanner-click + types into a shared leaf module.
import RelatedActions from './related-actions';

function profileToAccountInfo(profile: {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  descriptionFacets?: AppBskyRichtextFacet.Main[];
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  createdAt?: string;
  labels?: unknown;
}): AccountInfoShape {
  return {
    id: profile.did,
    username: profile.handle,
    acct: profile.handle,
    url: `https://bsky.app/profile/${profile.did}`,
    displayName: profile.displayName || profile.handle,
    note: renderPostText(profile.description || '', profile.descriptionFacets),
    avatar: profile.avatar || '',
    avatarStatic: profile.avatar || '',
    header: profile.banner || '',
    headerStatic: profile.banner || '',
    followersCount: profile.followersCount || 0,
    followingCount: profile.followsCount || 0,
    statusesCount: profile.postsCount || 0,
    createdAt: profile.createdAt || '',
    locked: false,
    bot: false,
    group: false,
    lastStatusAt: profile.createdAt || '',
    roles: [],
    emojis: [],
    fields: [],
    _atproto: {
      hasProfileCounts: true,
      labels: profile.labels,
    },
  };
}

function accountInfoToProfile(
  account: AccountInfoShape | null,
): AppBskyActorDefs.ProfileViewDetailed | undefined {
  if (!account) return undefined;
  return {
    did: account.id,
    handle: account.acct || account.username || account.id,
    displayName: account.displayName,
    description: '',
    avatar: account.avatar || account.avatarStatic,
    banner: account.header || account.headerStatic,
    followersCount: account.followersCount,
    followsCount: account.followingCount,
    postsCount: account.statusesCount,
    indexedAt: account.createdAt,
    labels: account._atproto?.labels as AppBskyActorDefs.ProfileViewDetailed['labels'],
  };
}

export type AccountInfoShape = mastodon.v1.Account & {
  _atproto?: { hasProfileCounts?: boolean } & Record<string, unknown>;
  hideCollections?: boolean | null;
  roles?: ReadonlyArray<{ name?: string } & Record<string, unknown>>;
  avatarDescription?: string;
  headerDescription?: string;
};

export function toStoredAccountInfo(info: AccountInfoShape): StoredAccountInfo {
  return { ...info };
}

function EditProfileSheet(props: {
  onClose?: (arg?: { state?: string; account?: AccountInfoShape }) => void;
}) {
  return <EditProfileSheetComponent {...(props as EditProfileSheetProps)} />;
}

interface PostingStats {
  total: number;
  originals: number;
  replies: number;
  boosts: number;
  quotes: number;
  daysSinceLastPost?: number;
}

interface AccountIterPage {
  value: mastodon.v1.Account[] | undefined;
  done?: boolean;
}

const LIMIT = 80;

const isValidUrl = (string: string): boolean => {
  try {
    const parsed = new URL(string);
    return !!parsed;
  } catch {
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
        navigatePath(`/${text}`);
      }
    },
  };
};

type UIState = 'default' | 'loading' | 'error';

interface AccountInfoProps {
  account: AccountInfoShape | string | null | undefined;
  fetchAccount?: () => Promise<AccountInfoShape | undefined> | undefined;
  standalone?: boolean;
  instance?: string;
  authenticated?: boolean;
}

function AccountInfo({
  account,
  fetchAccount = () => {},
  standalone,
  instance,
  authenticated,
}: AccountInfoProps) {
  const { i18n, t } = useLingui();
  const clients = useClients();
  const activeDid = useActiveDid();
  const currentAuthenticated = authenticated ?? !!activeDid;
  const currentInstance = instance;
  const [uiState, setUIState] = useState<UIState>('default');
  const isString = typeof account === 'string';
  const [info, setInfo] = useState<AccountInfoShape | null>(
    isString ? null : (account ?? null),
  );
  const profileQuery = useProfileRoute(isString ? account : undefined);
  const moderationProfile = profileQuery.data ?? accountInfoToProfile(info);
  const [reloadCount, reload] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    if (profileQuery.data) {
      const result = profileToAccountInfo(profileQuery.data);
      states.accounts[`${result.id}@${instance}`] = { ...result };
      setInfo(result);
      setUIState('default');
      return;
    }
    if (!isString) {
      setInfo(account ?? null);
      // TODO(oxlint:no-underscore-dangle) `_atproto` is the project-wide
      // adapter cache key; renaming is out of scope.
      if (account?._atproto?.hasProfileCounts !== false) return;
    }
    setUIState('loading');
    void (async () => {
      try {
        const result = await fetchAccount();
        if (!result) {
          if (isString) setInfo(null);
          setUIState('error');
          return;
        }
        states.accounts[`${result.id}@${instance}`] = { ...result };
        setInfo(result);
        setUIState('default');
      } catch (e) {
        console.error(e);
        if (isString) setInfo(null);
        setUIState('error');
      }
    })();
  }, [isString, account, fetchAccount, reloadCount, instance, profileQuery.data]);

  // `info` may be null while loading; fall back to an empty placeholder so
  // the destructure stays terse. All consumers below already guard with
  // `!!` or optional chaining before using the values, mirroring the JS
  // original. The cast keeps the inner field types non-optional so call
  // sites that need numbers (Plural, shortenNumber) don't have to invent
  // fallback values that would change message-extraction output.
  const infoFields = info ?? ({} as AccountInfoShape);
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
    note,
    statusesCount,
    url,
    memorial,
    moved,
    hideCollections,
  } = infoFields;
  let headerIsAvatar = false;
  let { header, headerStatic } = infoFields;
  if (!header || header.endsWith('missing.png')) {
    if (avatar && !avatar.endsWith('missing.png')) {
      header = avatar;
      headerIsAvatar = true;
      if (avatarStatic && !avatarStatic.endsWith('missing.png')) {
        headerStatic = avatarStatic;
      }
    }
  }

  const isSelf = useMemo(() => !!id && id === activeDid, [activeDid, id]);

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
      const storedAccounts = getAccounts();
      let updated = false;
      storedAccounts.forEach((entry) => {
        if (entry.info.id === info.id && entry.instanceURL === instance) {
          entry.info = toStoredAccountInfo(info);
          updated = true;
        }
      });
      if (updated) {
        console.log('Updated account info', info);
        saveAccounts(storedAccounts);
      }
    }
  }, [isSelf, info, instance]);

  const [headerCornerColors, setHeaderCornerColors] = useState<string[]>([]);

  const followersIterator = useRef<
    AsyncIterator<AccountInfoShape[]> | undefined
  >(undefined);
  async function fetchFollowers(
    firstLoad?: boolean,
  ): Promise<AccountIterPage | IteratorResult<AccountInfoShape[]>> {
    if (!id) return { value: undefined, done: true };
    if (firstLoad || !followersIterator.current) {
      let cursor: string | undefined;
      followersIterator.current = {
        next: async () => {
          const agent = getReadAgent(clients, feedReadMode(activeDid));
          const res = await agent.getFollowers({
            actor: id,
            limit: LIMIT,
            cursor,
          });
          cursor = res.data.cursor;
          return {
            value: res.data.followers.map(profileToAccountInfo),
            done: !cursor,
          };
        },
      };
    }
    return followersIterator.current.next();
  }

  const followingIterator = useRef<
    AsyncIterator<AccountInfoShape[]> | undefined
  >(undefined);
  async function fetchFollowing(
    firstLoad?: boolean,
  ): Promise<AccountIterPage | IteratorResult<AccountInfoShape[]>> {
    if (!id) return { value: undefined, done: true };
    if (firstLoad || !followingIterator.current) {
      let cursor: string | undefined;
      followingIterator.current = {
        next: async () => {
          const agent = getReadAgent(clients, feedReadMode(activeDid));
          const res = await agent.getFollows({
            actor: id,
            limit: LIMIT,
            cursor,
          });
          cursor = res.data.cursor;
          return {
            value: res.data.follows.map(profileToAccountInfo),
            done: !cursor,
          };
        },
      };
    }
    const results = await followingIterator.current.next();
    return results;
  }

  const LinkOrDiv = useCallback(
    ({ to, ...props }: LinkProps) => {
      return standalone ? (
        <div {...(props as HTMLAttributes<HTMLDivElement>)} />
      ) : (
        <Link to={to} {...props} />
      );
    },
    [standalone],
  );
  const accountLink = instance ? `/${instance}/a/${id}` : `/a/${id}`;

  const [familiarFollowers, setFamiliarFollowers] = useState<
    AccountInfoShape[]
  >([]);
  const [postingStats, setPostingStats] = useState<PostingStats | undefined>();
  const [postingStatsLoading, setPostingStatsLoading] = useState(false);
  const hasPostingStats = !!postingStats?.total;

  const renderFamiliarFollowers = useCallback(async (): Promise<void> => {
    if (!activeDid || !id) {
      setFamiliarFollowers([]);
      return;
    }
    const agent = getReadAgent(clients, feedReadMode(activeDid));
    const res = await agent.app.bsky.graph.getKnownFollowers({
      actor: id,
      limit: LIMIT,
    });
    setFamiliarFollowers(res.data.followers.map(profileToAccountInfo));
  }, [activeDid, clients, id]);

  const renderPostingStats = useCallback(async () => {
    if (!activeDid || !id) {
      setPostingStats(undefined);
      return;
    }
    setPostingStatsLoading(true);
    try {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.getAuthorFeed({
        actor: id,
        limit: 20,
        filter: 'posts_with_replies',
      });
      const stats: PostingStats = {
        total: res.data.feed.length,
        originals: 0,
        replies: 0,
        boosts: 0,
        quotes: 0,
      };

      for (const item of res.data.feed) {
        if (item.reason?.$type === 'app.bsky.feed.defs#reasonRepost') {
          stats.boosts += 1;
          continue;
        }
        const record = item.post.record as AppBskyFeedDefs.PostView['record'] & {
          reply?: { parent?: { uri?: string } };
        };
        if (
          record.reply?.parent?.uri &&
          record.reply.parent.uri.split('/')[2] !== item.post.author.did
        ) {
          stats.replies += 1;
        } else if (item.post.embed?.$type === 'app.bsky.embed.record#view') {
          stats.quotes += 1;
        } else if (
          item.post.embed?.$type === 'app.bsky.embed.recordWithMedia#view'
        ) {
          stats.quotes += 1;
        } else {
          stats.originals += 1;
        }
      }

      const lastPost = res.data.feed.at(-1)?.post;
      const lastCreatedAt = (
        lastPost?.record as { createdAt?: string } | undefined
      )?.createdAt;
      if (lastCreatedAt) {
        stats.daysSinceLastPost = Math.ceil(
          (Date.now() - Date.parse(lastCreatedAt)) / 86400000,
        );
      }
      setPostingStats(stats);
    } finally {
      setPostingStatsLoading(false);
    }
  }, [activeDid, clients, id]);

  const onRelationshipChange = useCallback(
    ({
      relationship,
    }: {
      relationship: { following?: boolean };
    }) => {
      if (!relationship.following) {
        void renderFamiliarFollowers();
        if (!standalone && statusesCount > 0) {
          // Only render posting stats if not standalone and has posts
          void renderPostingStats();
        }
      }
    },
    [standalone, statusesCount, renderFamiliarFollowers, renderPostingStats],
  );

  const onProfileUpdate = useCallback(
    (newAccount: AccountInfoShape) => {
      if (newAccount.id === id) {
        console.log('Updated account info', newAccount);
        setInfo(newAccount);
        states.accounts[`${newAccount.id}@${instance}`] = { ...newAccount };
      }
    },
    [id, instance],
  );

  const isStringURL = isString && account && /^https?:\/\//.test(account);

  const [showEditProfile, setShowEditProfile] = useState(false);

  return (
    <>
      <div
        tabIndex={-1}
        className={`account-container ${uiState === 'loading' ? 'skeleton' : ''}`}
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
          <div className="ui-state">
            <p>
              <Trans>Unable to load account.</Trans>
            </p>
            {isString ? (
              <p>
                {isStringURL ? (
                  <a href={account} target="_blank" rel="noopener noreferrer">
                    {account}
                  </a>
                ) : (
                  <code className="insignificant">{account}</code>
                )}
              </p>
            ) : (
              <p>
                <a href={url} target="_blank" rel="noopener noreferrer">
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
              <div className="note">
                <p>███████ ████ ████</p>
                <p>████ ████████ ██████ █████████ ████ ██</p>
              </div>
              <div className="account-metadata-box">
                <div className="profile-metadata">
                  <div className="profile-field">
                    <b className="more-insignificant">███</b>
                    <p>██████</p>
                  </div>
                  <div className="profile-field">
                    <b className="more-insignificant">████</b>
                    <p>███████████</p>
                  </div>
                </div>
                <div className="stats">
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
              <div className="actions">
                <span />
                <span className="buttons">
                  <button type="button" className="plain4" disabled>
                    <Icon icon="more2" size="l" />
                  </button>
                </span>
              </div>
            </main>
          </>
        ) : (
          info && (
            <ProfileModerationGate profile={moderationProfile}>
              {!!moved && (
                <div className="account-moved">
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
              {!!header && !header.endsWith('missing.png') && (
                <img
                  src={header}
                  alt={headerDescription || ''}
                  className={`header-banner ${
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
                      const canvas: OffscreenCanvas | HTMLCanvasElement =
                        window.OffscreenCanvas
                          ? new OffscreenCanvas(1, 1)
                          : document.createElement('canvas');
                      const ctx = canvas.getContext('2d', {
                        willReadFrequently: true,
                      });
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
                    } catch {
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
                    <div className="szh-menu__header">
                      <AccountHandleInfo
                        acct={acct ?? ''}
                        instance={instance}
                      />
                    </div>
                    <MenuItem
                      onClick={() => {
                        const acctSafe = acct ?? '';
                        const handleWithInstance = acctSafe.includes('@')
                          ? `@${acctSafe}`
                          : `@${acctSafe}@${instance}`;
                        try {
                          void navigator.clipboard.writeText(
                            handleWithInstance,
                          );
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
                    {currentAuthenticated && isSelf && (
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
              <div className="faux-header-bg" aria-hidden="true" />
              <main>
                {!!memorial && (
                  <span className="tag">
                    <Trans>In Memoriam</Trans>
                  </span>
                )}
                {bot && (
                  <span className="tag">
                    <Icon icon="bot" /> <Trans>Automated</Trans>
                  </span>
                )}
                {group && (
                  <span className="tag">
                    <Icon icon="group" /> <Trans>Group</Trans>
                  </span>
                )}
                <AtprotoLabels
                  labels={info._atproto?.labels}
                  sourceProfiles={info}
                />
                {/* {roles?.map((role) => (
                  <span className="tag">
                    {role.name}
                    {!!accountInstance && (
                      <>
                        {' '}
                        <span className="more-insignificant">
                          {accountInstance}
                        </span>
                      </>
                    )}
                  </span>
                ))} */}
                <RawHtml
                  className="note"
                  dir="auto"
                  role="presentation"
                  onClick={handleContentLinks({
                    instance: currentInstance,
                  })}
                  onKeyDown={() => {
                    /* Delegated link clicks are handled via the contained
                     * anchor elements; this onKeyDown exists only to satisfy
                     * the a11y linter — keyboard activation still flows
                     * through the inner <a> tags. */
                  }}
                  html={enhanceContent(note, { emojis }) as string}
                />
                <div className="account-metadata-box">
                  {!!fields?.length && (
                    <div className="profile-metadata">
                      {fields.map(({ name, value, verifiedAt }, i) => (
                        <div
                          className={`profile-field ${
                            verifiedAt ? 'profile-verified' : ''
                          }`}
                          key={name + i}
                          dir="auto"
                        >
                          <b>
                            <EmojiText text={name} />{' '}
                            {!!verifiedAt && (
                              <Icon
                                icon="check-circle"
                                size="s"
                                alt={t`Verified`}
                              />
                            )}
                          </b>
                          <RawHtml
                            as="p"
                            html={enhanceContent(value, { emojis }) as string}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="stats">
                    <LinkOrDiv
                      tabIndex={0}
                      to={accountLink}
                      onClick={(event: MouseEvent) => {
                        event.preventDefault();
                        // states.showAccount = false;
                        states.showGenericAccounts = false;
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
                        <span className="shazam-container-horizontal">
                          <span className="shazam-container-inner stats-avatars-bunch">
                            {familiarFollowers.map((follower) => (
                              <Avatar
                                key={follower.id}
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
                      className="insignificant"
                      tabIndex={0}
                      to={accountLink}
                      onClick={(event: MouseEvent) => {
                        event.preventDefault();
                        // states.showAccount = false;
                        states.showGenericAccounts = false;
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
                      className="insignificant"
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
                      <div className="insignificant">
                        <Trans>
                          Joined{' '}
                          <time dateTime={createdAt}>
                            {niceDateTime(createdAt, {
                              hideTime: true,
                            })}
                          </time>
                        </Trans>
                      </div>
                    )}
                  </div>
                </div>
                {!postingStats && !standalone && statusesCount > 0 && (
                  <button
                    type="button"
                    aria-label={t`View post stats`}
                    className="account-metadata-box"
                    disabled={postingStatsLoading}
                    onClick={() => {
                      void renderPostingStats();
                    }}
                  >
                    <div className="shazam-container">
                      <div className="shazam-container-inner">
                        <div className="posting-stats">
                          {postingStatsLoading ? (
                            <Trans>Loading post stats...</Trans>
                          ) : (
                            <Trans>View post stats</Trans>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )}
                {!!postingStats && (
                  <LinkOrDiv
                    to={accountLink}
                    className="account-metadata-box"
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
                    <div className="shazam-container">
                      <div className="shazam-container-inner">
                        {hasPostingStats ? (
                          <div
                            className="posting-stats"
                            title={t`${(
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
                            })} reposts`}
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
                            <div className="posting-stats-bar">
                              {postingStats.originals > 0 && (
                                <div
                                  className="posting-stats-bar-section posting-stats-bar-originals"
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
                                  className="posting-stats-bar-section posting-stats-bar-replies"
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
                                  className="posting-stats-bar-section posting-stats-bar-quotes"
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
                                  className="posting-stats-bar-section posting-stats-bar-boosts"
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
                            <div className="posting-stats-legends">
                              <span className="ib">
                                <span className="posting-stats-legend-item posting-stats-bar-originals" />{' '}
                                <Trans>Original</Trans>
                              </span>{' '}
                              <span className="ib">
                                <span className="posting-stats-legend-item posting-stats-bar-replies" />{' '}
                                <Trans>Replies</Trans>
                              </span>{' '}
                              <span className="ib">
                                <span className="posting-stats-legend-item posting-stats-bar-quotes" />{' '}
                                <Trans>Quotes</Trans>
                              </span>{' '}
                              <span className="ib">
                                <span className="posting-stats-legend-item posting-stats-bar-boosts" />{' '}
                                <Trans>Reposts</Trans>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="posting-stats">
                            <Trans>Post stats unavailable.</Trans>
                          </div>
                        )}
                      </div>
                    </div>
                  </LinkOrDiv>
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
                />
              </footer>
            </ProfileModerationGate>
          )
        )}
      </div>
      {showEditProfile && (
        <Modal
          onClose={() => {
            setShowEditProfile(false);
          }}
        >
          <EditProfileSheet
            onClose={({ state, account: updatedAccount } = {}) => {
              setShowEditProfile(false);
              if (state === 'success' && updatedAccount) {
                onProfileUpdate(updatedAccount);
              }
            }}
          />
        </Modal>
      )}
    </>
  );
}

function lightenRGB([r, g, b]: readonly number[]): [
  number,
  number,
  number,
  number,
] {
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

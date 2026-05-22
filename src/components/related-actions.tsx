import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import { toUnicode as punycodeToUnicode } from 'punycode/';
import type { HTMLAttributes, ReactElement } from 'react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { api } from '../utils/api';
import isSearchEnabled from '../utils/is-search-enabled';
import niceDateTime from '../utils/nice-date-time';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import states from '../utils/states';
import { getCurrentAccountID, updateAccount } from '../utils/store-utils';

import {
  type AccountInfoShape,
  handleScannerClick,
  toStoredAccountInfo,
} from './account-info';
import AddRemoveListsSheet from './add-remove-lists-sheet';
import Icon from './icon';
import Loader from './loader';
import MenuConfirm from './menu-confirm';
import Menu2 from './menu2';
import Modal from './modal';
import TranslatedBioSheet from './translated-bio-sheet';

// Endpoint shims for the masto v1 accounts/relationships APIs. The runtime
// client exposes these, but the loose `MastoClient` type in `utils/api.ts`
// types `v1.accounts` as `unknown`. We narrow locally rather than widening the
// shared interface. Removed when api.ts gains a tighter masto shape.
type Relationship = mastodon.v1.Relationship;

interface ListLike {
  id: string;
  title: string;
}

interface RelationshipsResource {
  fetch(params: { id: string[] }): Promise<Relationship[]>;
}

interface AccountListsEndpoint {
  list(): Promise<ListLike[]>;
}

interface AccountSelectEndpoint {
  lists: AccountListsEndpoint;
  follow(params?: {
    notify?: boolean;
    reblogs?: boolean;
  }): Promise<Relationship>;
  unfollow(): Promise<Relationship>;
  mute(params?: { duration?: number }): Promise<Relationship>;
  unmute(): Promise<Relationship>;
  block(): Promise<Relationship>;
  unblock(): Promise<Relationship>;
  removeFromFollowers(): Promise<Relationship>;
}

interface AccountsEndpoint {
  $select(id: string): AccountSelectEndpoint;
  relationships: RelationshipsResource;
}

interface SearchListParams {
  q: string;
  type: 'accounts';
  limit: number;
  resolve: boolean;
}

interface SearchListResult {
  accounts: mastodon.v1.Account[];
}

interface V2SearchEndpoint {
  list(params: SearchListParams): Promise<SearchListResult>;
}

interface MastoLike {
  v1: { accounts: unknown } & Record<string, unknown>;
  v2: { search: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

function getAccountsEndpoint(masto: MastoLike): AccountsEndpoint {
  return masto.v1.accounts as AccountsEndpoint;
}

function getV2SearchEndpoint(masto: MastoLike): V2SearchEndpoint {
  return masto.v2.search as V2SearchEndpoint;
}

type RelationshipUIState = 'default' | 'loading' | 'error';

interface RelationshipChangePayload {
  relationship: Relationship;
  currentID: string;
}

interface RelatedActionsProps {
  info?: AccountInfoShape | null;
  instance?: string;
  standalone?: boolean;
  authenticated?: boolean;
  onRelationshipChange?: (payload: RelationshipChangePayload) => void;
  // Accepted by callers (e.g. account-info) but unused here — preserves the
  // pass-through behavior of the original JS component which silently
  // dropped this prop.
  onProfileUpdate?: (account: AccountInfoShape) => void;
  setShowEditProfile?: (show: boolean) => void;
}

function RelatedActions({
  info,
  instance,
  standalone,
  authenticated,
  onRelationshipChange = () => {},
  setShowEditProfile = () => {},
}: RelatedActionsProps) {
  const { t } = useLingui();
  const {
    masto: currentMasto,
    instance: currentInstance,
    authenticated: currentAuthenticated,
  } = api();
  const sameInstance = instance === currentInstance;

  const [relationshipUIState, setRelationshipUIState] =
    useState<RelationshipUIState>('default');
  const [relationship, setRelationship] = useState<Relationship | null>(null);

  // `info` may be null on initial render. Hooks below must still be called in
  // the same order on every render, so we destructure with safe fallbacks and
  // defer the early-return until after every Hook has run. `url` is
  // re-extracted post early-return so callers see its non-optional type.
  const {
    id = '',
    acct = '',
    username,
    locked,
    lastStatusAt,
    note,
    fields,
    moved,
  } = info ?? {};
  const accountID = useRef<string>(id);

  const {
    following,
    showingReblogs,
    notifying,
    followedBy,
    blocking,
    blockedBy: _blockedBy,
    muting,
    mutingNotifications: _mutingNotifications,
    domainBlocking: _domainBlocking,
  } = (relationship ?? {}) as Partial<Relationship>;

  const [currentInfo, setCurrentInfo] = useState<mastodon.v1.Account | null>(
    null,
  );
  const [isSelf, setIsSelf] = useState<boolean>(false);

  const acctWithInstance = acct.includes('@') ? acct : `${acct}@${instance}`;

  // The relationship fetch should re-run only when `info` or `authenticated`
  // change — never on every parent render of the (possibly non-memoized)
  // `onRelationshipChange` callback, never on per-access masto proxy churn,
  // and never on derived values that update in lockstep with `info`. Forward
  // those through refs so the effect body reads the latest values without
  // subscribing to them.
  const onRelationshipChangeRef = useRef(onRelationshipChange);
  useEffect(() => {
    onRelationshipChangeRef.current = onRelationshipChange;
  }, [onRelationshipChange]);

  const fetchContextRef = useRef({
    currentMasto,
    currentAuthenticated,
    sameInstance,
    id,
    instance,
  });
  useEffect(() => {
    fetchContextRef.current = {
      currentMasto,
      currentAuthenticated,
      sameInstance,
      id,
      instance,
    };
  }, [currentMasto, currentAuthenticated, sameInstance, id, instance]);

  const loadRelationshipForInfo = useEffectEvent(() => {
    if (info) {
      const {
        currentMasto: ctxMasto,
        currentAuthenticated: ctxCurrentAuth,
        sameInstance: ctxSameInstance,
        id: ctxId,
        instance: ctxInstance,
      } = fetchContextRef.current;
      const currentAccount = getCurrentAccountID();
      let currentID: string | undefined;
      void (async () => {
        if (ctxSameInstance && authenticated) {
          currentID = ctxId;
        } else if (!ctxSameInstance && ctxCurrentAuth) {
          // Grab this account from my logged-in instance
          const acctHasInstance = info.acct.includes('@');
          try {
            const results = await getV2SearchEndpoint(ctxMasto).list({
              q: acctHasInstance
                ? info.acct
                : `${info.username}@${ctxInstance}`,
              type: 'accounts',
              limit: 1,
              resolve: true,
            });
            console.log('🥏 Fetched account from logged-in instance', results);
            if (results.accounts.length) {
              currentID = results.accounts[0].id;
              setCurrentInfo(results.accounts[0]);
            }
          } catch (e) {
            console.error(e);
          }
        }

        if (!currentID) return;

        if (currentAccount === currentID) {
          // It's myself!
          setIsSelf(true);
          return;
        }

        accountID.current = currentID;

        // if (moved) return;

        setRelationshipUIState('loading');

        const fetchRelationships = getAccountsEndpoint(
          ctxMasto,
        ).relationships.fetch({
          id: [currentID],
        });

        try {
          const relationships = await fetchRelationships;
          console.log('fetched relationship', relationships);
          setRelationshipUIState('default');

          if (relationships.length) {
            const fetchedRelationship = relationships[0];
            setRelationship(fetchedRelationship);
            onRelationshipChangeRef.current({
              relationship: fetchedRelationship,
              currentID,
            });
          }
        } catch (e) {
          console.error(e);
          setRelationshipUIState('error');
        }
      })();
    }
  });
  useEffect(() => {
    loadRelationshipForInfo();
  }, [info, authenticated]);

  useEffect(() => {
    if (info && isSelf) {
      updateAccount(toStoredAccountInfo(info));
    }
  }, [info, isSelf]);

  const loading = relationshipUIState === 'loading';

  const [showTranslatedBio, setShowTranslatedBio] = useState<boolean>(false);
  const [showAddRemoveLists, setShowAddRemoveLists] = useState<boolean>(false);
  const [lists, setLists] = useState<ListLike[]>([]);
  const [searchEnabled, setSearchEnabled] = useState<boolean>(false);

  useEffect(() => {
    if (!currentAuthenticated) return undefined;
    void (async () => {
      const enabled = await isSearchEnabled(currentInstance);
      setSearchEnabled(enabled);
    })();
    return undefined;
  }, [currentInstance, currentAuthenticated]);

  if (!info) return null;

  // After the early-return, `info` is present. Re-narrow `url` so downstream
  // usages get its non-undefined type.
  const url = info.url;
  let { headerStatic, avatarStatic } = info;
  if (!headerStatic || headerStatic.endsWith('missing.png')) {
    if (avatarStatic && !avatarStatic.endsWith('missing.png')) {
      headerStatic = avatarStatic;
    }
  }

  return (
    <>
      <div className="actions">
        <span>
          {followedBy ? (
            <span className="tag">
              <Trans>Follows you</Trans>
            </span>
          ) : lastStatusAt ? (
            <small className="insignificant">
              <Trans>
                Last post:{' '}
                <span className="ib">
                  {niceDateTime(lastStatusAt, {
                    hideTime: true,
                  })}
                </span>
              </Trans>
            </small>
          ) : (
            <span />
          )}
          {muting && (
            <span className="tag danger">
              <Trans>Muted</Trans>
            </span>
          )}
          {blocking && (
            <span className="tag danger">
              <Trans>Blocked</Trans>
            </span>
          )}
        </span>{' '}
        <span className="buttons">
          {currentAuthenticated && isSelf && (
            <button
              type="button"
              className="plain"
              onClick={() => {
                states.showQrCodeModal = {
                  text: url,
                  arena: avatarStatic,
                  backgroundMask: headerStatic,
                  caption: acct.includes('@') ? acct : `${acct}@${instance}`,
                  onScannerClick: handleScannerClick,
                };
              }}
            >
              <Icon icon="qrcode" alt={t`QR code`} />
            </button>
          )}
          <Menu2
            portal={{
              target: document.body,
            }}
            containerProps={{
              style: {
                // Higher than the backdrop
                zIndex: 1001,
              },
            }}
            align="center"
            position="anchor"
            overflow="auto"
            menuButton={
              <button type="button" className="plain4" disabled={loading}>
                <Icon icon="more2" size="l" alt={t`More`} />
              </button>
            }
            onMenuChange={(menuEvent: { open?: boolean }) => {
              if (following && menuEvent.open) {
                // Fetch lists that have this account
                void (async () => {
                  try {
                    const fetchedLists = await getAccountsEndpoint(currentMasto)
                      .$select(accountID.current)
                      .lists.list();
                    console.log('fetched account lists', fetchedLists);
                    setLists(fetchedLists);
                  } catch (e) {
                    console.error(e);
                  }
                })();
              }
            }}
          >
            {currentAuthenticated && !isSelf ? (
              <>
                <MenuItem
                  onClick={() => {
                    showCompose({
                      draftStatus: {
                        status: `@${currentInfo?.acct || acct} `,
                      },
                    });
                  }}
                >
                  <Icon icon="at" />
                  <span>
                    <Trans>
                      Mention <span className="bidi-isolate">@{username}</span>
                    </Trans>
                  </span>
                </MenuItem>
                {searchEnabled && (
                  <MenuItem
                    onClick={() => {
                      states.showSearchCommand = { query: `from:${acct} ` };
                    }}
                  >
                    <Icon icon="search" />
                    <span>
                      <Trans>
                        Search <span className="bidi-isolate">@{username}</span>
                        's posts
                      </Trans>
                    </span>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    setShowTranslatedBio(true);
                  }}
                >
                  <Icon icon="translate" />
                  <span>
                    <Trans>Translate bio</Trans>
                  </span>
                </MenuItem>
                {following && !!relationship && (
                  <>
                    <MenuItem
                      onClick={() => {
                        setRelationshipUIState('loading');
                        void (async () => {
                          try {
                            const rel = await getAccountsEndpoint(currentMasto)
                              .$select(accountID.current)
                              .follow({
                                notify: !notifying,
                              });
                            if (rel) setRelationship(rel);
                            setRelationshipUIState('default');
                            showToast(
                              rel.notifying
                                ? t`Notifications enabled for @${username}'s posts.`
                                : t` Notifications disabled for @${username}'s posts.`,
                            );
                          } catch (e) {
                            alert(e);
                            setRelationshipUIState('error');
                          }
                        })();
                      }}
                    >
                      <Icon icon="notification" />
                      <span>
                        {notifying
                          ? t`Disable notifications`
                          : t`Enable notifications`}
                      </span>
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setRelationshipUIState('loading');
                        void (async () => {
                          try {
                            const rel = await getAccountsEndpoint(currentMasto)
                              .$select(accountID.current)
                              .follow({
                                reblogs: !showingReblogs,
                              });
                            if (rel) setRelationship(rel);
                            setRelationshipUIState('default');
                            showToast(
                              rel.showingReblogs
                                ? t`Reposts from @${username} enabled.`
                                : t`Reposts from @${username} disabled.`,
                            );
                          } catch (e) {
                            alert(e);
                            setRelationshipUIState('error');
                          }
                        })();
                      }}
                    >
                      <Icon icon="rocket" />
                      <span>
                        {showingReblogs
                          ? t`Disable reposts`
                          : t`Enable reposts`}
                      </span>
                    </MenuItem>
                  </>
                )}
                {/* Add/remove from lists is only possible if following the account */}
                {following && (
                  <MenuItem
                    onClick={() => {
                      setShowAddRemoveLists(true);
                    }}
                  >
                    <Icon icon="list" />
                    {lists.length ? (
                      <>
                        <small className="menu-grow">
                          <Trans>Add/Remove from Lists</Trans>
                          <br />
                          <span className="more-insignificant">
                            {lists.map((list) => list.title).join(', ')}
                          </span>
                        </small>
                        <small className="more-insignificant">
                          {lists.length}
                        </small>
                      </>
                    ) : (
                      <span>
                        <Trans>Add/Remove from Lists</Trans>
                      </span>
                    )}
                  </MenuItem>
                )}
                <MenuDivider />
              </>
            ) : (
              <>
                {searchEnabled && isSelf && (
                  <MenuItem
                    onClick={() => {
                      states.showSearchCommand = { query: 'from:me ' };
                    }}
                  >
                    <Icon icon="search" />
                    <span>
                      <Trans>Search my posts</Trans>
                    </span>
                  </MenuItem>
                )}
                {searchEnabled && isSelf && <MenuDivider />}
              </>
            )}
            <MenuItem
              onClick={() => {
                const handle = `@${currentInfo?.acct || acctWithInstance}`;
                try {
                  void navigator.clipboard.writeText(handle);
                  showToast(t`Handle copied`);
                } catch (e) {
                  console.error(e);
                  showToast(t`Unable to copy handle`);
                }
              }}
            >
              <Icon icon="copy" />
              <small>
                <Trans>Copy handle</Trans>
                <br />
                <span className="more-insignificant bidi-isolate">
                  @{currentInfo?.acct || acctWithInstance}
                </span>
              </small>
            </MenuItem>
            <MenuItem href={url} target="_blank">
              <Icon icon="external" />
              <small className="menu-double-lines">{niceAccountURL(url)}</small>
            </MenuItem>
            <div className="menu-horizontal">
              <MenuItem
                onClick={() => {
                  // Copy url to clipboard
                  try {
                    void navigator.clipboard.writeText(url);
                    showToast(t`Link copied`);
                  } catch (e) {
                    console.error(e);
                    showToast(t`Unable to copy link`);
                  }
                }}
              >
                <Icon icon="link" />
                <span>
                  <Trans>Copy</Trans>
                </span>
              </MenuItem>
              {navigator?.share &&
                navigator?.canShare?.({
                  url,
                }) && (
                  <MenuItem
                    onClick={() => {
                      try {
                        void navigator.share({
                          url,
                        });
                      } catch (e) {
                        console.error(e);
                        alert(t`Sharing doesn't seem to work.`);
                      }
                    }}
                  >
                    <Icon icon="share" />
                    <span>
                      <Trans>Share…</Trans>
                    </span>
                  </MenuItem>
                )}
            </div>
            <MenuItem
              onClick={() => {
                states.showQrCodeModal = {
                  text: url,
                  arena: avatarStatic,
                  backgroundMask: headerStatic,
                  caption: acct.includes('@') ? acct : `${acct}@${instance}`,
                  onScannerClick: handleScannerClick,
                };
              }}
            >
              <Icon icon="qrcode" />
              <span>
                <Trans>QR code</Trans>
              </span>
            </MenuItem>
            {!!relationship && (
              <>
                <MenuDivider />
                {muting ? (
                  <MenuItem
                    onClick={() => {
                      setRelationshipUIState('loading');
                      void (async () => {
                        try {
                          const newRelationship = await getAccountsEndpoint(
                            currentMasto,
                          )
                            .$select(currentInfo?.id || id)
                            .unmute();
                          console.log('unmuting', newRelationship);
                          setRelationship(newRelationship);
                          setRelationshipUIState('default');
                          showToast(t`Unmuted @${username}`);
                          states.reloadGenericAccounts.id = 'mute';
                          states.reloadGenericAccounts.counter++;
                        } catch (e) {
                          console.error(e);
                          setRelationshipUIState('error');
                        }
                      })();
                    }}
                  >
                    <Icon icon="unmute" />
                    <span>
                      <Trans>
                        Unmute <span className="bidi-isolate">@{username}</span>
                      </Trans>
                    </span>
                  </MenuItem>
                ) : (
                  <MenuItem
                    onClick={() => {
                      setRelationshipUIState('loading');
                      void (async () => {
                        try {
                          const newRelationship = await getAccountsEndpoint(
                            currentMasto,
                          )
                            .$select(currentInfo?.id || id)
                            .mute();
                          console.log('muting', newRelationship);
                          setRelationship(newRelationship);
                          setRelationshipUIState('default');
                          showToast(t`Muted @${username}`);
                          states.reloadGenericAccounts.id = 'mute';
                          states.reloadGenericAccounts.counter++;
                        } catch (e) {
                          console.error(e);
                          setRelationshipUIState('error');
                          showToast(t`Unable to mute @${username}`);
                        }
                      })();
                    }}
                  >
                    <Icon icon="mute" />
                    <span>
                      <Trans>
                        Mute <span className="bidi-isolate">@{username}</span>
                      </Trans>
                    </span>
                  </MenuItem>
                )}
                {followedBy && (
                  <MenuConfirm
                    subMenu
                    menuItemClassName="danger"
                    confirmLabel={
                      <>
                        <Icon icon="user-x" />
                        <span>
                          <Trans>
                            Remove{' '}
                            <span className="bidi-isolate">@{username}</span>{' '}
                            from followers?
                          </Trans>
                        </span>
                      </>
                    }
                    onClick={() => {
                      setRelationshipUIState('loading');
                      void (async () => {
                        try {
                          const newRelationship = await getAccountsEndpoint(
                            currentMasto,
                          )
                            .$select(currentInfo?.id || id)
                            .removeFromFollowers();
                          console.log(
                            'removing from followers',
                            newRelationship,
                          );
                          setRelationship(newRelationship);
                          setRelationshipUIState('default');
                          showToast(t`@${username} removed from followers`);
                          states.reloadGenericAccounts.id = 'followers';
                          states.reloadGenericAccounts.counter++;
                        } catch (e) {
                          console.error(e);
                          setRelationshipUIState('error');
                        }
                      })();
                    }}
                  >
                    <Icon icon="user-x" />
                    <span>
                      <Trans>Remove follower…</Trans>
                    </span>
                  </MenuConfirm>
                )}
                <MenuConfirm
                  subMenu
                  confirm={!blocking}
                  confirmLabel={
                    <>
                      <Icon icon="block" />
                      <span>
                        <Trans>
                          Block{' '}
                          <span className="bidi-isolate">@{username}</span>?
                        </Trans>
                      </span>
                    </>
                  }
                  itemProps={{
                    className: 'danger',
                  }}
                  menuItemClassName="danger"
                  onClick={() => {
                    // if (!blocking && !confirm(`Block @${username}?`)) {
                    //   return;
                    // }
                    setRelationshipUIState('loading');
                    void (async () => {
                      try {
                        if (blocking) {
                          const newRelationship = await getAccountsEndpoint(
                            currentMasto,
                          )
                            .$select(currentInfo?.id || id)
                            .unblock();
                          console.log('unblocking', newRelationship);
                          setRelationship(newRelationship);
                          setRelationshipUIState('default');
                          showToast(t`Unblocked @${username}`);
                        } else {
                          const newRelationship = await getAccountsEndpoint(
                            currentMasto,
                          )
                            .$select(currentInfo?.id || id)
                            .block();
                          console.log('blocking', newRelationship);
                          setRelationship(newRelationship);
                          setRelationshipUIState('default');
                          showToast(t`Blocked @${username}`);
                        }
                        states.reloadGenericAccounts.id = 'block';
                        states.reloadGenericAccounts.counter++;
                      } catch (e) {
                        console.error(e);
                        setRelationshipUIState('error');
                        if (blocking) {
                          showToast(t`Unable to unblock @${username}`);
                        } else {
                          showToast(t`Unable to block @${username}`);
                        }
                      }
                    })();
                  }}
                >
                  {blocking ? (
                    <>
                      <Icon icon="unblock" />
                      <span>
                        <Trans>
                          Unblock{' '}
                          <span className="bidi-isolate">@{username}</span>
                        </Trans>
                      </span>
                    </>
                  ) : (
                    <>
                      <Icon icon="block" />
                      <span>
                        <Trans>
                          Block{' '}
                          <span className="bidi-isolate">@{username}</span>…
                        </Trans>
                      </span>
                    </>
                  )}
                </MenuConfirm>
                <MenuItem
                  className="danger"
                  onClick={() => {
                    states.showReportModal = {
                      account: currentInfo || info,
                    };
                  }}
                >
                  <Icon icon="flag" />
                  <span>
                    <Trans>
                      Report <span className="bidi-isolate">@{username}</span>…
                    </Trans>
                  </span>
                </MenuItem>
              </>
            )}
            {currentAuthenticated && isSelf && standalone && (
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
          {!relationship && relationshipUIState === 'loading' && (
            <Loader abrupt />
          )}
          {!!relationship && !moved && (
            <MenuConfirm
              confirm={following}
              confirmLabel={
                <span>{t`Unfollow @${info.acct || info.username}?`}</span>
              }
              menuItemClassName="danger"
              align="end"
              disabled={loading}
              onClick={() => {
                setRelationshipUIState('loading');
                void (async () => {
                  try {
                    let newRelationship: Relationship | undefined;

                    if (following) {
                      newRelationship = await getAccountsEndpoint(currentMasto)
                        .$select(accountID.current)
                        .unfollow();
                    } else {
                      newRelationship = await getAccountsEndpoint(currentMasto)
                        .$select(accountID.current)
                        .follow();
                    }

                    if (newRelationship) {
                      setRelationship(newRelationship);
                    }
                    setRelationshipUIState('default');
                  } catch (e) {
                    alert(e);
                    setRelationshipUIState('error');
                  }
                })();
              }}
            >
              <button
                type="button"
                className={following ? 'light swap' : ''}
                data-swap-state={following ? 'danger' : ''}
                disabled={loading}
              >
                {following ? (
                  <>
                    <span>
                      <Trans>Following</Trans>
                    </span>
                    <span>
                      <Trans>Unfollow…</Trans>
                    </span>
                  </>
                ) : locked ? (
                  <>
                    <Icon icon="lock" />{' '}
                    <span>
                      <Trans>Follow</Trans>
                    </span>
                  </>
                ) : (
                  t`Follow`
                )}
              </button>
            </MenuConfirm>
          )}
        </span>
      </div>
      {showTranslatedBio && (
        <Modal
          onClose={() => {
            setShowTranslatedBio(false);
          }}
        >
          <TranslatedBioSheet
            note={note}
            fields={fields}
            onClose={() => {
              setShowTranslatedBio(false);
            }}
          />
        </Modal>
      )}
      {showAddRemoveLists && (
        <Modal
          onClose={() => {
            setShowAddRemoveLists(false);
          }}
        >
          <AddRemoveListsSheet
            accountID={accountID.current}
            onClose={() => {
              setShowAddRemoveLists(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function niceAccountURL(
  url: string | null | undefined,
): ReactElement<HTMLAttributes<HTMLElement>> | undefined {
  if (!url) return undefined;
  const urlObj = URL.parse(url);
  if (!urlObj) return undefined;
  const { host, pathname } = urlObj;
  const path = pathname.replace(/\/$/, '').replace(/^\//, '');
  return (
    <>
      <span className="more-insignificant">{punycodeToUnicode(host)}/</span>
      <wbr />
      <span>{path}</span>
    </>
  );
}

export default RelatedActions;

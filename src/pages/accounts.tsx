import './accounts.css';

import { useAutoAnimate } from '@formkit/auto-animate/preact';
import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import { useReducer } from 'preact/hooks';

import Avatar from '../components/avatar';
import Icon from '../components/icon';
import Link from '../components/link';
import MenuConfirm from '../components/menu-confirm';
import MenuLink from '../components/menu-link';
import Menu2 from '../components/menu2';
import NameText from '../components/name-text';
import RelativeTime from '../components/relative-time';
import { api } from '../utils/api';
import { revokeAccessToken } from '../utils/auth';
import haptics from '../utils/haptics';
import niceDateTime from '../utils/nice-date-time';
import states from '../utils/states';
import store from '../utils/store';
import {
  getAccounts,
  getCurrentAccountID,
  saveAccounts,
  setCurrentAccountID,
  type StoredAccount,
} from '../utils/store-utils';

type OAuthAccount = Omit<StoredAccount, 'accessToken'> & {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
};

interface MastoAccountsSelect {
  $select(id: string): {
    fetch(): Promise<unknown>;
  };
}

interface AccountsProps {
  onClose?: () => void;
}

const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

function Accounts({ onClose }: AccountsProps) {
  const { t } = useLingui();
  const { masto } = api();
  // Accounts
  const accounts = getAccounts() as OAuthAccount[];
  const currentAccount = getCurrentAccountID();
  const moreThanOneAccount = accounts.length > 1;

  const [, reload] = useReducer<number, void>((x: number) => x + 1, 0);
  const [accountsListParent] = useAutoAnimate<HTMLUListElement>();

  return (
    <div id="accounts-container" class="sheet" tabIndex={-1}>
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header class="header-grid">
        <h2>
          <Trans>Accounts</Trans>
        </h2>
      </header>
      <main>
        <section>
          <ul class="accounts-list" ref={accountsListParent}>
            {accounts.map((account, i) => {
              const isCurrent = account.info.id === currentAccount;
              const isDefault = i === 0; // first account is always default
              const isLoggedOut = !account.accessToken;

              const removeAccount = () => {
                accounts.splice(i, 1);
                saveAccounts(accounts as unknown as StoredAccount[]);
                try {
                  if (store.session.get('currentAccount') === account.info.id) {
                    store.session.del('currentAccount');
                  }
                } catch (e) {}
              };

              const logOutAccount = async () => {
                // JS original forwarded `clientId`/`clientSecret`/token as-is
                // (which may be `undefined` on older/logged-out accounts).
                // Preserve that by casting; do not coerce to ''.
                await revokeAccessToken({
                  instanceURL: account.instanceURL,
                  client_id: account.clientId as unknown as string,
                  client_secret: account.clientSecret as unknown as string,
                  token: account.accessToken as unknown as string,
                });
              };

              // JS treats these as untyped strings; cast preserves runtime
              // behavior (NameText interpolates them as-is). `avatarStatic` is
              // typed `unknown` on AccountInfo, so cast at the read site.
              const acct = account.info.acct as unknown as string;
              const avatarStatic = account.info.avatarStatic as
                | string
                | undefined;
              const username = account.info.username as unknown as string;

              return (
                <li key={account.info.id}>
                  <div>
                    {moreThanOneAccount && (
                      <span class={`current ${isCurrent ? 'is-current' : ''}`}>
                        <Icon icon="check-circle" alt={t`Current`} />
                      </span>
                    )}
                    <Avatar
                      url={avatarStatic}
                      size="xxl"
                      onDblClick={async () => {
                        if (isCurrent) {
                          try {
                            const accountsApi = masto.v1
                              .accounts as unknown as MastoAccountsSelect;
                            const info = await accountsApi
                              .$select(account.info.id)
                              .fetch();
                            console.log('fetched account info', info);
                            (account as { info: unknown }).info = info;
                            saveAccounts(accounts as unknown as StoredAccount[]);
                            reload();
                          } catch (e) {}
                        }
                      }}
                    />
                    <NameText
                      account={
                        (moreThanOneAccount
                          ? {
                              ...account.info,
                              acct: /@/.test(acct)
                                ? acct
                                : `${acct}@${account.instanceURL}`,
                            }
                          : account.info) as unknown as Parameters<
                          typeof NameText
                        >[0]['account']
                      }
                      showAcct
                      onClick={() => {
                        haptics.trigger('medium');
                        if (isLoggedOut) {
                          location.href = `/#/login?instance=${account.instanceURL}`;
                          onClose?.();
                        } else if (isCurrent) {
                          states.showAccount = `${username}@${account.instanceURL}`;
                        } else {
                          setCurrentAccountID(account.info.id);
                          location.reload();
                        }
                      }}
                    />
                  </div>
                  <div class="actions">
                    {isLoggedOut && (
                      <span class="tag">
                        <Trans>Logged out</Trans>
                      </span>
                    )}
                    {isDefault && moreThanOneAccount && (
                      <>
                        <span class="tag">
                          <Trans>Default</Trans>
                        </span>{' '}
                      </>
                    )}
                    <Menu2
                      align="end"
                      menuButton={
                        <button type="button" class="plain more-button">
                          <Icon icon="more" size="l" alt={t`More`} />
                        </button>
                      }
                    >
                      {moreThanOneAccount && (
                        <>
                          <MenuItem
                            disabled={isCurrent || isLoggedOut}
                            onClick={() => {
                              setCurrentAccountID(account.info.id);
                              location.reload();
                            }}
                          >
                            <Icon icon="transfer" />{' '}
                            <Trans>Switch to this account</Trans>
                          </MenuItem>
                          {!isStandalone && !isCurrent && !isLoggedOut && (
                            <MenuLink
                              href={`./?account=${account.info.id}`}
                              target="_blank"
                            >
                              <Icon icon="external" />
                              <span>
                                <Trans>Switch in new tab/window</Trans>
                              </span>
                            </MenuLink>
                          )}
                          <MenuDivider />
                        </>
                      )}
                      <MenuItem
                        onClick={() => {
                          states.showAccount = `${username}@${account.instanceURL}`;
                        }}
                      >
                        <Icon icon="user" />
                        <span>
                          <Trans>View profile…</Trans>
                        </span>
                      </MenuItem>
                      <MenuDivider />
                      {moreThanOneAccount && (
                        <>
                          <MenuItem
                            disabled={isDefault || isLoggedOut}
                            onClick={() => {
                              // Move account to the top of the list
                              accounts.splice(i, 1);
                              accounts.unshift(account);
                              saveAccounts(accounts as unknown as StoredAccount[]);
                              reload();
                            }}
                          >
                            <Icon icon="check-circle" />
                            <span>
                              <Trans>Set as default</Trans>
                            </span>
                          </MenuItem>
                          <MenuItem
                            disabled={i <= 1}
                            onClick={() => {
                              // Move account one position up
                              accounts.splice(i, 1);
                              accounts.splice(i - 1, 0, account);
                              saveAccounts(accounts as unknown as StoredAccount[]);
                              reload();
                            }}
                          >
                            <Icon icon="arrow-up" />
                            <span>
                              <Trans>Move up</Trans>
                            </span>
                          </MenuItem>
                          <MenuItem
                            disabled={i === 0 || i === accounts.length - 1}
                            onClick={() => {
                              // Move account one position down
                              accounts.splice(i, 1);
                              accounts.splice(i + 1, 0, account);
                              saveAccounts(accounts as unknown as StoredAccount[]);
                              reload();
                            }}
                          >
                            <Icon icon="arrow-down" />
                            <span>
                              <Trans>Move down</Trans>
                            </span>
                          </MenuItem>
                          <MenuDivider />
                        </>
                      )}
                      {!isLoggedOut ? (
                        <MenuConfirm
                          subMenu
                          confirmLabel={
                            <>
                              <Icon icon="exit" />
                              <span>
                                <Trans>
                                  Log out{' '}
                                  <span class="bidi-isolate">@{acct}</span>?
                                </Trans>
                              </span>
                            </>
                          }
                          menuItemClassName="danger"
                          onClick={async () => {
                            await logOutAccount();
                            delete (account as { accessToken?: string })
                              .accessToken;
                            saveAccounts(accounts as unknown as StoredAccount[]);
                            reload();
                          }}
                          menuExtras={
                            <MenuItem
                              className="danger"
                              onClick={async () => {
                                await logOutAccount();
                                removeAccount();
                                location.href = location.pathname || '/';
                              }}
                            >
                              <Icon icon="x" />
                              <span>
                                <Trans>
                                  Log out and remove{' '}
                                  <span class="bidi-isolate">@{acct}</span>
                                </Trans>
                              </span>
                            </MenuItem>
                          }
                        >
                          <Icon icon="exit" />
                          <span>
                            <Trans>Log out…</Trans>
                          </span>
                        </MenuConfirm>
                      ) : (
                        <MenuConfirm
                          subMenu
                          confirmLabel={
                            <>
                              <Icon icon="x" />
                              <span>
                                <Trans>
                                  Remove{' '}
                                  <span class="bidi-isolate">@{acct}</span>?
                                </Trans>
                              </span>
                            </>
                          }
                          menuItemClassName="danger"
                          onClick={() => {
                            removeAccount();
                            reload();
                          }}
                        >
                          <Icon icon="x" />
                          <span>
                            <Trans>Remove account…</Trans>
                          </span>
                        </MenuConfirm>
                      )}
                      {!!account?.createdAt && (
                        <div class="footer">
                          <Icon icon="account-add" />
                          <span>
                            <Trans>
                              Connected on {niceDateTime(account.createdAt)} (
                              <RelativeTime datetime={account.createdAt} />)
                            </Trans>
                          </span>
                        </div>
                      )}
                    </Menu2>
                  </div>
                </li>
              );
            })}
          </ul>
          <p>
            <Link to="/login" class="button plain2" onClick={onClose}>
              <Icon icon="plus" />{' '}
              <span>
                <Trans>Add an existing account</Trans>
              </span>
            </Link>
          </p>
          {moreThanOneAccount && (
            <p>
              <small>
                <Trans>
                  Note: <i>Default</i> account will always be used for first
                  load. Switched accounts will persist during the session.
                </Trans>
              </small>
            </p>
          )}
          <p>
            <button
              type="button"
              class="light"
              onClick={() => (states.showImportExportAccounts = true)}
            >
              <Trans>Import/export</Trans>
            </button>
          </p>
        </section>
      </main>
    </div>
  );
}

export default Accounts;

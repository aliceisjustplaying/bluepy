import './accounts.css';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import { useState } from 'react';

import Avatar from '../components/avatar';
import Icon from '../components/icon';
import Link from '../components/link';
import MenuConfirm from '../components/menu-confirm';
import MenuLink from '../components/menu-link';
import Menu2 from '../components/menu2';
import NameText, { type NameTextProps } from '../components/name-text';
import RelativeTime from '../components/relative-time';
import { getAccountProfileTarget } from '../utils/account-profile-target';
import { api, getMastoV1Resource } from '../utils/api';
import { revokeAccessToken } from '../utils/auth';
import haptics from '../utils/haptics';
import niceDateTime from '../utils/nice-date-time';
import { navigatePath } from '../utils/router';
import states from '../utils/states';
import store from '../utils/store';
import {
  getAccounts,
  getCurrentAccountID,
  saveAccounts,
  setCurrentAccountID,
  type StoredAccount,
} from '../utils/store-utils';

type AccountsNameTextAccount = NonNullable<NameTextProps['account']>;

type OAuthAccount = StoredAccount & {
  clientId?: string;
  clientSecret?: string;
  info: StoredAccount['info'] & AccountsNameTextAccount;
};

type AccountsClient = ReturnType<typeof api>['masto'];

interface AccountsSelectResource {
  $select(id: string): {
    fetch(): Promise<unknown>;
  };
}

interface AccountsProps {
  onClose?: () => void;
}

interface AccountListItemProps {
  account: OAuthAccount;
  accountIndex: number;
  accounts: StoredAccount[];
  client: AccountsClient;
  currentAccount: string | null | undefined;
  moreThanOneAccount: boolean;
  onClose?: () => void;
  reload: () => void;
  saveOAuthAccounts: () => void;
}

const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

function hasAccountsNameTextInfo(
  account: StoredAccount,
): account is OAuthAccount {
  const { info } = account;
  return (
    typeof info.acct === 'string' &&
    typeof info.id === 'string' &&
    typeof info.url === 'string' &&
    typeof info.username === 'string'
  );
}

function AccountListItem({
  account,
  accountIndex,
  accounts,
  client,
  currentAccount,
  moreThanOneAccount,
  onClose,
  reload,
  saveOAuthAccounts,
}: AccountListItemProps) {
  const { t } = useLingui();
  const isCurrent = account.info.id === currentAccount;
  const isDefault = accountIndex === 0; // first account is always default
  const isLoggedOut = !account.accessToken;

  const removeAccount = () => {
    if (accountIndex >= 0) accounts.splice(accountIndex, 1);
    saveOAuthAccounts();
    try {
      if (store.session.get('currentAccount') === account.info.id) {
        store.session.del('currentAccount');
      }
    } catch {}
  };

  const logOutAccount = async () => {
    await revokeAccessToken({
      instanceURL: account.instanceURL,
      client_id: String(account.clientId),
      client_secret: String(account.clientSecret),
      token: account.accessToken,
    });
  };

  const { acct, avatarStatic } = account.info;

  return (
    <li>
      <div>
        {moreThanOneAccount && (
          <span className={`current ${isCurrent ? 'is-current' : ''}`}>
            <Icon icon="check-circle" alt={t`Current`} />
          </span>
        )}
        <Avatar
          url={avatarStatic}
          size="xxl"
          onDoubleClick={async () => {
            if (isCurrent) {
              try {
                const accountsApi = getMastoV1Resource<AccountsSelectResource>(
                  client,
                  'accounts',
                );
                const info = await accountsApi.$select(account.info.id).fetch();
                console.log('fetched account info', info);
                (account as { info: unknown }).info = info;
                saveOAuthAccounts();
                reload();
              } catch {}
            }
          }}
        />
        <NameText
          account={account.info}
          showAcct
          onClick={() => {
            void haptics.trigger('medium');
            if (isLoggedOut) {
              navigatePath(`/login?instance=${account.instanceURL}`);
              onClose?.();
            } else if (isCurrent) {
              states.showAccount = getAccountProfileTarget(account);
            } else {
              setCurrentAccountID(account.info.id);
              location.reload();
            }
          }}
        />
      </div>
      <div className="actions">
        {isLoggedOut && (
          <span className="tag">
            <Trans>Logged out</Trans>
          </span>
        )}
        {isDefault && moreThanOneAccount && (
          <>
            <span className="tag">
              <Trans>Default</Trans>
            </span>{' '}
          </>
        )}
        <Menu2
          align="end"
          menuButton={
            <button type="button" className="plain more-button">
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
                <MenuLink href={`./?account=${account.info.id}`} target="_blank">
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
              states.showAccount = getAccountProfileTarget(account);
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
                  if (accountIndex < 0) return;
                  // Move account to the top of the list
                  accounts.splice(accountIndex, 1);
                  accounts.unshift(account);
                  saveOAuthAccounts();
                  reload();
                }}
              >
                <Icon icon="check-circle" />
                <span>
                  <Trans>Set as default</Trans>
                </span>
              </MenuItem>
              <MenuItem
                disabled={accountIndex <= 1}
                onClick={() => {
                  if (accountIndex < 0) return;
                  // Move account one position up
                  accounts.splice(accountIndex, 1);
                  accounts.splice(accountIndex - 1, 0, account);
                  saveOAuthAccounts();
                  reload();
                }}
              >
                <Icon icon="arrow-up" />
                <span>
                  <Trans>Move up</Trans>
                </span>
              </MenuItem>
              <MenuItem
                disabled={
                  accountIndex === 0 || accountIndex === accounts.length - 1
                }
                onClick={() => {
                  if (
                    accountIndex < 0 ||
                    accountIndex === accounts.length - 1
                  ) {
                    return;
                  }
                  // Move account one position down
                  accounts.splice(accountIndex, 1);
                  accounts.splice(accountIndex + 1, 0, account);
                  saveOAuthAccounts();
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
                      Log out <span className="bidi-isolate">@{acct}</span>?
                    </Trans>
                  </span>
                </>
              }
              menuItemClassName="danger"
              onClick={() => {
                void (async () => {
                  await logOutAccount();
                  delete (account as { accessToken?: string }).accessToken;
                  saveOAuthAccounts();
                  reload();
                })();
              }}
              menuExtras={
                <MenuItem
                  className="danger"
                  onClick={() => {
                    void (async () => {
                      await logOutAccount();
                      removeAccount();
                      location.href = location.pathname || '/';
                    })();
                  }}
                >
                  <Icon icon="x" />
                  <span>
                    <Trans>
                      Log out and remove{' '}
                      <span className="bidi-isolate">@{acct}</span>
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
                      Remove <span className="bidi-isolate">@{acct}</span>?
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
            <div className="footer">
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
}

function Accounts({ onClose }: AccountsProps) {
  const { t } = useLingui();
  const client = api().masto;
  // Accounts
  const accounts = getAccounts();
  const renderableAccounts = accounts.filter(hasAccountsNameTextInfo);
  const currentAccount = getCurrentAccountID();
  const moreThanOneAccount = accounts.length > 1;

  const [, setReloadTick] = useState(0);
  const reload = () => {
    setReloadTick((x) => x + 1);
  };
  const [accountsListParent] = useAutoAnimate<HTMLUListElement>();
  const saveOAuthAccounts = () => {
    saveAccounts(accounts);
  };

  return (
    <div id="accounts-container" className="sheet" tabIndex={-1}>
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header className="header-grid">
        <h2>
          <Trans>Accounts</Trans>
        </h2>
      </header>
      <main>
        <section>
          <ul className="accounts-list" ref={accountsListParent}>
            {renderableAccounts.map((account) => {
              const accountIndex = accounts.findIndex(
                (storedAccount) => storedAccount.info.id === account.info.id,
              );

              return (
                <AccountListItem
                  key={account.info.id}
                  account={account}
                  accountIndex={accountIndex}
                  accounts={accounts}
                  client={client}
                  currentAccount={currentAccount}
                  moreThanOneAccount={moreThanOneAccount}
                  onClose={onClose}
                  reload={reload}
                  saveOAuthAccounts={saveOAuthAccounts}
                />
              );
            })}
          </ul>
          <p>
            <Link to="/login" className="button plain2" onClick={onClose}>
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
              className="light"
              onClick={() => {
                states.showImportExportAccounts = true;
              }}
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

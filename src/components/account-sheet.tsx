import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
import { useEffect } from 'preact/hooks';

import { api } from '../utils/api';
import states from '../utils/states';
import useLocationChange from '../utils/useLocationChange';

import AccountInfoUntyped from './account-info';
import Icon from './icon';

interface AccountsLookupV1 {
  lookup(params: {
    acct: string;
    skip_webfinger?: boolean;
  }): Promise<mastodon.v1.Account>;
  $select(id: string): {
    fetch(): Promise<mastodon.v1.Account>;
  };
}

interface SearchV2Endpoint {
  list(params: {
    q: string;
    type: 'accounts';
    limit: number;
    resolve: boolean;
  }): Promise<{ accounts: mastodon.v1.Account[] }>;
}

interface AccountInfoProps {
  instance?: string;
  authenticated?: boolean;
  account: mastodon.v1.Account | string;
  fetchAccount?: () => Promise<mastodon.v1.Account | undefined>;
}
const AccountInfo = AccountInfoUntyped as unknown as ComponentType<AccountInfoProps>;

type AccountSheetCloseArg = { destination?: string } | Event | undefined;
type AccountSheetCloseHandler = (arg?: AccountSheetCloseArg) => void;

interface AccountSheetProps {
  account: mastodon.v1.Account | string;
  instance?: string;
  onClose?: AccountSheetCloseHandler | null;
}

function AccountSheet({
  account,
  instance: propInstance,
  onClose,
}: AccountSheetProps) {
  const { t } = useLingui();
  const { masto, instance, authenticated } = api({ instance: propInstance });
  const isString = typeof account === 'string';

  useEffect(() => {
    if (!isString) {
      states.accounts[`${account.id}@${instance}`] = account as unknown as Record<
        string,
        unknown
      >;
    }
  }, [account]);

  useLocationChange(onClose ?? null);

  return (
    <div
      class="sheet"
      // onClick={(e) => {
      //   const accountBlock = e.target.closest('.account-block');
      //   if (accountBlock) {
      //     onClose({
      //       destination: 'account-statuses',
      //     });
      //   }
      // }}
    >
      {!!onClose && (
        <button
          type="button"
          class="sheet-close outer"
          onClick={(e) => onClose(e)}
        >
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <AccountInfo
        instance={instance}
        authenticated={authenticated}
        account={account}
        fetchAccount={async () => {
          if (isString) {
            const accountsEndpoint =
              masto.v1.accounts as unknown as AccountsLookupV1;
            const searchEndpoint =
              masto.v2.search as unknown as SearchV2Endpoint;
            try {
              const info = await accountsEndpoint.lookup({
                acct: account,
                skip_webfinger: false,
              });
              return info;
            } catch (e) {
              const result = await searchEndpoint.list({
                q: account,
                type: 'accounts',
                limit: authenticated ? 1 : 11, // Magic number
                resolve: authenticated,
              });
              if (result.accounts.length) {
                const accountWithSameString = result.accounts.find(
                  (a) => a.url === account || account.startsWith(a.url),
                );
                if (accountWithSameString) {
                  return accountWithSameString;
                }
              }
              if (/^https?:\/\/[^/]+\/@[^/]+$/.test(account)) {
                const accountURL = URL.parse(account);
                if (accountURL) {
                  const { hostname, pathname } = accountURL;
                  const acct =
                    pathname.replace(/^\//, '').replace(/\/$/, '') +
                    '@' +
                    hostname;
                  const result = await searchEndpoint.list({
                    q: acct,
                    type: 'accounts',
                    limit: 1,
                    resolve: authenticated,
                  });
                  if (result.accounts.length) {
                    return result.accounts[0];
                  }
                }
              }
              return undefined;
            }
          } else {
            const accountsEndpoint =
              masto.v1.accounts as unknown as AccountsLookupV1;
            return accountsEndpoint.$select(account.id).fetch();
          }
        }}
      />
    </div>
  );
}

export default AccountSheet;

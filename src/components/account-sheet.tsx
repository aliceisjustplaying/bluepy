import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useEffect } from 'preact/hooks';

import { api, getMastoV1Resource, getMastoV2Resource } from '../utils/api';
import states from '../utils/states';
import useLocationChange from '../utils/useLocationChange';

import AccountInfo from './account-info';
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
      states.accounts[`${account.id}@${instance}`] = { ...account };
    }
  }, [account, isString, instance]);

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
            const accountsEndpoint = getMastoV1Resource<AccountsLookupV1>(
              masto,
              'accounts',
            );
            const searchEndpoint = getMastoV2Resource<SearchV2Endpoint>(
              masto,
              'search',
            );
            try {
              const info = await accountsEndpoint.lookup({
                acct: account,
                skip_webfinger: false,
              });
              return info;
            } catch {
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
                  const urlResult = await searchEndpoint.list({
                    q: acct,
                    type: 'accounts',
                    limit: 1,
                    resolve: authenticated,
                  });
                  if (urlResult.accounts.length) {
                    return urlResult.accounts[0];
                  }
                }
              }
              return undefined;
            }
          } else {
            const accountsEndpoint = getMastoV1Resource<AccountsLookupV1>(
              masto,
              'accounts',
            );
            return accountsEndpoint.$select(account.id).fetch();
          }
        }}
      />
    </div>
  );
}

export default AccountSheet;

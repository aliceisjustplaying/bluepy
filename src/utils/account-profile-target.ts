import type { StoredAccount } from './store-utils';

export interface AccountProfileTarget {
  account: string;
  instance: string;
}

function getAccountName(info: StoredAccount['info']): string {
  const username = typeof info.username === 'string' ? info.username : '';
  const acct = typeof info.acct === 'string' ? info.acct : '';
  return username || acct || info.id;
}

export function getAccountProfileTarget(
  account: Pick<StoredAccount, 'info' | 'instanceURL'>,
): AccountProfileTarget {
  return {
    account: getAccountName(account.info),
    instance: account.instanceURL,
  };
}

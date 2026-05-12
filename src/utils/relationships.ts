import type { mastodon } from 'masto';

import { api } from './api';
import { getCurrentAccountID } from './store-utils';

interface AccountLike {
  readonly id: string;
}

interface RelationshipsResource {
  readonly relationships: {
    fetch(params: {
      readonly id: readonly string[];
    }): Promise<mastodon.v1.Relationship[]>;
  };
}

export async function fetchRelationships(
  accounts: readonly AccountLike[] | null | undefined,
  relationshipsMap: Record<string, mastodon.v1.Relationship> = {},
): Promise<Record<string, mastodon.v1.Relationship> | null | undefined> {
  if (!accounts?.length) return;
  const { masto } = api();

  const currentAccount = getCurrentAccountID();
  const uniqueAccountIds = accounts.reduce<string[]>((acc, a) => {
    // 1. Ignore duplicate accounts
    // 2. Ignore accounts that are already inside relationshipsMap
    // 3. Ignore currently logged in account
    if (
      !acc.includes(a.id) &&
      !relationshipsMap[a.id] &&
      a.id !== currentAccount
    ) {
      acc.push(a.id);
    }
    return acc;
  }, []);
  if (!uniqueAccountIds.length) return null;

  try {
    const accountsResource = masto.v1
      .accounts as unknown as RelationshipsResource;
    const relationships = await accountsResource.relationships.fetch({
      id: uniqueAccountIds,
    });
    const newRelationshipsMap = relationships.reduce<
      Record<string, mastodon.v1.Relationship>
    >((acc, r) => {
      acc[r.id] = r;
      return acc;
    }, {});
    return newRelationshipsMap;
  } catch (e) {
    console.error(e);
    // It's okay to fail
    return null;
  }
}

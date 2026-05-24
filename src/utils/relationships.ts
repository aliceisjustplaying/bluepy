import type { mastodon } from 'masto';

import { api, getMastoV1Resource } from './api';
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

// The ATProto relationship adapter hydrates profile rows through
// app.bsky.actor.getProfiles, which caps each request at 25 actors.
const ATPROTO_GET_PROFILES_LIMIT = 25;

export async function fetchRelationships(
  accounts: readonly AccountLike[] | null | undefined,
  relationshipsMap: Record<string, mastodon.v1.Relationship> = {},
): Promise<Record<string, mastodon.v1.Relationship> | null | undefined> {
  if (!accounts?.length) return undefined;
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
    const accountsResource = getMastoV1Resource<RelationshipsResource>(
      masto,
      'accounts',
    );
    const relationshipPages = await Promise.all(
      Array.from(
        { length: Math.ceil(uniqueAccountIds.length / ATPROTO_GET_PROFILES_LIMIT) },
        (_, pageIndex) => {
          const offset = pageIndex * ATPROTO_GET_PROFILES_LIMIT;
          return accountsResource.relationships.fetch({
            id: uniqueAccountIds.slice(
              offset,
              offset + ATPROTO_GET_PROFILES_LIMIT,
            ),
          });
        },
      ),
    );
    const relationships = relationshipPages.flat();
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

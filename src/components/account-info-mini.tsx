import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useRef } from 'react';

import type { AtprotoCompat } from '../types/atproto-compat';
import { api, getCompatV1Resource } from '../utils/api';
import shortenNumber from '../utils/shorten-number';
import states from '../utils/states';

import Link from './link';

const LIMIT = 80;

type AccountWithHideCollections = AtprotoCompat.v1.Account & {
  hideCollections?: boolean | null;
};

interface AccountInfoMiniProps {
  account?: AccountWithHideCollections | null;
  instance?: string;
}

export default function AccountInfoMini({
  account,
  instance,
}: AccountInfoMiniProps) {
  const { t } = useLingui();

  const followersIterator = useRef<
    AsyncIterator<AtprotoCompat.v1.Account[]> | undefined
  >(undefined);
  const followingIterator = useRef<
    AsyncIterator<AtprotoCompat.v1.Account[]> | undefined
  >(undefined);

  if (!account) return null;

  const { followersCount, followingCount, statusesCount, id, hideCollections } =
    account;
  const accountLink = instance ? `/${instance}/a/${id}` : `/a/${id}`;

  const { compat } = api({ instance });
  const accountsResource =
    getCompatV1Resource<AtprotoCompat.rest.v1.AccountsResource>(
      compat,
      'accounts',
    );

  async function fetchFollowers(firstLoad?: boolean) {
    if (!id) return { value: [], done: true };
    if (firstLoad || !followersIterator.current) {
      followersIterator.current = accountsResource
        .$select(id)
        .followers.list({ limit: LIMIT })
        .values();
    }
    return await followersIterator.current.next();
  }

  async function fetchFollowing(firstLoad?: boolean) {
    if (!id) return { value: [], done: true };
    if (firstLoad || !followingIterator.current) {
      followingIterator.current = accountsResource
        .$select(id)
        .following.list({ limit: LIMIT })
        .values();
    }
    return await followingIterator.current.next();
  }

  return (
    <div className="account-container mini">
      <div className="account-metadata-box">
        <div className="stats">
          <button
            type="button"
            className="account-stat-button"
            onClick={() => {
              setTimeout(() => {
                states.showGenericAccounts = {
                  id: 'followers',
                  heading: t`Followers`,
                  fetchAccounts: fetchFollowers,
                  instance,
                  blankCopy: hideCollections
                    ? t`This user has chosen to not make this information available.`
                    : undefined,
                };
              }, 0);
            }}
          >
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
          </button>
          <button
            type="button"
            className="account-stat-button insignificant"
            onClick={() => {
              setTimeout(() => {
                states.showGenericAccounts = {
                  heading: t({
                    id: 'following.stats',
                    message: 'Following',
                  }),
                  fetchAccounts: fetchFollowing,
                  instance,
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
          </button>
          <Link className="insignificant" to={accountLink}>
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
          </Link>
        </div>
      </div>
    </div>
  );
}

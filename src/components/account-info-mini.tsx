import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useCallback, useEffect, useRef } from 'react';

import { useFollowers, useFollows } from '../data/profiles';
import { profileToAccount } from '../render/profile-view-map';
import shortenNumber from '../utils/shorten-number';
import states from '../utils/states';

import Link from './link';

type AccountWithHideCollections = mastodon.v1.Account & {
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

  const followersOffsetRef = useRef<number>(0);
  const followingOffsetRef = useRef<number>(0);
  const subjectDid = account?.id;
  const followersSource = useFollowers(subjectDid, { enabled: false });
  const followingSource = useFollows(subjectDid, { enabled: false });

  useEffect(() => {
    followersOffsetRef.current = 0;
    followingOffsetRef.current = 0;
  }, [subjectDid]);

  const fetchFollowers = useCallback(
    async (firstLoad?: boolean) => {
      if (!subjectDid) return { value: [], done: true };
      if (firstLoad) followersOffsetRef.current = 0;
      const snapshot = firstLoad
        ? await followersSource.refetchItems()
        : await followersSource.loadMoreItems();
      const value = snapshot.items
        .slice(followersOffsetRef.current)
        .map(profileToAccount);
      followersOffsetRef.current = snapshot.items.length;
      return { value, done: !snapshot.hasMore };
    },
    [followersSource, subjectDid],
  );

  const fetchFollowing = useCallback(
    async (firstLoad?: boolean) => {
      if (!subjectDid) return { value: [], done: true };
      if (firstLoad) followingOffsetRef.current = 0;
      const snapshot = firstLoad
        ? await followingSource.refetchItems()
        : await followingSource.loadMoreItems();
      const value = snapshot.items
        .slice(followingOffsetRef.current)
        .map(profileToAccount);
      followingOffsetRef.current = snapshot.items.length;
      return { value, done: !snapshot.hasMore };
    },
    [followingSource, subjectDid],
  );

  if (!account) return null;

  const { followersCount, followingCount, statusesCount, id, hideCollections } =
    account;
  const accountLink = instance ? `/${instance}/a/${id}` : `/a/${id}`;

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

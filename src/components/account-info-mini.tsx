import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentChildren, ComponentType } from 'preact';
import { useRef } from 'preact/hooks';

import { api } from '../utils/api';
import shortenNumber from '../utils/shorten-number';
import states from '../utils/states';

import LinkUntyped from './link';

interface LinkProps {
  to: string;
  class?: string;
  children?: ComponentChildren;
}
const Link = LinkUntyped as unknown as ComponentType<LinkProps>;

const LIMIT = 80;

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

  const followersIterator = useRef<
    AsyncIterator<mastodon.v1.Account[]> | undefined
  >(undefined);
  const followingIterator = useRef<
    AsyncIterator<mastodon.v1.Account[]> | undefined
  >(undefined);

  if (!account) return null;

  const { followersCount, followingCount, statusesCount, id, hideCollections } =
    account;
  const accountLink = instance ? `/${instance}/a/${id}` : `/a/${id}`;

  const { masto } = api({ instance });
  const accountsResource = masto.v1
    .accounts as unknown as mastodon.rest.v1.AccountsResource;

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

  // TODO(oxlint:jsx-a11y/prefer-tag-over-role) The two stats triggers are
  // rendered as `<div role="button">` to match the existing
  // `.account-container .stats` visual layout — converting to
  // `<button class="plain">` adds a backdrop-filter and link-color tint
  // that visibly regress the UI. A proper a11y fix requires accompanying
  // CSS in `account-info.css` (outside this batch); keeping the div with
  // role/tabIndex/onKeyDown a11y wiring.
  return (
    <div class="account-container mini">
      <div class="account-metadata-box">
        <div class="stats">
          <div
            role="button"
            tabIndex={0}
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
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
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
          </div>
          <div
            class="insignificant"
            role="button"
            tabIndex={0}
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
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
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
          </div>
          <Link class="insignificant" to={accountLink}>
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

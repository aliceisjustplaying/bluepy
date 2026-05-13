import './generic-accounts.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType, ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { useSnapshot } from 'valtio';

import { api } from '../utils/api';
import { fetchRelationships } from '../utils/relationships';
import states from '../utils/states';
import useLocationChange from '../utils/useLocationChange';

import AccountBlock from './account-block';
import Icon from './icon';
import Link from './link';
import Loader from './loader';
import StatusUntyped from './status';

// `status.jsx` has not been migrated yet; type it permissively here.
function Status(props: {
  status?: unknown;
  size?: string;
  readOnly?: boolean;
  [key: string]: unknown;
}) {
  const Inner = StatusUntyped as unknown as ComponentType<{
  status?: unknown;
  size?: string;
  readOnly?: boolean;
  [key: string]: unknown;
}>;
  return <Inner {...props} />;
}

// `react-intersection-observer`'s `InView` ships without working JSX
// component typings under our preact compat resolution. Re-type as a
// preact component with the props this batch actually uses.
function InViewTyped(props: {
  onChange?: (inView: boolean) => void;
  children?: ComponentChildren;
}) {
  const Inner = InViewUntyped as unknown as ComponentType<{
  onChange?: (inView: boolean) => void;
  children?: ComponentChildren;
}>;
  return <Inner {...props} />;
}

// TODO(oxlint:no-underscore-dangle) `_types` is a shared internal cache key
// on account records used by status.tsx and notification.tsx. Renaming requires
// a cross-cutting refactor and is out of scope.
interface AccountWithTypes extends mastodon.v1.Account {
  _types: string[];
}

// Fetched accounts may or may not have `_types`; we coerce when adding to
// the local list. The local list always carries `_types`.
type FetchedAccount = mastodon.v1.Account & { _types?: string[] };

interface FetchAccountsResult {
  done: boolean;
  value?: FetchedAccount[];
}

interface ShowGenericAccountsState {
  id?: string;
  heading?: string;
  fetchAccounts?: (firstLoad?: boolean) => Promise<FetchAccountsResult>;
  accounts?: AccountWithTypes[];
  showReactions?: boolean;
}

interface GenericAccountsProps {
  instance?: string;
  excludeRelationshipAttrs?: readonly string[];
  postID?: string;
  onClose?: () => void;
  blankCopy?: string;
}

export default function GenericAccounts({
  instance,
  excludeRelationshipAttrs = [],
  postID,
  onClose = () => {},
  blankCopy,
}: GenericAccountsProps) {
  const { t } = useLingui();
  const { instance: currentInstance } = api();
  const isCurrentInstance = instance ? instance === currentInstance : true;
  const snapStates = useSnapshot(states);

  const [uiState, setUIState] = useState('default');
  const [showMore, setShowMore] = useState(false);

  const showGenericAccountsState = snapStates.showGenericAccounts as
    | ShowGenericAccountsState
    | false;
  const staticAccounts = showGenericAccountsState
    ? showGenericAccountsState.accounts
    : undefined;
  // The modal is only mounted when `showGenericAccounts` is truthy (see
  // modals.tsx), so the lazy initializer captures the snapshotted
  // `staticAccounts` synchronously at mount — matching the JS original
  // where this `useState` was reached only after a truthy guard.
  const [accounts, setAccounts] = useState<AccountWithTypes[]>(() =>
    staticAccounts?.length ? [...staticAccounts] : [],
  );

  const [relationshipsMap, setRelationshipsMap] = useState<
    Record<string, mastodon.v1.Relationship>
  >({});

  const firstLoad = useRef(true);

  useLocationChange(onClose);

  const id = showGenericAccountsState ? showGenericAccountsState.id : undefined;
  const heading = showGenericAccountsState
    ? showGenericAccountsState.heading
    : undefined;
  const fetchAccounts = showGenericAccountsState
    ? showGenericAccountsState.fetchAccounts
    : undefined;
  const showReactions = showGenericAccountsState
    ? showGenericAccountsState.showReactions
    : undefined;

  const loadRelationships = async (loadFor: AccountWithTypes[]) => {
    if (!loadFor?.length) return;
    if (!isCurrentInstance) return;
    const relationships = await fetchRelationships(loadFor, relationshipsMap);
    if (relationships) {
      setRelationshipsMap({
        ...relationshipsMap,
        ...relationships,
      });
    }
  };

  const loadAccounts = (firstLoadFlag?: boolean) => {
    if (!fetchAccounts) return;
    if (firstLoadFlag && !accounts?.length) setAccounts([]);
    setUIState('loading');
    void (async () => {
      try {
        const { done, value } = await fetchAccounts(firstLoadFlag);
        if (Array.isArray(value)) {
          if (firstLoadFlag) {
            const merged: AccountWithTypes[] = [];
            for (let i = 0; i < value.length; i++) {
              const account = value[i];
              const theAccount = merged.find(
                (a, j) => a.id === account.id && i !== j,
              );
              if (!theAccount) {
                merged.push({
                  ...account,
                  _types: account._types ?? [],
                });
              } else {
                theAccount._types.push(...(account._types as string[]));
              }
            }
            setAccounts(merged);
          } else {
            // setAccounts((prev) => [...prev, ...value]);
            // Merge accounts by id and _types
            setAccounts((prev) => {
              const newAccounts = prev;
              for (const account of value) {
                const theAccount = newAccounts.find((a) => a.id === account.id);
                if (!theAccount) {
                  newAccounts.push(account as AccountWithTypes);
                } else {
                  theAccount._types.push(...(account._types as string[]));
                }
              }
              return newAccounts;
            });
          }
          setShowMore(!done);

          void loadRelationships(value as AccountWithTypes[]);
        } else {
          setShowMore(false);
        }
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  };

  useEffect(() => {
    if (!showGenericAccountsState) return;
    if (accounts?.length > 0) {
      // setAccounts(staticAccounts);
      if (fetchAccounts) {
        loadAccounts(true);
        firstLoad.current = false;
      } else {
        void loadRelationships(accounts);
      }
    } else {
      loadAccounts(true);
      firstLoad.current = false;
    }
    // TODO(oxlint:react-hooks/exhaustive-deps): intentionally only reacts to
    // `fetchAccounts` identity changes; adding `accounts`/`loadAccounts`/
    // `loadRelationships` would cause refetch loops.
  }, [fetchAccounts]);

  useEffect(() => {
    if (firstLoad.current) return;
    // reloadGenericAccounts contains value like {id: 'mute', counter: 1}
    // We only need to reload if the id matches
    if (snapStates.reloadGenericAccounts?.id === id) {
      loadAccounts(true);
    }
    // TODO(oxlint:react-hooks/exhaustive-deps): intentionally only triggers on
    // counter change; `id` and `loadAccounts` would loop and we want
    // counter-triggered refresh, not id-triggered.
  }, [snapStates.reloadGenericAccounts.counter]);

  if (!showGenericAccountsState) {
    return null;
  }

  const post = postID ? states.statuses[postID] : undefined;

  return (
    <div id="generic-accounts-container" class="sheet" tabindex={-1}>
      <button type="button" class="sheet-close" onClick={onClose}>
        <Icon icon="x" alt={t`Close`} />
      </button>
      <header>
        <h2>{heading || t`Accounts`}</h2>
      </header>
      <main>
        {post && (
          <Link
            to={`/${instance || currentInstance}/s/${post.id}`}
            class="post-preview"
          >
            <Status status={post} size="s" readOnly />
          </Link>
        )}
        {accounts.length > 0 ? (
          <>
            <ul class="accounts-list">
              {accounts.map((account) => {
                const relationship = relationshipsMap[account.id];
                const key = `${account.id}-${account._types?.length || ''}`;
                return (
                  <li key={key}>
                    {showReactions && account._types?.length > 0 && (
                      <div class="reactions-block">
                        {account._types.map((type) => (
                          <Icon
                            key={type}
                            icon={
                              {
                                reblog: 'rocket',
                                favourite: 'heart',
                              }[type]
                            }
                            class={`${type}-icon`}
                          />
                        ))}
                      </div>
                    )}
                    <div class="account-relationships">
                      <AccountBlock
                        account={account}
                        showStats
                        relationship={relationship}
                        excludeRelationshipAttrs={excludeRelationshipAttrs}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            {uiState === 'default' ? (
              showMore ? (
                <InViewTyped
                  onChange={(inView: boolean) => {
                    if (inView) {
                      loadAccounts();
                    }
                  }}
                >
                  <button
                    type="button"
                    class="plain block"
                    onClick={() => loadAccounts()}
                  >
                    <Trans>Show more…</Trans>
                  </button>
                </InViewTyped>
              ) : (
                <p class="ui-state insignificant">
                  <Trans>The end.</Trans>
                </p>
              )
            ) : (
              uiState === 'loading' && (
                <p class="ui-state">
                  <Loader abrupt />
                </p>
              )
            )}
          </>
        ) : uiState === 'loading' ? (
          <p class="ui-state">
            <Loader abrupt />
          </p>
        ) : uiState === 'error' ? (
          <p class="ui-state">
            <Trans>Error loading accounts</Trans>
          </p>
        ) : (
          <p class="ui-state insignificant">
            {blankCopy || t`Nothing to show`}
          </p>
        )}
      </main>
    </div>
  );
}

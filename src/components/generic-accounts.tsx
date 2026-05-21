import './generic-accounts.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import { api } from '../utils/api';
import { fetchRelationships } from '../utils/relationships';
import states from '../utils/states';
import useLocationChange from '../utils/useLocationChange';

import AccountBlock from './account-block';
import Icon from './icon';
import InView from './in-view';
import Link from './link';
import Loader from './loader';
import Status from './status-proxy';

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

function parseGenericAccountsState(
  value: unknown,
): ShowGenericAccountsState | false {
  return value && typeof value === 'object' ? value : false;
}

function mergeTypes(account: FetchedAccount): AccountWithTypes {
  return {
    ...account,
    _types: account._types ?? [],
  };
}

interface GenericAccountsProps {
  instance?: string;
  excludeRelationshipAttrs?: readonly string[];
  postID?: string;
  onClose?: () => void;
  blankCopy?: string;
}

interface GenericAccountsListProps {
  accounts: AccountWithTypes[];
  excludeRelationshipAttrs: readonly string[];
  relationshipsMap: Record<string, mastodon.v1.Relationship>;
  showReactions?: boolean;
}

const EMPTY_EXCLUDED_RELATIONSHIP_ATTRS: readonly string[] = [];

function GenericAccountsList({
  accounts,
  excludeRelationshipAttrs,
  relationshipsMap,
  showReactions,
}: GenericAccountsListProps) {
  return (
    <ul className="accounts-list">
      {accounts.map((account) => {
        const relationship = relationshipsMap[account.id];
        const key = `${account.id}-${account._types?.length || ''}`;
        return (
          <li key={key}>
            {showReactions && account._types?.length > 0 && (
              <div className="reactions-block">
                {account._types.map((type) => (
                  <Icon
                    key={type}
                    icon={
                      {
                        reblog: 'rocket',
                        favourite: 'heart',
                      }[type]
                    }
                    className={`${type}-icon`}
                  />
                ))}
              </div>
            )}
            <div className="account-relationships">
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
  );
}

export default function GenericAccounts({
  instance,
  excludeRelationshipAttrs = EMPTY_EXCLUDED_RELATIONSHIP_ATTRS,
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

  const shownGenericAccounts = parseGenericAccountsState(
    snapStates.showGenericAccounts,
  );
  const staticAccounts = shownGenericAccounts
    ? shownGenericAccounts.accounts
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

  const id = shownGenericAccounts ? shownGenericAccounts.id : undefined;
  const heading = shownGenericAccounts
    ? shownGenericAccounts.heading
    : undefined;
  const fetchAccounts = shownGenericAccounts
    ? shownGenericAccounts.fetchAccounts
    : undefined;
  const showReactions = shownGenericAccounts
    ? shownGenericAccounts.showReactions
    : undefined;

  // Mirror `accounts` into a ref so the stable callbacks below can read the
  // latest value without listing `accounts` as a dep (which would refetch on
  // every change).
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const loadRelationships = useCallback(
    async (loadFor: AccountWithTypes[]) => {
      if (!loadFor?.length) return;
      if (!isCurrentInstance) return;
      // Functional updater so we don't need `relationshipsMap` as a dep; we
      // still pass the latest known map to `fetchRelationships` so it can
      // skip already-fetched ids.
      let snapshot: Record<string, mastodon.v1.Relationship> = {};
      setRelationshipsMap((prev) => {
        snapshot = prev;
        return prev;
      });
      const relationships = await fetchRelationships(loadFor, snapshot);
      if (relationships) {
        setRelationshipsMap((prev) => ({
          ...prev,
          ...relationships,
        }));
      }
    },
    [isCurrentInstance],
  );

  const loadAccounts = useCallback(
    (firstLoadFlag?: boolean) => {
      if (!fetchAccounts) return;
      if (firstLoadFlag && !accountsRef.current?.length) setAccounts([]);
      setUIState('loading');
      void (async () => {
        try {
          const { done, value } = await fetchAccounts(firstLoadFlag);
          if (Array.isArray(value)) {
            if (firstLoadFlag) {
              const merged: AccountWithTypes[] = [];
              const mergedById = new Map<string, AccountWithTypes>();
              const mergedIndexById = new Map<string, number>();
              for (const account of value) {
                const theAccount = mergedById.get(account.id);
                if (!theAccount) {
                  const mergedAccount = mergeTypes(account);
                  mergedById.set(account.id, mergedAccount);
                  mergedIndexById.set(account.id, merged.length);
                  merged.push(mergedAccount);
                } else {
                  const mergedAccount = {
                    ...theAccount,
                    _types: [...(theAccount._types ?? []), ...(account._types ?? [])],
                  };
                  mergedById.set(account.id, mergedAccount);
                  const index = mergedIndexById.get(account.id);
                  if (index !== undefined) merged[index] = mergedAccount;
                }
              }
              setAccounts(merged);
            } else {
              // setAccounts((prev) => [...prev, ...value]);
              // Merge accounts by id and _types
              setAccounts((prev) => {
                const newAccounts = prev.map((account) => ({
                  ...account,
                  _types: [...(account._types ?? [])],
                }));
                const accountsById = new Map(newAccounts.map((a) => [a.id, a]));
                const accountIndexById = new Map(
                  newAccounts.map((account, index) => [account.id, index]),
                );
                for (const account of value) {
                  const theAccount = accountsById.get(account.id);
                  if (!theAccount) {
                    const newAccount = mergeTypes(account);
                    accountsById.set(account.id, newAccount);
                    accountIndexById.set(account.id, newAccounts.length);
                    newAccounts.push(newAccount);
                  } else {
                    const mergedAccount = {
                      ...theAccount,
                      _types: [
                        ...(theAccount._types ?? []),
                        ...(account._types ?? []),
                      ],
                    };
                    accountsById.set(account.id, mergedAccount);
                    const index = accountIndexById.get(account.id);
                    if (index !== undefined) newAccounts[index] = mergedAccount;
                  }
                }
                return newAccounts;
              });
            }
            setShowMore(!done);

            void loadRelationships(value.map(mergeTypes));
          } else {
            setShowMore(false);
          }
          setUIState('default');
        } catch (e) {
          console.error(e);
          setUIState('error');
        }
      })();
    },
    [fetchAccounts, loadRelationships],
  );

  // Mirror the latest stateful inputs into refs so the two effects below
  // stay narrowly triggered (matching the JS original): the first by
  // `fetchAccounts` identity, the second by `reloadGenericAccounts.counter`.
  // We read showGenericAccountsState/id/loadAccounts/loadRelationships via
  // refs to avoid spurious refires when the valtio snapshot reference
  // changes or when the stable callbacks recompute.
  const showStateRef = useRef(shownGenericAccounts);
  showStateRef.current = shownGenericAccounts;
  const reloadIdRef = useRef(id);
  reloadIdRef.current = id;
  const loadAccountsRef = useRef(loadAccounts);
  loadAccountsRef.current = loadAccounts;
  const loadRelationshipsRef = useRef(loadRelationships);
  loadRelationshipsRef.current = loadRelationships;
  const reloadEventIdRef = useRef(snapStates.reloadGenericAccounts?.id);
  reloadEventIdRef.current = snapStates.reloadGenericAccounts?.id;

  useEffect(() => {
    if (!showStateRef.current) return;
    if ((accountsRef.current?.length ?? 0) > 0) {
      // setAccounts(staticAccounts);
      if (fetchAccounts) {
        loadAccountsRef.current(true);
        firstLoad.current = false;
      } else {
        void loadRelationshipsRef.current(accountsRef.current);
      }
    } else {
      loadAccountsRef.current(true);
      firstLoad.current = false;
    }
    // Intentionally reacts only to `fetchAccounts` identity; everything else
    // is read through refs so a valtio snapshot churn or stable-callback
    // recompute does not retrigger a load. This matches the JS original.
  }, [fetchAccounts]);

  useEffect(() => {
    if (firstLoad.current) return;
    // reloadGenericAccounts contains value like {id: 'mute', counter: 1}.
    // We only need to reload if the id matches the currently-shown sheet.
    if (reloadEventIdRef.current === reloadIdRef.current) {
      loadAccountsRef.current(true);
    }
  }, [snapStates.reloadGenericAccounts.counter]);

  if (!shownGenericAccounts) {
    return null;
  }

  const post = postID ? states.statuses[postID] : undefined;

  return (
    <div id="generic-accounts-container" className="sheet" tabIndex={-1}>
      <button type="button" className="sheet-close" onClick={onClose}>
        <Icon icon="x" alt={t`Close`} />
      </button>
      <header>
        <h2>{heading || t`Accounts`}</h2>
      </header>
      <main>
        {post && (
          <Link
            to={`/${instance || currentInstance}/s/${post.id}`}
            className="post-preview"
          >
            <Status status={post} size="s" readOnly />
          </Link>
        )}
        {accounts.length > 0 ? (
          <>
            <GenericAccountsList
              accounts={accounts}
              excludeRelationshipAttrs={excludeRelationshipAttrs}
              relationshipsMap={relationshipsMap}
              showReactions={showReactions}
            />
            {uiState === 'default' ? (
              showMore ? (
                <InView
                  onChange={(inView: boolean) => {
                    if (inView) {
                      loadAccounts();
                    }
                  }}
                >
                  <button
                    type="button"
                    className="plain block"
                    onClick={() => {
                      loadAccounts();
                    }}
                  >
                    <Trans>Show more…</Trans>
                  </button>
                </InView>
              ) : (
                <p className="ui-state insignificant">
                  <Trans>The end.</Trans>
                </p>
              )
            ) : (
              uiState === 'loading' && (
                <p className="ui-state">
                  <Loader abrupt />
                </p>
              )
            )}
          </>
        ) : uiState === 'loading' ? (
          <p className="ui-state">
            <Loader abrupt />
          </p>
        ) : uiState === 'error' ? (
          <p className="ui-state">
            <Trans>Error loading accounts</Trans>
          </p>
        ) : (
          <p className="ui-state insignificant">
            {blankCopy || t`Nothing to show`}
          </p>
        )}
      </main>
    </div>
  );
}

import './generic-accounts.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import StatusComponent, { type StatusComponentProps } from './status';

function Status(props: {
  status?: unknown;
  size?: string;
  readOnly?: boolean;
  [key: string]: unknown;
}) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
}

// `react-intersection-observer`'s `InView` ships without working JSX
// component typings under our React component types. Re-type as a
// React component with the props this batch actually uses.
type InViewTypedProps = {
  onChange?: (inView: boolean) => void;
  children?: ReactNode;
};
const InViewTyped: ComponentType<InViewTypedProps> =
  InViewUntyped as typeof InViewUntyped & ComponentType<InViewTypedProps>;

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
                  theAccount._types.push(...(account._types ?? []));
                }
              }
              setAccounts(merged);
            } else {
              // setAccounts((prev) => [...prev, ...value]);
              // Merge accounts by id and _types
              setAccounts((prev) => {
                const newAccounts = prev.map((account) => ({
                  ...account,
                  _types: [...account._types],
                }));
                for (const account of value) {
                  const theAccount = newAccounts.find(
                    (a) => a.id === account.id,
                  );
                  if (!theAccount) {
                    newAccounts.push({
                      ...account,
                      _types: account._types ?? [],
                    });
                  } else {
                    theAccount._types.push(...(account._types ?? []));
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
    },
    [fetchAccounts, loadRelationships],
  );

  // Mirror the latest stateful inputs into refs so the two effects below
  // stay narrowly triggered (matching the JS original): the first by
  // `fetchAccounts` identity, the second by `reloadGenericAccounts.counter`.
  // We read showGenericAccountsState/id/loadAccounts/loadRelationships via
  // refs to avoid spurious refires when the valtio snapshot reference
  // changes or when the stable callbacks recompute.
  const showStateRef = useRef(showGenericAccountsState);
  showStateRef.current = showGenericAccountsState;
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

  if (!showGenericAccountsState) {
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
                    className="plain block"
                    onClick={() => {
                      loadAccounts();
                    }}
                  >
                    <Trans>Show more…</Trans>
                  </button>
                </InViewTyped>
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

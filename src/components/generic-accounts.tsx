import './generic-accounts.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
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
const Status = StatusUntyped as unknown as ComponentType<{
  status?: unknown;
  size?: string;
  readOnly?: boolean;
  [key: string]: unknown;
}>;

// `react-intersection-observer`'s `InView` ships without working JSX
// component typings under our preact compat resolution. Re-type as a
// preact component with the props this batch actually uses.
const InViewTyped = InViewUntyped as unknown as ComponentType<{
  onChange?: (inView: boolean) => void;
  children?: unknown;
}>;

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
  const { masto, instance: currentInstance } = api();
  const isCurrentInstance = instance ? instance === currentInstance : true;
  const snapStates = useSnapshot(states);
  ``;
  const [uiState, setUIState] = useState('default');
  const [showMore, setShowMore] = useState(false);

  useLocationChange(onClose);

  if (!snapStates.showGenericAccounts) {
    return null;
  }

  const {
    id,
    heading,
    fetchAccounts,
    accounts: staticAccounts,
    showReactions,
  } = snapStates.showGenericAccounts as ShowGenericAccountsState;

  const [accounts, setAccounts] = useState<AccountWithTypes[]>(
    staticAccounts?.length ? staticAccounts : [],
  );

  const [relationshipsMap, setRelationshipsMap] = useState<
    Record<string, mastodon.v1.Relationship>
  >({});

  const loadRelationships = async (accounts: AccountWithTypes[]) => {
    if (!accounts?.length) return;
    if (!isCurrentInstance) return;
    const relationships = await fetchRelationships(accounts, relationshipsMap);
    if (relationships) {
      setRelationshipsMap({
        ...relationshipsMap,
        ...relationships,
      });
    }
  };

  const loadAccounts = (firstLoad?: boolean) => {
    if (!fetchAccounts) return;
    if (firstLoad && !accounts?.length) setAccounts([]);
    setUIState('loading');
    (async () => {
      try {
        const { done, value } = await fetchAccounts(firstLoad);
        if (Array.isArray(value)) {
          if (firstLoad) {
            const accounts: AccountWithTypes[] = [];
            for (let i = 0; i < value.length; i++) {
              const account = value[i];
              const theAccount = accounts.find(
                (a, j) => a.id === account.id && i !== j,
              );
              if (!theAccount) {
                accounts.push({
                  ...account,
                  _types: account._types ?? [],
                });
              } else {
                theAccount._types.push(...(account._types as string[]));
              }
            }
            setAccounts(accounts);
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

          loadRelationships(value as AccountWithTypes[]);
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

  const firstLoad = useRef(true);
  useEffect(() => {
    if (accounts?.length > 0) {
      // setAccounts(staticAccounts);
      if (fetchAccounts) {
        loadAccounts(true);
        firstLoad.current = false;
      } else {
        loadRelationships(accounts);
      }
    } else {
      loadAccounts(true);
      firstLoad.current = false;
    }
  }, [fetchAccounts]);

  useEffect(() => {
    if (firstLoad.current) return;
    // reloadGenericAccounts contains value like {id: 'mute', counter: 1}
    // We only need to reload if the id matches
    if (snapStates.reloadGenericAccounts?.id === id) {
      loadAccounts(true);
    }
  }, [snapStates.reloadGenericAccounts.counter]);

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

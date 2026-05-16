import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useReducer, useState } from 'react';

import { api, getMastoV1Resource } from '../utils/api';
import { getUserLists } from '../utils/lists';

import Icon from './icon';
import ListAddEdit from './list-add-edit';
import Loader from './loader';
import Modal from './modal';

interface ListLike {
  id: string;
  title: string;
  [key: string]: unknown;
}

interface AccountListsEndpoint {
  $select(id: string): {
    lists: { list(): Promise<ListLike[]> };
  };
}

interface ListsAccountsEndpoint {
  $select(id: string): {
    accounts: {
      create(params: { accountIds: string[] }): Promise<unknown>;
      remove(params: { accountIds: string[] }): Promise<unknown>;
    };
  };
}

type ListAddEditModalState = boolean | { list?: ListLike };

type UIState = 'default' | 'loading' | 'error';

interface AddRemoveListsSheetProps {
  accountID: string;
  onClose?: ((event?: React.SyntheticEvent) => void) | null;
  children?: ReactNode;
}

function AddRemoveListsSheet({ accountID, onClose }: AddRemoveListsSheetProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [uiState, setUIState] = useState<UIState>('default');
  const [lists, setLists] = useState<ListLike[]>([]);
  const [listsContainingAccount, setListsContainingAccount] = useState<
    ListLike[]
  >([]);
  const [reloadCount, reload] = useReducer((c: number) => c + 1, 0);

  // `masto.v1.accounts` is a proxy that yields a fresh reference on every
  // access; depending on the raw expression would re-fire this effect on
  // every render. Snapshot the endpoint once (the underlying `masto` client
  // is stable for the sheet's lifetime) so the dep list captures a stable
  // reference. Re-runs follow `reloadCount`/`accountID` as before.
  const accountsEndpoint = useMemo(
    () => getMastoV1Resource<AccountListsEndpoint>(masto, 'accounts'),
    [masto],
  );

  useEffect(() => {
    setUIState('loading');
    void (async () => {
      try {
        const fetchedLists = await getUserLists();
        setLists(fetchedLists as ListLike[]);
        const fetchedListsContainingAccount = await accountsEndpoint
          .$select(accountID)
          .lists.list();
        console.log({
          lists: fetchedLists,
          listsContainingAccount: fetchedListsContainingAccount,
        });
        setListsContainingAccount(fetchedListsContainingAccount);
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  }, [reloadCount, accountID, accountsEndpoint]);

  const [showListAddEditModal, setShowListAddEditModal] =
    useState<ListAddEditModalState>(false);

  return (
    <div className="sheet" id="list-add-remove-container">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={(e) => onClose(e)}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Add/Remove from Lists</Trans>
        </h2>
      </header>
      <main>
        {lists.length > 0 ? (
          <ul className="list-add-remove">
            {lists.map((list) => {
              const inList = listsContainingAccount.some(
                (l) => l.id === list.id,
              );
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    className={`light ${inList ? 'checked' : ''}`}
                    disabled={uiState === 'loading'}
                    onClick={() => {
                      setUIState('loading');
                      void (async () => {
                        try {
                          const listsEndpoint = masto.v1
                            .lists as ListsAccountsEndpoint;
                          if (inList) {
                            await listsEndpoint
                              .$select(list.id)
                              .accounts.remove({
                                accountIds: [accountID],
                              });
                          } else {
                            await listsEndpoint
                              .$select(list.id)
                              .accounts.create({
                                accountIds: [accountID],
                              });
                          }
                          // setUIState('default');
                          reload();
                        } catch (e) {
                          console.error(e);
                          setUIState('error');
                          alert(
                            inList
                              ? t`Unable to remove from list.`
                              : t`Unable to add to list.`,
                          );
                        }
                      })();
                    }}
                  >
                    <Icon icon="check-circle" alt="☑️" />
                    <span>{list.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : uiState === 'loading' ? (
          <p className="ui-state">
            <Loader abrupt />
          </p>
        ) : uiState === 'error' ? (
          <p className="ui-state">
            <Trans>Unable to load lists.</Trans>
          </p>
        ) : (
          <p className="ui-state">
            <Trans>No lists.</Trans>
          </p>
        )}
        <button
          type="button"
          className="plain2"
          onClick={() => setShowListAddEditModal(true)}
          disabled={uiState !== 'default'}
        >
          <Icon icon="plus" size="l" />{' '}
          <span>
            <Trans>New list</Trans>
          </span>
        </button>
      </main>
      {showListAddEditModal && (
        <Modal
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowListAddEditModal(false);
            }
          }}
        >
          <ListAddEdit
            list={
              typeof showListAddEditModal === 'object'
                ? showListAddEditModal.list
                : undefined
            }
            onClose={(result) => {
              if (result && 'state' in result && result.state === 'success') {
                reload();
              }
              setShowListAddEditModal(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

export default AddRemoveListsSheet;

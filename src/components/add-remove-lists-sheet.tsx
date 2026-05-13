import { Trans, useLingui } from '@lingui/react/macro';
import type { ComponentChildren } from 'preact';
import { useEffect, useReducer, useState } from 'preact/hooks';

import { api } from '../utils/api';
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
  onClose?: ((event?: Event) => void) | null;
  children?: ComponentChildren;
}

function AddRemoveListsSheet({ accountID, onClose }: AddRemoveListsSheetProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [uiState, setUIState] = useState<UIState>('default');
  const [lists, setLists] = useState<ListLike[]>([]);
  const [listsContainingAccount, setListsContainingAccount] = useState<
    ListLike[]
  >([]);
  const [reloadCount, reload] = useReducer<number, undefined, number>(
    (c) => c + 1,
    0,
    (init) => init,
  );

  useEffect(() => {
    setUIState('loading');
    void (async () => {
      try {
        const fetchedLists = await getUserLists();
        setLists(fetchedLists as ListLike[]);
        const accountsEndpoint = masto.v1
          .accounts as unknown as AccountListsEndpoint;
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
    // TODO(oxlint:react-hooks/exhaustive-deps): masto.v1.accounts is a masto
    // proxy recreated per-access; adding it to deps would loop.
  }, [reloadCount, accountID]);

  const [showListAddEditModal, setShowListAddEditModal] =
    useState<ListAddEditModalState>(false);

  return (
    <div class="sheet" id="list-add-remove-container">
      {!!onClose && (
        <button type="button" class="sheet-close" onClick={(e) => onClose(e)}>
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
          <ul class="list-add-remove">
            {lists.map((list) => {
              const inList = listsContainingAccount.some(
                (l) => l.id === list.id,
              );
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    class={`light ${inList ? 'checked' : ''}`}
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
                          reload(undefined);
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
          <p class="ui-state">
            <Loader abrupt />
          </p>
        ) : uiState === 'error' ? (
          <p class="ui-state">
            <Trans>Unable to load lists.</Trans>
          </p>
        ) : (
          <p class="ui-state">
            <Trans>No lists.</Trans>
          </p>
        )}
        <button
          type="button"
          class="plain2"
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
                reload(undefined);
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

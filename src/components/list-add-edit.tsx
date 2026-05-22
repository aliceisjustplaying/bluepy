import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';

import { api, getMastoV1Resource } from '../utils/api';
import { addListStore, deleteListStore, updateListStore } from '../utils/lists';

import Icon from './icon';
import MenuConfirm from './menu-confirm';

interface ListLike {
  id: string;
  title: string;
  [key: string]: unknown;
}

interface ListAddEditCloseSuccess {
  state: 'success';
  list: ListLike;
}

interface ListAddEditCloseDeleted {
  state: 'deleted';
}

type ListAddEditCloseResult = ListAddEditCloseSuccess | ListAddEditCloseDeleted;

// onClose is invoked in three ways:
// - From the sheet-close button: receives the raw click MouseEvent (preserves
//   JS contract where consumers read `result?.state` from whatever object the
//   button passes through; the click event has no `state` field so existing
//   consumers see `undefined`).
// - From a successful create/update: receives ListAddEditCloseSuccess.
// - From a successful delete: receives ListAddEditCloseDeleted.
type ListAddEditCloseArg = ListAddEditCloseResult | Event | React.MouseEvent;

interface ListAddEditProps {
  list?: ListLike | null;
  onClose?: (result?: ListAddEditCloseArg) => void;
}

interface MastoListsApi {
  create(params: { title: string }): Promise<ListLike>;
  $select(id: string): {
    update(params: { title: string }): Promise<ListLike>;
    remove(): Promise<unknown>;
  };
}

type UIState = 'default' | 'loading' | 'error';

function ListAddEdit({ list, onClose }: ListAddEditProps) {
  const { t } = useLingui();
  const { masto } = api();
  const listsApi = getMastoV1Resource<MastoListsApi>(masto, 'lists');
  const [uiState, setUIState] = useState<UIState>('default');
  const editMode = !!list;
  const nameFieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editMode && list) {
      if (nameFieldRef.current) {
        nameFieldRef.current.value = list.title;
      }
    }
  }, [editMode, list]);

  return (
    <div className="sheet">
      {!!onClose && (
        <button
          type="button"
          className="sheet-close"
          onClick={(e) => {
            onClose?.(e);
          }}
        >
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}{' '}
      <header>
        <h2>{editMode ? t`Edit list` : t`New list`}</h2>
      </header>
      <main>
        <form
          className="list-form"
          onSubmit={(e) => {
            e.preventDefault(); // Get form values

            const formData = new FormData(e.target as HTMLFormElement);
            const titleValue = formData.get('title');
            const title = typeof titleValue === 'string' ? titleValue : '';
            console.log({
              title,
            });
            setUIState('loading');

            void (async () => {
              try {
                let listResult: ListLike;

                if (editMode && list) {
                  listResult = await listsApi.$select(list.id).update({
                    title,
                  });
                } else {
                  listResult = await listsApi.create({
                    title,
                  });
                }

                console.log(listResult);
                setUIState('default');
                onClose?.({
                  state: 'success',
                  list: listResult,
                });

                setTimeout(() => {
                  if (editMode) {
                    updateListStore(listResult);
                  } else {
                    addListStore(listResult);
                  }
                }, 1);
              } catch (err) {
                console.error(err);
                setUIState('error');
                alert(
                  editMode
                    ? t`Unable to edit list.`
                    : t`Unable to create list.`,
                );
              }
            })();
          }}
        >
          <div className="list-form-row">
            <label htmlFor="list-title">
              <Trans>Name</Trans>{' '}
              <input
                ref={nameFieldRef}
                type="text"
                id="list-title"
                name="title"
                required
                disabled={uiState === 'loading'}
                dir="auto"
              />
            </label>
          </div>
          <div className="list-form-footer">
            <button type="submit" disabled={uiState === 'loading'}>
              {editMode ? t`Save` : t`Create`}
            </button>
            {editMode && (
              <MenuConfirm
                disabled={uiState === 'loading'}
                align="end"
                menuItemClassName="danger"
                confirmLabel={t`Delete this list?`}
                onClick={() => {
                  // const yes = confirm('Delete this list?');
                  // if (!yes) return;
                  if (!list) return;
                  setUIState('loading');

                  void (async () => {
                    try {
                      await listsApi.$select(list.id).remove();
                      setUIState('default');
                      onClose?.({
                        state: 'deleted',
                      });
                      setTimeout(() => {
                        deleteListStore(list.id);
                      }, 1);
                    } catch (e) {
                      console.error(e);
                      setUIState('error');
                      alert(t`Unable to delete list.`);
                    }
                  })();
                }}
              >
                <button
                  type="button"
                  className="light danger"
                  disabled={uiState === 'loading'}
                >
                  <Trans>Delete…</Trans>
                </button>
              </MenuConfirm>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

export default ListAddEdit;

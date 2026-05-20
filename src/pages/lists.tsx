import './lists.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useReducer, useState } from 'react';

import Icon from '../components/icon';
import Link from '../components/link';
import ListAddEdit from '../components/list-add-edit';
import ListExclusiveBadge from '../components/list-exclusive-badge';
import Loader from '../components/loader';
import Modal from '../components/modal';
import NavMenu from '../components/nav-menu';
import { fetchLists, splitListsAndFeeds } from '../utils/lists';
import useTitle from '../utils/useTitle';

interface ListItem {
  id: string;
  title: string;
  exclusive?: boolean;
  [key: string]: unknown;
}

type ListAddEditModalState = boolean | { list?: ListItem };
type UIState = 'default' | 'loading' | 'error';
interface ListsState {
  uiState: UIState;
  lists: ListItem[];
}
type ListsAction =
  | { type: 'loading' }
  | { type: 'loaded'; lists: ListItem[] }
  | { type: 'error' };

function listsReducer(state: ListsState, action: ListsAction): ListsState {
  switch (action.type) {
    case 'loading':
      return { ...state, uiState: 'loading' };
    case 'loaded':
      return { uiState: 'default', lists: action.lists };
    case 'error':
      return { ...state, uiState: 'error' };
  }
  return state;
}

function Lists() {
  const { t } = useLingui();
  useTitle(t`Lists & Feeds`, `/l`);
  const [{ uiState, lists }, dispatchLists] = useReducer(listsReducer, {
    uiState: 'default',
    lists: [],
  });

  const [reloadCount, reload] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    dispatchLists({ type: 'loading' });
    void (async () => {
      try {
        const fetched = (await fetchLists()) as ListItem[];
        console.log(fetched);
        dispatchLists({ type: 'loaded', lists: fetched });
      } catch (e) {
        console.error(e);
        dispatchLists({ type: 'error' });
      }
    })();
  }, [reloadCount]);

  const [showListAddEditModal, setShowListAddEditModal] =
    useState<ListAddEditModalState>(false);

  const { lists: userLists, feeds } = splitListsAndFeeds(lists);
  const hasExclusiveLists = userLists.some(
    (list) => (list as ListItem).exclusive,
  );

  return (
    <div id="lists-page" className="deck-container" tabIndex={-1}>
      <div className="timeline-deck deck">
        <header>
          <div className="header-grid">
            <div className="header-side">
              <NavMenu />
              <Link to="/" className="button plain">
                <Icon icon="home" size="l" />
              </Link>
            </div>
            <h1>
              <Trans>Lists & Feeds</Trans>
            </h1>
            <div className="header-side">
              <button
                type="button"
                className="plain"
                onClick={() => {
                  setShowListAddEditModal(true);
                }}
              >
                <Icon icon="plus" size="l" alt={t`New list`} />
              </button>
            </div>
          </div>
        </header>
        <main>
          {lists.length > 0 ? (
            <>
              {userLists.length > 0 && (
                <>
                  <h2 className="timeline-header">
                    <Trans>Lists</Trans>
                  </h2>
                  <ul className="link-list">
                    {userLists.map((list) => (
                      <li key={list.id}>
                        <Link to={`/l/${list.id}`}>
                          <Icon icon="list" />{' '}
                          <span>
                            {list.title}
                            {list.exclusive && (
                              <>
                                {' '}
                                <ListExclusiveBadge insignificant />
                              </>
                            )}
                          </span>
                          {/* <button
                      type="button"
                      className="plain"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowListAddEditModal({
                          list,
                        });
                      }}
                    >
                      <Icon icon="pencil" />
                    </button> */}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {feeds.length > 0 && (
                <>
                  <h2 className="timeline-header">
                    <Trans>Feeds</Trans>
                  </h2>
                  <ul className="link-list">
                    {feeds.map((feed) => (
                      <li key={feed.id}>
                        <Link to={`/l/${feed.id}`}>
                          <Icon icon="sparkles" /> <span>{feed.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {lists.length > 1 && (
                <footer className="ui-state">
                  {hasExclusiveLists && (
                    <p>
                      <small className="insignificant">
                        <ListExclusiveBadge />{' '}
                        <Trans>
                          Posts on this list are hidden from Home/Following
                        </Trans>
                      </small>
                    </p>
                  )}
                  <p>
                    <small className="insignificant">
                      {userLists.length > 0 && (
                        <Plural
                          value={userLists.length}
                          one="# list"
                          other="# lists"
                        />
                      )}
                      {userLists.length > 0 && feeds.length > 0 && ' · '}
                      {feeds.length > 0 && (
                        <Plural
                          value={feeds.length}
                          one="# feed"
                          other="# feeds"
                        />
                      )}
                    </small>
                  </p>
                </footer>
              )}
            </>
          ) : uiState === 'loading' ? (
            <p className="ui-state">
              <Loader />
            </p>
          ) : uiState === 'error' ? (
            <p className="ui-state">
              <Trans>Unable to load lists.</Trans>
            </p>
          ) : (
            <p className="ui-state">
              <Trans>No lists or feeds yet.</Trans>
            </p>
          )}
        </main>
      </div>
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
              const closeResult =
                result && typeof result === 'object' && 'state' in result
                  ? result
                  : null;
              if (closeResult?.state === 'success') {
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

export default Lists;

import './lists.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useReducer, useState } from 'react';

import Icon from '../components/icon';
import Link from '../components/link';
import ListAddEdit from '../components/list-add-edit';
import Loader from '../components/loader';
import Modal from '../components/modal';
import NavMenu from '../components/nav-menu';
import { fetchLists, splitListsAndFeeds } from '../utils/lists';
import useTitle from '../utils/useTitle';

interface ListItem {
  id: string;
  title: string;
  [key: string]: unknown;
}

type ListAddEditModalState = boolean | { list?: ListItem };
type UIState = 'default' | 'loading' | 'error';

function Lists() {
  const { t } = useLingui();
  useTitle(t`Lists & Feeds`, `/l`);
  const [uiState, setUIState] = useState<UIState>('default');

  const [reloadCount, reload] = useReducer((c: number) => c + 1, 0);
  const [lists, setLists] = useState<ListItem[]>([]);
  useEffect(() => {
    setUIState('loading');
    void (async () => {
      try {
        const fetched = (await fetchLists()) as ListItem[];
        console.log(fetched);
        setLists(fetched);
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  }, [reloadCount]);

  const [showListAddEditModal, setShowListAddEditModal] =
    useState<ListAddEditModalState>(false);

  const { lists: userLists, feeds } = splitListsAndFeeds(lists);

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
                          <span>{list.title}</span>
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

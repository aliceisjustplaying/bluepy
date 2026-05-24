import './lists.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuHeader, MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { ReactNode, ComponentType } from 'react';
import { useEffect, useRef, useState } from 'react';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { useParams } from 'react-router-dom';

import AccountBlock from '../components/account-block';
import Icon from '../components/icon';
import Link from '../components/link';
import ListAddEdit from '../components/list-add-edit';
import ListFeed from '../components/list-feed';
import MenuConfirm from '../components/menu-confirm';
import MenuLink from '../components/menu-link';
import Menu2 from '../components/menu2';
import Modal from '../components/modal';
import { useList } from '../data/lists';
import {
  isAtprotoFeedGeneratorURI,
  maybeDecodeAtprotoURI,
} from '../utils/atproto-route';
import { api } from '../utils/api';
import {
  getList,
  getLists,
  isFeedList,
  splitListsAndFeeds,
} from '../utils/lists';
import { navigatePath } from '../utils/router';
import useTitle from '../utils/useTitle';

interface ListLike {
  id: string;
  title: string;
  [key: string]: unknown;
}

interface ListMembersEndpoint {
  $select(id: string): {
    accounts: {
      list(options: { limit: number }): {
        values(): AsyncIterator<mastodon.v1.Account[]>;
      };
      create(params: { accountIds: string[] }): Promise<unknown>;
      remove(params: { accountIds: string[] }): Promise<unknown>;
    };
  };
}

type InViewProps = {
  as?: string;
  onChange?: (inView: boolean) => void;
  children?: ReactNode;
};
const InView: ComponentType<InViewProps> =
  InViewUntyped as typeof InViewUntyped & ComponentType<InViewProps>;

interface ListProps {
  id?: string;
  instance?: string;
  timelineId?: string;
}

function List(props: ListProps) {
  const { t } = useLingui();
  const params = useParams();
  const id = props?.id || params?.id;
  const timelineId = props?.timelineId || 'list';
  const listUri = maybeDecodeAtprotoURI(id) || id;
  const isAtprotoFeed = isAtprotoFeedGeneratorURI(listUri);
  const { data: listMeta } = useList(isAtprotoFeed ? undefined : listUri);

  const [lists, setLists] = useState<ListLike[]>([]);
  const [list, setList] = useState<ListLike>({ id: '', title: 'List' });
  const isFeed = isAtprotoFeed || isFeedList(list);
  const { lists: menuLists, feeds: menuFeeds } = splitListsAndFeeds(lists);

  useTitle(list.title, ['/l/:id', '/:scheme://*', '/:atUri']);

  useEffect(() => {
    if (listMeta) {
      setList({
        id: listMeta.uri,
        title: listMeta.name,
      });
    }
  }, [listMeta]);

  useEffect(() => {
    void (async () => {
      try {
        const fetchedList = props.instance
          ? await getList(listUri ?? '', props.instance)
          : await getList(listUri ?? '');
        if (fetchedList) {
          setList(fetchedList);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [id, listUri, props.instance]);

  const [showListAddEditModal, setShowListAddEditModal] = useState<
    boolean | { list: ListLike }
  >(false);
  const [showManageMembersModal, setShowManageMembersModal] = useState(false);

  return (
    <>
      <ListFeed
        key={id}
        listUri={listUri}
        isFeed={isFeed}
        title={list.title}
        id={timelineId}
        emptyText={t`Nothing yet.`}
        errorText={t`Unable to load posts.`}
        headerStart={
          <Menu2
            overflow="auto"
            menuClassName="lists-picker-menu"
            menuButton={
              <button type="button" className="plain">
                <Icon icon="list" size="l" alt={t`Lists & Feeds`} />
                <Icon icon="chevron-down" size="s" />
              </button>
            }
            onMenuChange={(e) => {
              if (e.open) {
                void (async () => {
                  try {
                    setLists(await getLists());
                  } catch (err) {
                    console.error(err);
                  }
                })();
              }
            }}
          >
            <MenuLink to="/l">
              <span>
                <Trans>Lists & Feeds</Trans>
              </span>
            </MenuLink>
            {menuLists?.length > 0 && (
              <>
                <MenuDivider />
                <MenuHeader className="plain">
                  <Trans>Lists</Trans>
                </MenuHeader>
                {menuLists.map((menuList) => (
                  <MenuLink key={menuList.id} to={`/l/${menuList.id}`}>
                    <span>{menuList.title}</span>
                  </MenuLink>
                ))}
              </>
            )}
            {menuFeeds?.length > 0 && (
              <>
                <MenuDivider />
                <MenuHeader className="plain">
                  <Trans>Feeds</Trans>
                </MenuHeader>
                {menuFeeds.map((menuFeed) => (
                  <MenuLink key={menuFeed.id} to={`/l/${menuFeed.id}`}>
                    <Icon icon="sparkles" />
                    <span>{menuFeed.title}</span>
                  </MenuLink>
                ))}
              </>
            )}
          </Menu2>
        }
        headerEnd={
          <>
            <Link
              to="/notifications"
              className="button plain notifications-button"
            >
              <Icon icon="notification" size="l" alt={t`Notifications`} />
            </Link>
            {!isFeed && (
              <Menu2
                portal
                setDownOverflow
                overflow="auto"
                viewScroll="close"
                position="anchor"
                menuButton={
                  <button type="button" className="plain">
                    <Icon icon="more" size="l" alt={t`More`} />
                  </button>
                }
              >
                <MenuItem
                  onClick={() => {
                    setShowListAddEditModal({
                      list,
                    });
                  }}
                >
                  <Icon icon="pencil" size="l" />
                  <span>
                    <Trans>Edit</Trans>
                  </span>
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setShowManageMembersModal(true);
                  }}
                >
                  <Icon icon="group" size="l" />
                  <span>
                    <Trans>Manage members</Trans>
                  </span>
                </MenuItem>
              </Menu2>
            )}
          </>
        }
      />
      {showListAddEditModal && (
        <Modal
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            if (e.target === e.currentTarget) {
              setShowListAddEditModal(false);
            }
          }}
        >
          <ListAddEdit
            list={
              typeof showListAddEditModal === 'object'
                ? showListAddEditModal.list
                : null
            }
            onClose={(result) => {
              if (
                result &&
                typeof result === 'object' &&
                'state' in result &&
                result.state === 'success' &&
                'list' in result &&
                result.list
              ) {
                setList(result.list);
              } else if (
                result &&
                typeof result === 'object' &&
                'state' in result &&
                result.state === 'deleted'
              ) {
                navigatePath('/l');
              }
              setShowListAddEditModal(false);
            }}
          />
        </Modal>
      )}
      {showManageMembersModal && (
        <Modal
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            if (e.target === e.currentTarget) {
              setShowManageMembersModal(false);
            }
          }}
        >
          <ListManageMembers
            listID={id ?? ''}
            onClose={() => {
              setShowManageMembersModal(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}

const MEMBERS_LIMIT = 40;

interface ListManageMembersProps {
  listID: string;
  onClose?: () => void;
}

function ListManageMembers({ listID, onClose }: ListManageMembersProps) {
  const { t } = useLingui();
  const { masto, instance } = api();
  const [members, setMembers] = useState<mastodon.v1.Account[]>([]);
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [showMore, setShowMore] = useState(false);

  const listsApi = masto.v1.lists as ListMembersEndpoint;

  const membersIterator = useRef<
    AsyncIterator<mastodon.v1.Account[]> | undefined
  >(undefined);

  const fetchMembersRef = useRef<((firstLoad?: boolean) => void) | null>(null);
  fetchMembersRef.current = (firstLoad?: boolean) => {
    setShowMore(false);
    setUIState('loading');
    void (async () => {
      try {
        if (firstLoad || !membersIterator.current) {
          membersIterator.current = listsApi
            .$select(listID)
            .accounts.list({
              limit: MEMBERS_LIMIT,
            })
            .values();
        }
        const results = await membersIterator.current.next();
        const { done, value } = results as {
          done?: boolean;
          value?: mastodon.v1.Account[];
        };
        if (value?.length) {
          if (firstLoad) {
            setMembers(value);
          } else {
            setMembers((prev) => prev.concat(value));
          }
          setShowMore(!done);
        } else {
          setShowMore(false);
        }
        setUIState('default');
      } catch {
        setUIState('error');
      }
    })();
  };
  const fetchMembers = (firstLoad?: boolean): void => {
    fetchMembersRef.current?.(firstLoad);
  };

  useEffect(() => {
    fetchMembers(true);
  }, []);

  return (
    <div className="sheet" id="list-manage-members-container">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Manage members</Trans>
        </h2>
      </header>
      <main>
        <ul>
          {members.map((member) => (
            <li key={member.id}>
              <AccountBlock account={member} instance={instance} />
              <RemoveAddButton account={member} listID={listID} />
            </li>
          ))}
          {showMore && uiState === 'default' && (
            <InView
              as="li"
              onChange={(inView) => {
                if (inView) fetchMembers();
              }}
            >
              <button
                type="button"
                className="light block"
                onClick={() => {
                  fetchMembers();
                }}
              >
                <Trans>Show more…</Trans>
              </button>
            </InView>
          )}
        </ul>
      </main>
    </div>
  );
}

interface RemoveAddButtonProps {
  account: mastodon.v1.Account;
  listID: string;
}

function RemoveAddButton({ account, listID }: RemoveAddButtonProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );
  const [removed, setRemoved] = useState(false);
  const listsApi = masto.v1.lists as ListMembersEndpoint;

  return (
    <MenuConfirm
      confirm={!removed}
      confirmLabel={
        <span>
          <Trans>
            Remove <span className="bidi-isolate">@{account.username}</span>{' '}
            from list?
          </Trans>
        </span>
      }
      align="end"
      menuItemClassName="danger"
      onClick={() => {
        if (removed) {
          setUIState('loading');
          void (async () => {
            try {
              await listsApi.$select(listID).accounts.create({
                accountIds: [account.id],
              });
              setUIState('default');
              setRemoved(false);
            } catch {
              setUIState('error');
            }
          })();
        } else {
          setUIState('loading');

          void (async () => {
            try {
              await listsApi.$select(listID).accounts.remove({
                accountIds: [account.id],
              });
              setUIState('default');
              setRemoved(true);
            } catch {
              setUIState('error');
            }
          })();
        }
      }}
    >
      <button
        type="button"
        className={`light ${removed ? '' : 'danger'}`}
        disabled={uiState === 'loading'}
      >
        {removed ? t`Add` : t`Remove…`}
      </button>
    </MenuConfirm>
  );
}

export default List;

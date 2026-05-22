import './lists.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuHeader, MenuItem } from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { ReactNode, ComponentType } from 'react';
import { useEffect, useRef, useState } from 'react';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { useParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import AccountBlock from '../components/account-block';
import Icon from '../components/icon';
import Link from '../components/link';
import ListAddEdit from '../components/list-add-edit';
import MenuConfirm from '../components/menu-confirm';
import MenuLink from '../components/menu-link';
import Menu2 from '../components/menu2';
import Modal from '../components/modal';
import Timeline from '../components/timeline';
import { api } from '../utils/api';
import { filteredItems } from '../utils/filters';
import {
  getList,
  getLists,
  isFeedList,
  splitListsAndFeeds,
} from '../utils/lists';
import { navigatePath } from '../utils/router';
import states, { saveStatus } from '../utils/states';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

interface ListLike {
  id: string;
  title: string;
  [key: string]: unknown;
}

type StatusLike = mastodon.v1.Status;

interface SaveStatusPayload extends Record<string, unknown> {
  id?: string;
  account?: Record<string, unknown> & { id?: string };
  reblog?: SaveStatusPayload | null;
  quote?: SaveStatusPayload | null;
  state?: unknown;
  quotedStatus?: SaveStatusPayload | null;
}

function toSaveStatus(
  status: StatusLike | null | undefined,
): SaveStatusPayload | null | undefined {
  return status as SaveStatusPayload | null | undefined;
}

interface FetchItemsResult {
  done?: boolean;
  value: (StatusLike | null | undefined)[] | undefined;
}

interface ListTimelineEndpoint {
  $select(id: string): {
    list(options: { limit: number; since_id?: string }): {
      values(): AsyncIterator<StatusLike[]>;
    } & Promise<{ value?: StatusLike[] } | StatusLike[]>;
  };
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

// react-intersection-observer's InView ships without working JSX
// component typings under React component types. Re-type for our usage.
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
  const snapStates = useSnapshot(states);
  const { masto, instance } = api({ instance: props.instance });
  const params = useParams();
  const id = props?.id || params?.id;
  const timelineId = props?.timelineId || 'list';
  // const navigate = useNavigate();
  const latestItem = useRef<string | undefined>(undefined);
  // const [reloadCount, reload] = useReducer((c) => c + 1, 0);

  const timelinesApi = masto.v1.timelines as {
    list: ListTimelineEndpoint;
  };

  const listIterator = useRef<AsyncIterator<StatusLike[]> | undefined>(
    undefined,
  );
  async function fetchList(firstLoad?: boolean): Promise<FetchItemsResult> {
    if (firstLoad || !listIterator.current) {
      listIterator.current = timelinesApi.list
        .$select(id ?? '')
        .list({
          limit: LIMIT,
        })
        .values();
    }
    const results = await listIterator.current.next();
    const value = results.value as StatusLike[] | undefined;
    if (value?.length) {
      if (firstLoad) {
        latestItem.current = value[0].id;
      }

      // value = filteredItems(value, 'home');
      value.forEach((item) => {
        saveStatus(toSaveStatus(item), instance);
      });
    }
    return {
      done: results.done,
      value,
    };
  }

  async function checkForUpdates(): Promise<boolean> {
    try {
      const results = await timelinesApi.list.$select(id ?? '').list({
        limit: 1,
        since_id: latestItem.current,
      });
      let value: StatusLike[] | undefined = Array.isArray(results)
        ? results
        : results?.value;
      const valueContainsLatestItem = value?.[0]?.id === latestItem.current; // since_id might not be supported
      if (value?.length && !valueContainsLatestItem) {
        value = filteredItems(value, 'home') as StatusLike[];
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const [lists, setLists] = useState<ListLike[]>([]);

  const [list, setList] = useState<ListLike>({ id: '', title: 'List' });
  const isFeed = isFeedList(list);
  const { lists: menuLists, feeds: menuFeeds } = splitListsAndFeeds(lists);
  // const [title, setTitle] = useState(`List`);
  useTitle(list.title, ['/l/:id', '/:scheme://*', '/:atUri']);
  useEffect(() => {
    void (async () => {
      try {
        const fetchedList = props.instance
          ? await getList(id ?? '', props.instance)
          : await getList(id ?? '');
        if (fetchedList) {
          setList(fetchedList);
        }
        // setTitle(list.title);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [id, props.instance]);

  const [showListAddEditModal, setShowListAddEditModal] = useState<
    boolean | { list: ListLike }
  >(false);
  const [showManageMembersModal, setShowManageMembersModal] = useState(false);

  return (
    <>
      <Timeline
        key={id}
        title={list.title}
        id={timelineId}
        timelineKey={`${timelineId}-${id}`}
        emptyText={t`Nothing yet.`}
        errorText={t`Unable to load posts.`}
        instance={instance}
        fetchItems={fetchList}
        checkForUpdates={checkForUpdates}
        useItemID
        boostsCarousel={snapStates.settings.boostsCarousel}
        // allowFilters
        filterContext="home"
        showReplyParent
        // refresh={reloadCount}
        headerStart={
          // <Link to="/l" className="button plain">
          //   <Icon icon="list" size="l" />
          // </Link>
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
                // reload();
              } else if (
                result &&
                typeof result === 'object' &&
                'state' in result &&
                result.state === 'deleted'
              ) {
                // navigate('/l');
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
  // Show list of members with [Remove] button
  // API only returns 40 members at a time, so this need to be paginated with infinite scroll
  // Show [Add] button after removing a member
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
    // TODO(oxlint:react-hooks/exhaustive-deps): mount-only initial load. The
    // fetchMembers reference is intentionally read via a ref so the effect
    // does not retrigger when masto proxy access recreates the closure.
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
          // const yes = confirm(`Remove ${account.username} from this list?`);
          // if (!yes) return;
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

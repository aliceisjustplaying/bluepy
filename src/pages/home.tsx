import './notifications-menu.css';

import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ControlledMenu } from '@szhsin/react-menu';
import type { RefObject } from 'react';
import { memo } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import Columns from '../components/columns';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import Notification from '../components/notification';
import { api } from '../utils/api';
import db from '../utils/db';
import FilterContext from '../utils/filter-context';
import { massageNotifications2 } from '../utils/group-notifications';
import states, { saveStatus } from '../utils/states';
import store from '../utils/store';
import { getCurrentAccountNS } from '../utils/store-utils';

import Following from './following';
import Following2 from './following2';
import List from './list';
import {
  getGroupedNotifications,
  mastoFetchNotifications,
} from './notifications';

interface HomeTimeline {
  type?: string;
  id?: string;
}

function Home() {
  const { i18n } = useLingui();
  const _ = i18n._.bind(i18n);
  const snapStates = useSnapshot(states);
  __BENCHMARK.end('time-to-home');
  useEffect(() => {
    void (async () => {
      const keys = (await db.drafts.keys()) as string[];
      if (keys.length) {
        const ns = getCurrentAccountNS();
        const ownKeys = keys.filter((key) => key.startsWith(ns));
        if (ownKeys.length) {
          states.showDrafts = true;
        }
      }
    })();
  }, []);

  const expTimeline2 = useRef(false);
  if (!expTimeline2.current) {
    expTimeline2.current = !!store.local.get('experiments-timeline2');
  }
  const homeTimeline = (snapStates.homeTimeline ||
    store.account.get('homeTimeline')) as HomeTimeline | null | undefined;
  const defaultFeedID =
    homeTimeline?.type === 'feed' && homeTimeline?.id ? homeTimeline.id : null;
  const defaultFollowing = homeTimeline?.type === 'following';

  const isMultiColumn =
    (snapStates.settings.shortcutsViewMode === 'multi-column' ||
      (!snapStates.settings.shortcutsViewMode &&
        snapStates.settings.shortcutsColumnsMode)) &&
    !!snapStates.shortcuts?.length;

  return (
    <>
      {isMultiColumn ? (
        <Columns />
      ) : defaultFeedID ? (
        <List id={defaultFeedID} timelineId="home" />
      ) : expTimeline2.current && !defaultFollowing ? (
        <Following2
          title={_(msg`Home`)}
          path="/"
          id="home"
          headerStart={false}
          headerEnd={<NotificationsLink />}
        />
      ) : defaultFollowing ? (
        <Following
          path="/"
          id="home"
          headerStart={false}
          headerEnd={<NotificationsLink />}
        />
      ) : (
        <Following
          title={_(msg`Home`)}
          path="/"
          id="home"
          headerStart={false}
          headerEnd={<NotificationsLink />}
        />
      )}
    </>
  );
}

type MenuState = 'open' | 'closed' | undefined;

function NotificationsLink() {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const notificationLinkRef = useRef<HTMLAnchorElement>(null);
  const [menuState, setMenuState] = useState<MenuState>(undefined);
  return (
    <>
      <Link
        ref={notificationLinkRef}
        to="/notifications"
        className={`button plain notifications-button ${
          snapStates.notificationsShowNew ? 'has-badge' : ''
        } ${menuState || ''}`}
        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
          e.stopPropagation();
          if (window.matchMedia('(min-width: calc(40em))').matches) {
            e.preventDefault();
            setMenuState((state) => (!state ? 'open' : undefined));
          }
        }}
      >
        <Icon icon="notification" size="l" alt={t`Notifications`} />
      </Link>
      <NotificationsMenu
        state={menuState}
        anchorRef={notificationLinkRef}
        onClose={() => setMenuState(undefined)}
      />
    </>
  );
}

interface NotificationsMenuProps {
  anchorRef: RefObject<HTMLAnchorElement | null>;
  state: MenuState;
  onClose: () => void;
}

interface NotificationItem {
  id: string;
  _ids?: string;
  status?: unknown;
}

interface ControlledMenuHandle {
  closeMenu?: () => void;
  scrollTop?: number;
}

type ControlledMenuRef = ControlledMenuHandle & HTMLElement;

const NOTIFICATIONS_DISPLAY_LIMIT = 5;
function NotificationsMenu({
  anchorRef,
  state,
  onClose,
}: NotificationsMenuProps) {
  const { masto, instance } = api();
  const snapStates = useSnapshot(states);
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );

  const [hasFollowRequests, setHasFollowRequests] = useState(false);

  const loadNotifications = useCallback(
    ({ skipFollowRequests = false }: { skipFollowRequests?: boolean } = {}) => {
      setUIState('loading');
      void (async () => {
        try {
          const notificationsIterator =
            mastoFetchNotifications() as AsyncIterator<unknown[]>;
          const allNotifications = await notificationsIterator.next();
          const notifications = massageNotifications2(
            allNotifications.value as Parameters<
              typeof massageNotifications2
            >[0],
          ) as NotificationItem[] | undefined;

          if (notifications?.length) {
            notifications.forEach((notification) => {
              saveStatus(
                notification.status as Parameters<typeof saveStatus>[0],
                instance,
                {
                  skipThreading: true,
                },
              );
            });

            const groupedNotifications = getGroupedNotifications(
              notifications,
            ) as NotificationItem[];

            states.notificationsLast = groupedNotifications[0];
            states.notifications = groupedNotifications;

            // Update last read marker
            (
              masto.v1.markers as {
                create(options: {
                  notifications: { lastReadId: string };
                }): Promise<unknown>;
              }
            )
              .create({
                notifications: {
                  lastReadId: groupedNotifications[0].id,
                },
              })
              .catch(() => {});
          }

          states.notificationsShowNew = false;
          states.notificationsLastFetchTime = Date.now();

          if (!skipFollowRequests) {
            const followRequests = await (
              masto.v1.followRequests as {
                list(options: { limit: number }): Promise<unknown[]>;
              }
            ).list({ limit: 1 });
            setHasFollowRequests(!!followRequests?.length);
          }
          setUIState('default');
        } catch {
          setUIState('error');
        }
      })();
    },
    [masto, instance],
  );

  const menuRef = useRef<ControlledMenuRef | null>(null);
  const headerHeight = 52;
  useEffect(() => {
    if (state !== 'open') return;
    if (snapStates.notificationsShowNew) {
      const menuElement = menuRef.current;
      if ((menuElement?.scrollTop ?? 0) <= headerHeight) {
        loadNotifications({
          skipFollowRequests: true,
        });
      }
    } else {
      loadNotifications();
    }
  }, [state, snapStates.notificationsShowNew, loadNotifications]);

  return (
    <ControlledMenu
      ref={menuRef}
      menuClassName="notifications-menu"
      state={state}
      anchorRef={anchorRef as never}
      onClose={onClose}
      portal={{
        target: document.body,
      }}
      containerProps={{
        onClick: () => {
          menuRef.current?.closeMenu?.();
        },
      }}
      overflow="auto"
      viewScroll="close"
      position="anchor"
      align="center"
      boundingBoxPadding="8 8 8 8"
    >
      <header>
        <h2>
          <Trans>Notifications</Trans>
        </h2>
      </header>
      <FilterContext.Provider value="notifications">
        <main>
          {snapStates.notifications.length ? (
            <>
              {(snapStates.notifications as NotificationItem[])
                .slice(0, NOTIFICATIONS_DISPLAY_LIMIT)
                .map((notification) => (
                  <Notification
                    key={notification._ids || notification.id}
                    instance={instance}
                    notification={
                      notification as Parameters<
                        typeof Notification
                      >[0]['notification']
                    }
                    disableContextMenu
                  />
                ))}
            </>
          ) : uiState === 'loading' ? (
            <div className="ui-state">
              <Loader abrupt />
            </div>
          ) : (
            uiState === 'error' && (
              <div className="ui-state">
                <p>
                  <Trans>Unable to fetch notifications.</Trans>
                </p>
                <p>
                  <button type="button" onClick={() => loadNotifications()}>
                    <Trans>Try again</Trans>
                  </button>
                </p>
              </div>
            )
          )}
        </main>
      </FilterContext.Provider>
      <footer>
        <Link to="/mentions" className="button plain">
          <Icon icon="at" />{' '}
          <span>
            <Trans>Mentions</Trans>
          </span>
        </Link>
        <Link to="/notifications" className="button plain2">
          {hasFollowRequests ? (
            <Trans>
              <span className="tag collapsed">New</span>{' '}
              <span>Follow Requests</span>
            </Trans>
          ) : (
            <b>
              <Trans>See all</Trans>
            </b>
          )}{' '}
          <Icon icon="arrow-right" />
        </Link>
      </footer>
    </ControlledMenu>
  );
}

export default memo(Home);

import './notifications-menu.css';

import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ControlledMenu } from '@szhsin/react-menu';
import type { RefObject } from 'react';
import { memo } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import Columns from '../components/columns';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import {
  isMutedNotification,
  NotificationReasonLabel,
} from '../components/notifications-feed';
import PostByUri from '../components/post-by-uri';
import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { feedReadMode } from '../data/_internal/dispatch';
import { notificationPostUri } from '../data/_internal/notification-post-uri';
import { getReadAgent } from '../data/clients';
import { useNotifications } from '../data/notifications';
import db from '../utils/db';
import FilterContext from '../utils/filter-context';
import states from '../utils/states';
import store from '../utils/store';
import { getCurrentAccountNS } from '../utils/store-utils';

import Following from './following';
import Following2 from './following2';
import List from './list';

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
        onClose={() => {
          setMenuState(undefined);
        }}
      />
    </>
  );
}

interface NotificationsMenuProps {
  anchorRef: RefObject<HTMLAnchorElement | null>;
  state: MenuState;
  onClose: () => void;
}

const NOTIFICATIONS_DISPLAY_LIMIT = 5;
function NotificationsMenu({
  anchorRef,
  state,
  onClose,
}: NotificationsMenuProps) {
  const snapStates = useSnapshot(states);
  const activeDid = useActiveDid();
  const clients = useClients();
  const { items, isLoading, error } = useNotifications();

  useEffect(() => {
    if (state !== 'open') return;
    if (snapStates.notificationsShowNew) {
      states.notificationsShowNew = false;
      states.notificationsLastFetchTime = Date.now();
      if (!activeDid || !clients.activeAppViewProxyAgent) return;
      try {
        const agent = getReadAgent(clients, feedReadMode(activeDid));
        void agent.app.bsky.notification.updateSeen({
          seenAt: new Date().toISOString(),
        });
      } catch (seenError) {
        console.warn('Failed to update notification seen marker', seenError);
      }
    }
  }, [activeDid, clients, state, snapStates.notificationsShowNew]);

  const visibleNotifications = items
    .filter((item) => !isMutedNotification(item, activeDid))
    .slice(0, NOTIFICATIONS_DISPLAY_LIMIT);

  return (
    <ControlledMenu
      menuClassName="notifications-menu"
      state={state}
      anchorRef={anchorRef as never}
      onClose={onClose}
      portal={{
        target: document.body,
      }}
      containerProps={{
        onClick: () => {
          onClose();
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
          {visibleNotifications.length ? (
            visibleNotifications.map((notification) => {
              const handle =
                notification.author.handle || notification.author.did;
              const postUri = notificationPostUri(notification);
              return (
                <div key={notification.uri} className="notification-menu-item">
                  <Link
                    to={`/at://${notification.author.did}/app.bsky.actor.profile/self`}
                  >
                    {handle}
                  </Link>{' '}
                  <span>
                    <NotificationReasonLabel reason={notification.reason} />
                  </span>
                  {postUri ? (
                    <PostByUri
                      uri={postUri}
                      size="s"
                      readOnly
                      showActionsBar={false}
                    />
                  ) : null}
                </div>
              );
            })
          ) : isLoading ? (
            <div className="ui-state">
              <Loader abrupt />
            </div>
          ) : error ? (
            <div className="ui-state">
              <p>
                <Trans>Unable to fetch notifications.</Trans>
              </p>
            </div>
          ) : (
            <div className="ui-state">
              <p>
                <Trans>No notifications yet.</Trans>
              </p>
            </div>
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
          <b>
            <Trans>See all</Trans>
          </b>{' '}
          <Icon icon="arrow-right" />
        </Link>
      </footer>
    </ControlledMenu>
  );
}

export default memo(Home);

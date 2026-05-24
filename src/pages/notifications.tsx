import './notifications.css';

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { ComponentType, SyntheticEvent, ReactNode } from 'react';
import { Fragment } from 'react';
import { memo } from 'react';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { InView as InViewUntyped } from 'react-intersection-observer';
import { useSearchParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';
import { subscribeKey } from 'valtio/utils';

import AccountBlock, {
  type AccountBlockProps,
} from '../components/account-block';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import Modal from '../components/modal';
import NavMenu from '../components/nav-menu';
import Notification, {
  type NotificationProps,
} from '../components/notification';
import RawHtml from '../components/raw-html';
import StatusComponent, {
  type StatusComponentProps,
} from '../components/status';
import { useActiveDid, useClients } from '../contexts/SessionProvider';
import { feedReadMode } from '../data/_internal/dispatch';
import { getReadAgent } from '../data/clients';
import { api } from '../utils/api';
import enhanceContent from '../utils/enhance-content';
import FilterContext from '../utils/filter-context';
import {
  groupNotifications2,
  massageNotifications2,
} from '../utils/group-notifications';
import handleContentLinks from '../utils/handle-content-links';
import haptics from '../utils/haptics';
import niceDateTime from '../utils/nice-date-time';
import { shouldShowMentionsShortcut } from '../utils/notifications-mentions-shortcut';
import shortenNumber from '../utils/shorten-number';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';
import {
  getAccountByAccessToken,
  getCurrentInstance,
} from '../utils/store-utils';
import usePageVisibility from '../utils/usePageVisibility';
import useScroll from '../utils/useScroll';
import useTitle from '../utils/useTitle';

// `InView` is still untyped for our React interop; shim with just the
// surface this page uses.
type InViewProps = {
  onChange?: (inView: boolean) => void;
  children?: ReactNode;
};
const InView: ComponentType<InViewProps> =
  InViewUntyped as typeof InViewUntyped & ComponentType<InViewProps>;

function Status(props: {
  status?: unknown;
  size?: 's' | 'm' | 'l';
  readOnly?: boolean;
}) {
  return <StatusComponent {...(props as StatusComponentProps)} />;
}

// Loose shape for the notification objects this page renders. These come
// from `getGroupedNotifications` which returns the union of the v1/v2 group
// outputs from `group-notifications.ts`. The page reads many fields off
// these without narrowing; mirror that with an open index signature.
type AccountBlockAccount = NonNullable<AccountBlockProps['account']>;

type NotificationLike = NotificationProps['notification'] & {
  id?: string;
  type?: string;
  createdAt?: string;
  notificationsCount?: number;
  status?: { id?: string } | null;
  _ids?: string;
  [key: string]: unknown;
};

// Shape of a notification request entry from the v1 endpoint. Loose because
// `masto.v1.notifications` is typed as `unknown` in our local masto shim.
interface NotificationRequestLike {
  id: string;
  account: AccountBlockAccount & {
    id: string;
    username?: string;
    [key: string]: unknown;
  };
  lastStatus?: { id?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

// `masto.v2.notifications` / `masto.v1.notifications` are typed as `unknown`
// in the local masto shim. Describe just the surface used in this file.
// NOTE: The JS original also reads `.nextParams` off the iterator returned
// from `values()` for a Pixelfed pagination guard. Keep it optional so the
// normal `undefined` read preserves the JS behavior.
interface NotificationsIterator extends AsyncIterableIterator<unknown> {
  nextParams?: unknown;
}
interface MastoV2NotificationsListIterable {
  values(): NotificationsIterator;
}
interface MastoV1NotificationsListResult
  extends
    MastoV2NotificationsListIterable,
    PromiseLike<NotificationLike[] | undefined> {}
interface MastoV2NotificationsApi {
  list(opts: {
    limit: number;
    [key: string]: unknown;
  }): MastoV2NotificationsListIterable;
  policy: {
    fetch(): Promise<NotificationsPolicy>;
    update(policy: NotificationsPolicy): Promise<unknown>;
  };
}
interface MastoV1NotificationsRequestsApi {
  list(): Promise<NotificationRequestLike[]>;
  $select(id: string): {
    accept(): Promise<unknown>;
    dismiss(): Promise<unknown>;
  };
}
interface MastoV1NotificationsApi {
  list(opts?: {
    limit?: number;
    [key: string]: unknown;
  }): MastoV1NotificationsListResult;
  requests: MastoV1NotificationsRequestsApi;
}

interface NotificationsPolicySummary {
  pendingRequestsCount?: number;
}
interface NotificationsPolicy {
  summary?: NotificationsPolicySummary;
  forNotFollowing?: string;
  forNotFollowers?: string;
  forNewAccounts?: string;
  forPrivateMentions?: string;
  forLimitedAccounts?: string;
  [key: string]: unknown;
}

interface AnnouncementReaction {
  name: string;
  count: number;
  me?: boolean;
  staticUrl?: string;
  url?: string;
}

interface AnnouncementLike {
  id: string;
  content: string;
  startsAt?: string | null;
  endsAt?: string | null;
  published?: boolean;
  allDay?: boolean;
  publishedAt: string;
  // `createdAt` is not part of Mastodon's public Announcement schema, but the
  // JS original referenced it in the sort comparator (`b.updatedAt ||
  // b.createdAt`). Preserve the read so behavior is unchanged.
  createdAt?: string;
  updatedAt: string;
  read?: boolean;
  mentions?: unknown[];
  statuses?: unknown[];
  tags?: unknown[];
  emojis?: readonly { shortcode?: string; url?: string; staticUrl?: string }[];
  reactions: AnnouncementReaction[];
}

const NOTIFICATIONS_GROUPED_LIMIT = 20;
const emptySearchParams = new URLSearchParams();

const scrollIntoViewOptions: ScrollIntoViewOptions = {
  block: 'start',
  inline: 'center',
  behavior: 'instant',
};

function mastoFetchNotificationsIterable(
  opts: Record<string, unknown> = {},
): MastoV2NotificationsListIterable {
  const { masto } = api();
  const v2Notifications = masto.v2.notifications as MastoV2NotificationsApi;
  // https://github.com/mastodon/mastodon/pull/29889
  return v2Notifications.list({
    limit: NOTIFICATIONS_GROUPED_LIMIT,
    ...opts,
  });
}
export function mastoFetchNotifications(opts: Record<string, unknown> = {}) {
  return mastoFetchNotificationsIterable(opts).values();
}

export function getGroupedNotifications(
  notifications: unknown,
): NotificationLike[] {
  return groupNotifications2(
    notifications as Parameters<typeof groupNotifications2>[0],
  ) as NotificationLike[];
}

type NotificationsPolicyKey =
  | 'forNotFollowing'
  | 'forNotFollowers'
  | 'forNewAccounts'
  | 'forPrivateMentions'
  | 'forLimitedAccounts';

const NOTIFICATIONS_POLICIES: NotificationsPolicyKey[] = [
  'forNotFollowing',
  'forNotFollowers',
  'forNewAccounts',
  'forPrivateMentions',
  'forLimitedAccounts',
];
const NOTIFICATIONS_POLICIES_TEXT: Record<
  NotificationsPolicyKey,
  MessageDescriptor
> = {
  forNotFollowing: msg`You don't follow`,
  forNotFollowers: msg`Who don't follow you`,
  forNewAccounts: msg`With a new account`,
  forPrivateMentions: msg`Who unsolicitedly private mention you`,
  forLimitedAccounts: msg`Who are limited by Bluesky moderators`,
};

interface NotificationsProps {
  columnMode?: boolean;
}

function Notifications({ columnMode }: NotificationsProps) {
  const { i18n, t } = useLingui();
  const _ = i18n._.bind(i18n);
  useTitle(t`Notifications`, '/notifications');
  const { masto, instance } = api();
  const activeDid = useActiveDid();
  const clients = useClients();
  const snapStates = useSnapshot(states);
  const [uiState, setUIState] = useState('default');
  const [routerSearchParams] = useSearchParams();
  const searchParams = columnMode ? emptySearchParams : routerSearchParams;
  const notificationID =
    searchParams.get('notification_id') || searchParams.get('id');
  const notificationAccountID = searchParams.get('account_id');
  const legacyNotificationAccessToken = searchParams.get('access_token');
  const [showMore, setShowMore] = useState(false);
  const [onlyMentions, setOnlyMentions] = useState(false);
  const cachedNotifications = (
    states.notifications as NotificationLike[]
  ).filter((notification) => notification.type !== 'follow_request');
  const [showMentionsLink, setShowMentionsLink] = useState(() =>
    shouldShowMentionsShortcut(cachedNotifications),
  );
  const [hasAnalyzedFirstLoad, setHasAnalyzedFirstLoad] = useState<
    boolean | number
  >(cachedNotifications.length > 0);
  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const { scrollDirection, reachStart, nearReachStart } = useScroll({
    scrollableRef,
  });
  const hiddenUI = scrollDirection === 'end' && !nearReachStart;
  const [announcements, setAnnouncements] = useState<AnnouncementLike[]>([]);

  console.debug('RENDER Notifications');

  const notificationsIterable = useRef<MastoV2NotificationsListIterable | null>(
    null,
  );
  const notificationsIterator = useRef<ReturnType<
    MastoV2NotificationsListIterable['values']
  > | null>(null);
  async function fetchNotifications(
    firstLoad?: boolean,
  ): Promise<{ done?: boolean; value?: unknown }> {
    if (firstLoad || !notificationsIterator.current) {
      // Reset iterator
      notificationsIterable.current = mastoFetchNotificationsIterable({
        excludeTypes: ['follow_request'],
      });
      notificationsIterator.current = notificationsIterable.current.values();
    }
    // Preserve JS original: read `.nextParams` directly off the iterator.
    // masto's `AsyncIterableIterator` does not expose this field, so the
    // value is `undefined` at runtime and the regex test always returns
    // `false` (`String(undefined)` → `"undefined"`). Keep the dead guard
    // verbatim so behavior matches; do not coerce away from `undefined`.
    if (
      /max_id=($|&)/i.test(String(notificationsIterator.current?.nextParams))
    ) {
      // Pixelfed returns next paginationed link with empty max_id
      // I assume, it's done (end of list)
      return {
        done: true,
      };
    }
    const allNotifications = await notificationsIterator.current.next();
    const notifications = massageNotifications2(
      allNotifications.value as Parameters<typeof massageNotifications2>[0],
    ) as NotificationLike[] | undefined;

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

      // TEST: Slot in a fake notification to test 'severed_relationships'
      // notifications.unshift({
      //   id: '123123',
      //   type: 'severed_relationships',
      //   createdAt: '2024-03-22T19:20:08.316Z',
      //   event: {
      //     type: 'account_suspension',
      //     targetName: 'mastodon.dev',
      //     followersCount: 0,
      //     followingCount: 0,
      //   },
      // });

      // TEST: Slot in a fake notification to test 'moderation_warning'
      // notifications.unshift({
      //   id: '123123',
      //   type: 'moderation_warning',
      //   createdAt: new Date().toISOString(),
      //   moderation_warning: {
      //     id: '1231234',
      //     action: 'mark_statuses_as_sensitive',
      //   },
      // });

      // console.log({ notifications });

      const groupedNotifications = getGroupedNotifications(notifications);

      if (firstLoad) {
        states.notificationsLast = groupedNotifications[0];
        states.notifications = groupedNotifications;

        if (activeDid && clients.activeAppViewProxyAgent) {
          try {
            const agent = getReadAgent(clients, feedReadMode(activeDid));
            void agent.app.bsky.notification.updateSeen({
              seenAt: new Date().toISOString(),
            });
          } catch (seenError) {
            console.warn(
              'Failed to update notification seen marker',
              seenError,
            );
          }
        }

        if (!columnMode) analyzeNotifications(groupedNotifications);
      } else {
        states.notifications.push(...groupedNotifications);
      }
    }

    states.notificationsShowNew = false;
    states.notificationsLastFetchTime = Date.now();
    return allNotifications as { done?: boolean; value?: unknown };
  }

  async function fetchAnnouncements(): Promise<AnnouncementLike[]> {
    try {
      const announcementsApi = masto.v1.announcements as {
        list(): Promise<AnnouncementLike[]>;
      };
      return await announcementsApi.list();
    } catch {
      // Silently fail
      return [];
    }
  }

  const supportsFilteredNotifications = true;
  const [showNotificationsSettings, setShowNotificationsSettings] =
    useState(false);
  const [notificationsPolicy, setNotificationsPolicy] =
    useState<NotificationsPolicy>({});
  function fetchNotificationsPolicy(): Promise<
    NotificationsPolicy | undefined
  > {
    const v2Notifications = masto.v2.notifications as MastoV2NotificationsApi;
    return v2Notifications.policy.fetch().catch(() => undefined);
  }
  function loadNotificationsPolicy() {
    void fetchNotificationsPolicy()
      .then((policy) => {
        console.log('✨ Notifications policy', policy);
        // Match JS original: pass whatever the fetch resolves to (including
        // `undefined` on failure path) straight to the setter.
        setNotificationsPolicy(policy as NotificationsPolicy);
        return undefined;
      })
      .catch(() => {});
  }
  const [notificationsRequests, setNotificationsRequests] = useState<
    NotificationRequestLike[] | null
  >(null);
  function fetchNotificationsRequest(): Promise<NotificationRequestLike[]> {
    const v1Notifications = masto.v1.notifications as MastoV1NotificationsApi;
    return v1Notifications.requests.list();
  }

  const analyzeNotifications = (notifications: NotificationLike[]) => {
    // Once Mentions link is shown, don't need to analyze again
    if (showMentionsLink) return;

    setShowMentionsLink(shouldShowMentionsShortcut(notifications));
    setHasAnalyzedFirstLoad(Date.now());
  };

  const loadNotifications = (firstLoad?: boolean) => {
    setShowNew(false);
    setUIState('loading');
    void (async () => {
      try {
        const fetchNotificationsPromise = fetchNotifications(firstLoad);

        if (firstLoad) {
          void fetchAnnouncements()
            .then((fetchedAnnouncements) => {
              fetchedAnnouncements.sort((a, b) => {
                // Sort by updatedAt first, then createdAt
                return (
                  Date.parse((b.updatedAt || b.createdAt) as string) -
                  Date.parse((a.updatedAt || a.createdAt) as string)
                );
              });
              setAnnouncements(fetchedAnnouncements);
              return undefined;
            })
            .catch(() => {});

          if (supportsFilteredNotifications) {
            loadNotificationsPolicy();
          }
        }

        const { done } = await fetchNotificationsPromise;
        setShowMore(!done);

        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  };

  // Latest-value ref so the mount/reachStart effects below can dispatch the
  // current loadNotifications without depending on its identity (it is
  // recreated every render and would otherwise refetch on each render).
  const loadNotificationsRef = useRef(loadNotifications);
  loadNotificationsRef.current = loadNotifications;

  useEffect(() => {
    loadNotificationsRef.current(true);
  }, []);
  const loadReachStartNotifications = useEffectEvent(() => {
    if (reachStart) {
      loadNotificationsRef.current(true);
    }
  });
  useEffect(() => {
    loadReachStartNotifications();
  }, [reachStart]);

  // useEffect(() => {
  //   if (nearReachEnd && showMore) {
  //     loadNotifications();
  //   }
  // }, [nearReachEnd, showMore]);

  const [showNew, setShowNew] = useState(false);

  const loadUpdates = useCallback(
    ({ disableIdleCheck = false }: { disableIdleCheck?: boolean } = {}) => {
      if (uiState === 'loading') {
        return;
      }
      console.log('✨ Load updates', {
        autoRefresh: snapStates.settings.autoRefresh,
        scrollTop: scrollableRef.current?.scrollTop,
        inBackground: inBackground(),
        disableIdleCheck,
      });
      // Preserve JS comparison semantics: `undefined < 16` is `false`, so
      // skipping the check when `scrollTop` is missing matches the original.
      if (
        snapStates.settings.autoRefresh &&
        (scrollableRef.current?.scrollTop as number) < 16 &&
        (disableIdleCheck || window.__IDLE__) &&
        !inBackground()
      ) {
        loadNotificationsRef.current(true);
      }
    },
    [snapStates.settings.autoRefresh, uiState],
  );
  // useEffect(loadUpdates, [snapStates.notificationsShowNew]);

  const lastHiddenTime = useRef<number | undefined>(undefined);
  usePageVisibility((visible) => {
    if (visible) {
      const timeDiff = Date.now() - (lastHiddenTime.current ?? 0);
      if (!lastHiddenTime.current || timeDiff > 1000 * 3) {
        // 3 seconds
        loadUpdates({
          disableIdleCheck: true,
        });
      } else {
        lastHiddenTime.current = Date.now();
      }
    }
  });
  const firstLoad = useRef(true);
  // Latest-value refs so the subscription below stays mount-only without
  // capturing stale `uiState` / `loadUpdates`.
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;
  const loadUpdatesRef = useRef(loadUpdates);
  loadUpdatesRef.current = loadUpdates;
  useEffect(() => {
    let unsub = subscribeKey(states, 'notificationsShowNew', (v) => {
      if (firstLoad.current) {
        firstLoad.current = false;
        return;
      }
      if (uiStateRef.current === 'loading') return;
      if (v) loadUpdatesRef.current();
      setShowNew(v);
    });
    return () => {
      unsub?.();
    };
  }, []);

  const todayDate = new Date();
  const yesterdayDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);
  let currentDay = new Date();
  const visibleNotifications = (
    snapStates.notifications as NotificationLike[]
  ).filter((notification) => notification.type !== 'follow_request');
  const showTodayEmpty = !visibleNotifications.some(
    (notification) =>
      new Date(notification.createdAt as string).toDateString() ===
      todayDate.toDateString(),
  );

  const announcementsListRef = useRef<HTMLUListElement | null>(null);

  const syncRouteNotification = useEffectEvent(() => {
    if (notificationID) {
      let legacyAccountId: string | undefined;
      try {
        legacyAccountId = legacyNotificationAccessToken
          ? getAccountByAccessToken(atob(legacyNotificationAccessToken))?.info
              .id
          : undefined;
      } catch {}
      states.routeNotification = {
        id: notificationID,
        accountId: notificationAccountID ?? legacyAccountId,
      };
    }
  });
  useEffect(() => {
    syncRouteNotification();
  }, [notificationID, notificationAccountID, legacyNotificationAccessToken]);

  // useEffect(() => {
  //   if (uiState === 'default') {
  //     (async () => {
  //       try {
  //         const registration = await getRegistration();
  //         if (registration?.getNotifications) {
  //           const notifications = await registration.getNotifications();
  //           console.log('🔔 Push notifications', notifications);
  //           // Close all notifications?
  //           // notifications.forEach((notification) => {
  //           //   notification.close();
  //           // });
  //         }
  //       } catch (e) {}
  //     })();
  //   }
  // }, [uiState]);

  const itemsSelector = '.notification';
  const jRef = useHotkeys<HTMLDivElement>(
    'j',
    () => {
      const activeItem = document.activeElement?.closest(
        itemsSelector,
      ) as HTMLElement | null;
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current?.querySelectorAll<HTMLElement>(itemsSelector) ??
          [],
      );
      if (
        activeItem &&
        activeItemRect &&
        scrollableRef.current &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let nextItem = allItems[activeItemIndex + 1];
        if (nextItem) {
          nextItem.focus();
          nextItem.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0;
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'j',
    },
  );

  const kRef = useHotkeys<HTMLDivElement>(
    'k',
    () => {
      // focus on previous status after active item
      const activeItem = document.activeElement?.closest(
        itemsSelector,
      ) as HTMLElement | null;
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current?.querySelectorAll<HTMLElement>(itemsSelector) ??
          [],
      );
      if (
        activeItem &&
        activeItemRect &&
        scrollableRef.current &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let prevItem = allItems[activeItemIndex - 1];
        if (prevItem) {
          prevItem.focus();
          prevItem.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0;
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'k',
    },
  );

  const oRef = useHotkeys<HTMLDivElement>(
    ['enter', 'o'],
    () => {
      const activeItem = document.activeElement?.closest(itemsSelector);
      const statusLink = activeItem?.querySelector(
        '.status-link',
      ) as HTMLElement | null;
      if (statusLink) {
        statusLink.click();
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) => {
        // 'enter' doesn't need key validation (physical key, layout-independent)
        if (e.key === 'Enter') return false;
        return (
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey ||
          e.key.toLowerCase() !== 'o'
        );
      },
    },
  );

  const dotRef = useHotkeys<HTMLDivElement>(
    '.',
    () => {
      loadNotifications(true);
      scrollableRef.current?.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    },
    {
      useKey: true,
      ignoreEventWhen: (e) => {
        // Allow '.' even with Shift (some keyboard layouts require Shift for '.')
        if (e.key === '.') return false;
        return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
    },
  );

  const today = new Date();
  const todayDayKey = today.toDateString();
  const todaySubHeading = useMemo(() => {
    return niceDateTime(new Date(todayDayKey), {
      forceOpts: {
        weekday: 'long',
      },
    });
  }, [todayDayKey]);

  return (
    <div
      id="notifications-page"
      className="deck-container"
      data-timeline-id="notifications"
      ref={(node) => {
        scrollableRef.current = node;
        jRef.current = node;
        kRef.current = node;
        oRef.current = node;
        dotRef.current = node;
      }}
      tabIndex={-1}
    >
      <div
        className={`timeline-deck deck ${onlyMentions ? 'only-mentions' : ''}`}
      >
        <header
          hidden={hiddenUI}
          role="presentation"
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            if (!(e.target as HTMLElement | null)?.closest('a, button')) {
              scrollableRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              const target = e.target as HTMLElement | null;
              if (target?.closest('a, button')) return;
              e.preventDefault();
              scrollableRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          onDoubleClick={(e: React.MouseEvent<HTMLElement>) => {
            if (!(e.target as HTMLElement | null)?.closest('a, button')) {
              loadNotifications(true);
            }
          }}
          className={uiState === 'loading' ? 'loading' : ''}
        >
          <div className="header-grid">
            <div className="header-side">
              <NavMenu />
              <Link to="/" className="button plain">
                <Icon icon="home" size="l" alt={t`Home`} />
              </Link>
            </div>
            <h1>
              <Trans>Notifications</Trans>
            </h1>
            <div className="header-side">
              {supportsFilteredNotifications && (
                <button
                  type="button"
                  className="button plain4"
                  onClick={() => {
                    setShowNotificationsSettings(true);
                  }}
                >
                  <Icon
                    icon="settings"
                    size="l"
                    alt={t`Notifications settings`}
                  />
                </button>
              )}
            </div>
          </div>
          {showNew && uiState !== 'loading' && (
            <button
              className="updates-button shiny-pill"
              type="button"
              onClick={() => {
                loadNotifications(true);
                scrollableRef.current?.scrollTo({
                  top: 0,
                  behavior: 'smooth',
                });
              }}
            >
              <Icon icon="arrow-up" /> <Trans>New notifications</Trans>
            </button>
          )}
        </header>
        {announcements.length > 0 && (
          <div className="shazam-container">
            <div className="shazam-container-inner">
              <details className="announcements">
                <summary>
                  <span>
                    <Icon
                      icon="announce"
                      className="announcement-icon"
                      size="l"
                    />{' '}
                    <Plural
                      value={announcements.length}
                      one="Announcement"
                      other="Announcements"
                    />{' '}
                    <small className="insignificant">{instance}</small>
                  </span>
                  {announcements.length > 1 && (
                    <span className="announcements-nav-buttons">
                      {announcements.map((announcement, index) => (
                        <button
                          key={announcement.id}
                          type="button"
                          className="plain2 small"
                          onClick={() => {
                            (
                              announcementsListRef.current?.children[index] as
                                | HTMLElement
                                | undefined
                            )?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'nearest',
                            });
                          }}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </span>
                  )}
                </summary>
                <ul
                  className={`announcements-list-${
                    announcements.length > 1 ? 'multiple' : 'single'
                  }`}
                  ref={announcementsListRef}
                >
                  {announcements.map((announcement) => (
                    <li key={announcement.id}>
                      <AnnouncementBlock announcement={announcement} />
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        )}
        {supportsFilteredNotifications &&
          (notificationsPolicy?.summary?.pendingRequestsCount ?? 0) > 0 && (
            <div className="shazam-container">
              <div className="shazam-container-inner">
                <div className="filtered-notifications">
                  <details
                    onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => {
                      const { open } = e.target as HTMLDetailsElement;
                      if (open) {
                        void (async () => {
                          const requests = await fetchNotificationsRequest();
                          setNotificationsRequests(requests);
                          console.log({ open, requests });
                        })();
                      }
                    }}
                  >
                    <summary>
                      <Plural
                        value={
                          notificationsPolicy.summary?.pendingRequestsCount ?? 0
                        }
                        one="Filtered notifications from # person"
                        other="Filtered notifications from # people"
                      />
                    </summary>
                    {!notificationsRequests ? (
                      <p className="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      notificationsRequests?.length > 0 && (
                        <ul>
                          {notificationsRequests.map((request) => (
                            <li key={request.id}>
                              <div className="request-notifcations">
                                {!request.lastStatus?.id && (
                                  <AccountBlock
                                    useAvatarStatic
                                    showStats
                                    account={request.account}
                                  />
                                )}
                                {request.lastStatus?.id && (
                                  <div className="last-post">
                                    <Link
                                      className="status-link"
                                      to={`/${instance}/s/${request.lastStatus.id}`}
                                    >
                                      <Status
                                        status={request.lastStatus}
                                        size="s"
                                        readOnly
                                      />
                                    </Link>
                                  </div>
                                )}
                                <NotificationRequestModalButton
                                  request={request}
                                />
                              </div>
                              <NotificationRequestButtons
                                request={request}
                                onChange={() => {
                                  loadNotifications(true);
                                }}
                              />
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                  </details>
                </div>
              </div>
            </div>
          )}
        {!!hasAnalyzedFirstLoad && (
          <div id="mentions-option">
            {showMentionsLink ? (
              <Link to="/mentions" className="button plain">
                <Icon icon="at" />{' '}
                <span>
                  <Trans>Mentions</Trans>
                </span>{' '}
                <Icon icon="arrow-right" className="more-insignificant" />
              </Link>
            ) : (
              <label>
                <input
                  aria-label={t`Only mentions`}
                  type="checkbox"
                  checked={onlyMentions}
                  onChange={(e: SyntheticEvent<HTMLInputElement>) => {
                    setOnlyMentions((e.target as HTMLInputElement).checked);
                  }}
                />{' '}
                <Trans>Only mentions</Trans>
              </label>
            )}
          </div>
        )}
        <h2 className="timeline-header">
          <Trans>Today</Trans>{' '}
          <small className="insignificant bidi-isolate">
            {todaySubHeading}
          </small>
        </h2>
        {showTodayEmpty && (
          <p className="ui-state insignificant">
            {uiState === 'default' ? t`You're all caught up.` : <>&hellip;</>}
          </p>
        )}
        {visibleNotifications.length ? (
          <FilterContext.Provider value="notifications">
            {visibleNotifications.map((notification) => {
              if (onlyMentions && notification.type !== 'mention') {
                return null;
              }
              const notificationDay = new Date(
                notification.createdAt as string,
              );
              const differentDay =
                notificationDay.toDateString() !== currentDay.toDateString();
              if (differentDay) {
                currentDay = notificationDay;
              }
              // if notificationDay is yesterday, show "Yesterday"
              // if notificationDay is before yesterday, show date
              const heading =
                notificationDay.toDateString() === yesterdayDate.toDateString()
                  ? t`Yesterday`
                  : niceDateTime(currentDay, {
                      hideTime: true,
                    });
              const subHeading = niceDateTime(currentDay, {
                forceOpts: {
                  weekday: 'long',
                },
              });
              return (
                <Fragment key={notification._ids || notification.id}>
                  {differentDay && (
                    <h2 className="timeline-header">
                      <span>{heading}</span>{' '}
                      <small className="insignificant bidi-isolate">
                        {subHeading}
                      </small>
                    </h2>
                  )}
                  <Notification
                    instance={instance}
                    notification={notification}
                    key={notification._ids || notification.id}
                  />
                </Fragment>
              );
            })}
          </FilterContext.Provider>
        ) : (
          <>
            {uiState === 'loading' && (
              <>
                <ul className="timeline flat">
                  {Array.from({ length: 5 }).map((skel, i) => (
                    <li key={i} className="notification skeleton">
                      <div className="notification-type">
                        <Icon icon="notification" size="xl" />
                      </div>
                      <div className="notification-content">
                        <p>███████████ ████</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {uiState === 'error' && (
              <p className="ui-state">
                <Trans>Unable to load notifications</Trans>
                <br />
                <br />
                <button
                  type="button"
                  onClick={() => {
                    loadNotifications(true);
                  }}
                >
                  <Trans>Try again</Trans>
                </button>
              </p>
            )}
          </>
        )}
        {showMore && (
          <InView
            onChange={(inView) => {
              if (inView) {
                loadNotifications();
              }
            }}
          >
            <button
              type="button"
              className="plain block"
              disabled={uiState === 'loading'}
              onClick={() => {
                loadNotifications();
              }}
              style={{ marginBlockEnd: '6em' }}
            >
              {uiState === 'loading' ? (
                <Loader abrupt />
              ) : (
                <Trans>Show more…</Trans>
              )}
            </button>
          </InView>
        )}
      </div>
      {supportsFilteredNotifications && showNotificationsSettings && (
        <Modal
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowNotificationsSettings(false);
            }
          }}
        >
          <div className="sheet" id="notifications-settings" tabIndex={-1}>
            <button
              type="button"
              className="sheet-close"
              onClick={() => {
                setShowNotificationsSettings(false);
              }}
            >
              <Icon icon="x" alt={t`Close`} />
            </button>
            <header>
              <h2>
                <Trans>Notifications settings</Trans>
              </h2>
            </header>
            <main>
              <form
                onSubmit={(ev: SyntheticEvent<HTMLFormElement>) => {
                  ev.preventDefault();
                  const form = ev.currentTarget
                    .elements as HTMLFormControlsCollection &
                    Record<NotificationsPolicyKey, HTMLInputElement>;
                  const {
                    forNotFollowing,
                    forNotFollowers,
                    forNewAccounts,
                    forPrivateMentions,
                    forLimitedAccounts,
                  } = form;
                  const newPolicy: NotificationsPolicy = {
                    ...notificationsPolicy,
                    forNotFollowing: forNotFollowing.value,
                    forNotFollowers: forNotFollowers.value,
                    forNewAccounts: forNewAccounts.value,
                    forPrivateMentions: forPrivateMentions.value,
                    forLimitedAccounts: forLimitedAccounts.value,
                  };
                  setNotificationsPolicy(newPolicy);
                  setShowNotificationsSettings(false);
                  void (async () => {
                    try {
                      const v2Notifications = masto.v2
                        .notifications as MastoV2NotificationsApi;
                      await v2Notifications.policy.update(newPolicy);
                      showToast(t`Notifications settings updated`);
                    } catch (e) {
                      console.error(e);
                    }
                  })();
                }}
              >
                <p>
                  <Trans>Filter out notifications from people:</Trans>
                </p>
                <div className="notification-policy-fields">
                  {NOTIFICATIONS_POLICIES.map((key) => {
                    const value = notificationsPolicy[key];
                    return (
                      <div key={key}>
                        <label>
                          {_(NOTIFICATIONS_POLICIES_TEXT[key])}
                          <select
                            aria-label={_(NOTIFICATIONS_POLICIES_TEXT[key])}
                            name={key}
                            defaultValue={value}
                            className="small"
                          >
                            <option value="accept">
                              <Trans>Accept</Trans>
                            </option>
                            <option value="filter">
                              <Trans>Filter</Trans>
                            </option>
                            <option value="drop">
                              <Trans>Ignore</Trans>
                            </option>
                          </select>
                        </label>
                      </div>
                    );
                  })}
                </div>
                <p>
                  <button type="submit">
                    <Trans>Save</Trans>
                  </button>
                </p>
              </form>
            </main>
          </div>
        </Modal>
      )}
    </div>
  );
}

function inBackground() {
  return !!document.querySelector('.deck-backdrop, #modal-container > *');
}

interface AnnouncementBlockProps {
  announcement: AnnouncementLike;
}
function AnnouncementBlock({ announcement }: AnnouncementBlockProps) {
  const { instance } = api();
  const { contact } = getCurrentInstance() as {
    contact?: { account?: unknown };
  };
  const contactAccount = contact?.account;
  const { content, publishedAt, updatedAt, mentions, emojis, reactions } =
    announcement;

  const publishedAtDate = new Date(publishedAt);
  const publishedDateText = niceDateTime(publishedAtDate);
  const updatedAtDate = new Date(updatedAt);
  const updatedAtText = niceDateTime(updatedAtDate);

  return (
    <div className="announcement-block">
      <AccountBlock
        account={
          contactAccount as Parameters<typeof AccountBlock>[0]['account']
        }
      />
      {/* TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
          this div delegates link clicks via handleContentLinks; embedded
          anchors are focusable. A non-functional role/keydown shim would
          provide no real a11y benefit. */}
      <RawHtml
        className="announcement-content"
        role="presentation"
        onClick={handleContentLinks({
          mentions: mentions as { url?: string; acct?: string }[] | undefined,
          instance,
        })}
        html={enhanceContent(content, { emojis }) as string}
      />
      <p className="insignificant">
        <time dateTime={publishedAtDate.toISOString()}>
          {niceDateTime(publishedAtDate)}
        </time>
        {updatedAt && updatedAtText !== publishedDateText && (
          <>
            {' '}
            &bull;{' '}
            <span className="ib">
              <Trans>
                Updated{' '}
                <time dateTime={updatedAtDate.toISOString()}>
                  {niceDateTime(updatedAtDate)}
                </time>
              </Trans>
            </span>
          </>
        )}
      </p>
      <div className="announcement-reactions" hidden>
        {reactions.map((reaction: AnnouncementReaction) => {
          const { name, count, me, staticUrl, url } = reaction;
          return (
            <button
              key={name}
              type="button"
              className={`plain4 small ${me ? 'reacted' : ''}`}
            >
              {url || staticUrl ? (
                <img src={url || staticUrl} alt={name} width="16" height="16" />
              ) : (
                <span>{name}</span>
              )}{' '}
              <span className="count">{shortenNumber(count)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fetchNotficationsByAccount(accountID: string) {
  const { masto } = api();
  const v1Notifications = masto.v1.notifications as MastoV1NotificationsApi;
  return v1Notifications.list({
    accountId: accountID,
  });
}
interface NotificationRequestModalButtonProps {
  request: NotificationRequestLike;
}
function NotificationRequestModalButton({
  request,
}: NotificationRequestModalButtonProps) {
  // Use the runtime `t` from useLingui to avoid shadowing the module-level
  // macro import; mirrors the pattern used elsewhere in the codebase.
  const { t } = useLingui();
  const { instance } = api();
  const [uiState, setUIState] = useState('loading');
  const { account } = request;
  const [showModal, setShowModal] = useState(false);
  const [notifications, setNotifications] = useState<NotificationLike[]>([]);

  function onClose() {
    setShowModal(false);
  }

  useEffect(() => {
    if (!request?.account?.id) return;
    if (!showModal) return;
    setUIState('loading');
    void (async () => {
      // Preserve original JS behavior: the JS original `await`ed
      // `masto.v1.notifications.list(...)` directly without `.values()`.
      // The masto paginator returns a thenable-ish object; awaiting it
      // resolves to the first-page array. Mirror that runtime contract.
      const notifs =
        (await fetchNotficationsByAccount(request.account.id)) || [];
      setNotifications(notifs);
      setUIState('default');
    })();
  }, [showModal, request?.account?.id]);

  return (
    <>
      <button
        type="button"
        className="plain4 request-notifications-account"
        onClick={() => {
          setShowModal(true);
        }}
      >
        <Icon icon="notification" className="more-insignificant" />{' '}
        <small>
          <Trans>
            View notifications from{' '}
            <span className="bidi-isolate">@{account.username}</span>
          </Trans>
        </small>{' '}
        <Icon icon="chevron-down" />
      </button>
      {showModal && (
        <Modal
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <div className="sheet" tabIndex={-1}>
            <button type="button" className="sheet-close" onClick={onClose}>
              <Icon icon="x" alt={t`Close`} />
            </button>
            <header>
              <b>
                <Trans>
                  Notifications from{' '}
                  <span className="bidi-isolate">@{account.username}</span>
                </Trans>
              </b>
            </header>
            <main>
              {uiState === 'loading' ? (
                <p className="ui-state">
                  <Loader abrupt />
                </p>
              ) : (
                notifications.map((notification) => (
                  // TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
                  // wrapper exists solely to forward modal-close when a child
                  // anchor/button is clicked; keyboard activation already
                  // happens via the child interactive elements.
                  <div
                    key={notification.id}
                    className="notification-peek"
                    role="presentation"
                    onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                      const target = e.target as HTMLElement | null;
                      // If button or links
                      if (
                        target?.tagName === 'BUTTON' ||
                        target?.tagName === 'A'
                      ) {
                        onClose();
                      }
                    }}
                  >
                    <Notification
                      instance={instance}
                      notification={notification}
                      isStatic
                    />
                  </div>
                ))
              )}
            </main>
          </div>
        </Modal>
      )}
    </>
  );
}

interface NotificationRequestButtonsChange {
  request: NotificationRequestLike;
  state: 'accept' | 'dismiss';
}
interface NotificationRequestButtonsProps {
  request: NotificationRequestLike;
  onChange: (change: NotificationRequestButtonsChange) => void;
}
type RequestState = 'accept' | 'dismiss' | null;
function NotificationRequestButtons({
  request,
  onChange,
}: NotificationRequestButtonsProps) {
  const { t } = useLingui();
  const { masto } = api();
  const [uiState, setUIState] = useState('default');
  const [requestState, setRequestState] = useState<RequestState>(null); // accept, dismiss
  const hasRequestState = requestState !== null;

  return (
    <p className="notification-request-buttons">
      <button
        type="button"
        disabled={uiState === 'loading' || hasRequestState}
        onClick={() => {
          void haptics.trigger('success');
          setUIState('loading');
          void (async () => {
            try {
              const v1Notifications = masto.v1
                .notifications as MastoV1NotificationsApi;
              await v1Notifications.requests.$select(request.id).accept();
              setRequestState('accept');
              setUIState('default');
              onChange({
                request,
                state: 'accept',
              });
              showToast(
                t`Notifications from @${request.account.username} will not be filtered from now on.`,
              );
            } catch (error) {
              setUIState('error');
              console.error(error);
              showToast(t`Unable to accept notification request`);
            }
          })();
        }}
      >
        <Trans>Allow</Trans>
      </button>{' '}
      <button
        type="button"
        disabled={uiState === 'loading' || hasRequestState}
        className="light danger"
        onClick={() => {
          void haptics.trigger('light');
          setUIState('loading');
          void (async () => {
            try {
              const v1Notifications = masto.v1
                .notifications as MastoV1NotificationsApi;
              await v1Notifications.requests.$select(request.id).dismiss();
              setRequestState('dismiss');
              setUIState('default');
              onChange({
                request,
                state: 'dismiss',
              });
              showToast(
                t`Notifications from @${request.account.username} will not show up in Filtered notifications from now on.`,
              );
            } catch (error) {
              setUIState('error');
              console.error(error);
              showToast(t`Unable to dismiss notification request`);
            }
          })();
        }}
      >
        <Trans>Dismiss</Trans>
      </button>
      <span className="notification-request-states">
        {uiState === 'loading' ? (
          <Loader abrupt />
        ) : requestState === 'accept' ? (
          <Icon
            icon="check-circle"
            alt={t`Accepted`}
            className="notification-accepted"
          />
        ) : (
          requestState === 'dismiss' && (
            <Icon
              icon="x-circle"
              alt={t`Dismissed`}
              className="notification-dismissed"
            />
          )
        )}
      </span>
    </p>
  );
}

export default memo(Notifications);

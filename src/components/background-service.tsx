import { useLingui } from '@lingui/react/macro';
import { memo } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { api } from '../utils/api';
import { useAuth } from '../utils/auth-context';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';
import useInterval from '../utils/useInterval';
import usePageVisibility from '../utils/usePageVisibility';

const STREAMING_TIMEOUT = 1000 * 3; // 3 seconds
const POLL_INTERVAL = 20_000; // 20 seconds

interface MastoLike {
  v1: {
    notifications: {
      list(options: { limit: number; sinceId: string }): {
        values(): AsyncIterator<Array<{ id: string }>, undefined>;
      };
    };
    markers: {
      fetch(options: { timeline: 'notifications' }): Promise<
        | {
            notifications?: { lastReadId?: string };
          }
        | undefined
      >;
    };
  };
}

type NotificationPayload = Parameters<typeof saveStatus>[0];
type NotificationEntry = { event: string; payload: NotificationPayload };
type NotificationSub = AsyncIterable<NotificationEntry> & {
  unsubscribe?: () => void;
};

interface StreamingLike {
  user: {
    notification: {
      subscribe(): NotificationSub;
    };
  };
}

type BackgroundApi = ReturnType<typeof api> & {
  masto: MastoLike;
  streaming?: StreamingLike;
};

async function checkLatestNotification(
  masto: MastoLike,
  skipCheckMarkers?: boolean,
) {
  if (states.notificationsLast) {
    const notificationsIterator = masto.v1.notifications
      .list({
        limit: 1,
        sinceId: (states.notificationsLast as { id: string }).id,
      })
      .values();
    const { value: notifications } = await notificationsIterator.next();
    if (notifications?.length) {
      if (skipCheckMarkers) {
        states.notificationsShowNew = true;
      } else {
        let lastReadId;
        try {
          const markers = await masto.v1.markers.fetch({
            timeline: 'notifications',
          });
          lastReadId = markers?.notifications?.lastReadId;
        } catch {}
        if (lastReadId) {
          states.notificationsShowNew = notifications[0].id !== lastReadId;
        } else {
          states.notificationsShowNew = true;
        }
      }
    }
  }
}

export default memo(function BackgroundService() {
  const isLoggedIn = useAuth();
  const { t } = useLingui();

  // Notifications service
  // - WebSocket to receive notifications when page is visible
  const [visible, setVisible] = useState(true);
  const visibleTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  usePageVisibility((isVisible) => {
    clearTimeout(visibleTimeout.current);
    if (isVisible) {
      setVisible(true);
    } else {
      visibleTimeout.current = setTimeout(() => {
        setVisible(false);
      }, POLL_INTERVAL);
    }
  });

  useEffect(() => {
    let sub: NotificationSub | null = null;
    let streamTimeout: ReturnType<typeof setTimeout> | undefined;
    let pollNotifications: ReturnType<typeof setInterval> | undefined;
    if (isLoggedIn && visible) {
      const { masto, streaming, instance } = api() as BackgroundApi;
      void (async () => {
        // 1. Get the latest notification
        await checkLatestNotification(masto);

        let hasStreaming = false;
        // 2. Start streaming
        if (streaming) {
          streamTimeout = setTimeout(() => {
            void (async () => {
              try {
                hasStreaming = true;
                sub = streaming.user.notification.subscribe();
                console.log('🎏 Streaming notification', sub);
                for await (const entry of sub) {
                  if (!sub) break;
                  if (!visible) break;
                  console.log('🔔🔔 Notification entry', entry);
                  if (entry.event === 'notification') {
                    console.log('🔔🔔 Notification', entry);
                    saveStatus(entry.payload, instance, {
                      skipThreading: true,
                    });
                  }
                  states.notificationsShowNew = true;
                }
                console.log('💥 Streaming notification loop STOPPED');
              } catch (e) {
                hasStreaming = false;
                console.error(e);
              }

              if (!hasStreaming) {
                console.log('🎏 Streaming failed, fallback to polling');
                pollNotifications = setInterval(() => {
                  void checkLatestNotification(masto, true);
                }, POLL_INTERVAL);
              }
            })();
          }, STREAMING_TIMEOUT);
        }
      })();
    }
    return () => {
      sub?.unsubscribe?.();
      sub = null;
      clearTimeout(streamTimeout);
      clearInterval(pollNotifications);
    };
  }, [visible, isLoggedIn]);

  // Check for updates service
  const lastCheckDate = useRef<number | undefined>(undefined);
  const checkForUpdates = () => {
    lastCheckDate.current = Date.now();
    console.log('✨ Check app update');
    void (async () => {
      try {
        const r = await fetch('./version.json');
        if (!r.ok) return;
        const contentType = r.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) return;
        const info = await r.json();
        if (info) states.appVersion = info;
      } catch (e) {
        console.error(e);
      }
    })();
  };
  useInterval(checkForUpdates, visible && 1000 * 60 * 30); // 30 minutes
  usePageVisibility((isVisible) => {
    if (isVisible) {
      if (!lastCheckDate.current) {
        checkForUpdates();
      } else {
        const diff = Date.now() - lastCheckDate.current;
        if (diff > 1000 * 60 * 60) {
          // 1 hour
          checkForUpdates();
        }
      }
    }
  });

  // Global keyboard shortcuts "service"
  useHotkeys(
    'shift+alt+k',
    (e) => {
      // Need modifers check due to useKey: true
      if (!e.shiftKey || !e.altKey) return;

      const currentCloakMode = states.settings.cloakMode;
      states.settings.cloakMode = !currentCloakMode;
      showToast({
        text: currentCloakMode ? t`Cloak mode disabled` : t`Cloak mode enabled`,
      });
    },
    {
      ignoreEventWhen: (e) => e.metaKey || e.ctrlKey,
    },
  );

  return null;
});

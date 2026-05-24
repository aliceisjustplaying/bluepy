import { Trans, useLingui } from '@lingui/react/macro';
import { memo } from 'react';
import { useLayoutEffect, useState } from 'react';
import { useSnapshot } from 'valtio';

import { api } from '../utils/api';
import { currentAppPath, navigatePath } from '../utils/router';
import states from '../utils/states';
import type { StoredAccount } from '../utils/store-utils';
import {
  getAccount,
  getAccounts,
  getCurrentAccount,
} from '../utils/store-utils';
import usePageVisibility from '../utils/usePageVisibility';

import Icon from './icon';
import Link from './link';
import Modal from './modal';
import Notification, { type NotificationProps } from './notification';

interface ServiceWorkerNotificationMessage {
  accountId?: string;
  type?: string;
  id?: string;
}

interface RouteNotification {
  accountId?: string;
  id?: string;
}

interface NotificationFetchedAccount {
  id?: string;
  [key: string]: unknown;
}

interface NotificationFetchedStatus {
  id?: string;
  [key: string]: unknown;
}

interface NotificationFetched {
  type?: string;
  status?: NotificationFetchedStatus | null;
  account?: NotificationFetchedAccount;
  [key: string]: unknown;
}

interface NotificationsApi {
  $select(id: string): {
    fetch(): Promise<NotificationFetched | null | undefined>;
  };
}

{
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event?.data as ServiceWorkerNotificationMessage | undefined;
      const { accountId, type, id } = data || {};
      if (type === 'notification') {
        states.routeNotification = {
          accountId,
          id,
        };
      }
    });
  }
}

interface NotificationSheetData {
  id: string;
  account: StoredAccount;
  notification: NotificationFetched;
  sameInstance: boolean;
}

export default memo(function NotificationService() {
  const { t } = useLingui();
  const hasServiceWorker = 'serviceWorker' in navigator;

  const snapStates = useSnapshot(states);
  const { routeNotification } = snapStates;

  const routeNotificationData =
    (routeNotification as RouteNotification | null | undefined) || {};
  const queryParams = new URLSearchParams(window.location.search);
  const id =
    routeNotificationData.id ?? queryParams.get('notification_id') ?? undefined;
  const accountId =
    routeNotificationData.accountId ??
    queryParams.get('account_id') ??
    undefined;
  const [showNotificationSheet, setShowNotificationSheet] = useState<
    false | NotificationSheetData
  >(false);

  useLayoutEffect(() => {
    if (!hasServiceWorker) return;
    if (!id) return;
    const accounts = getAccounts();
    const targetAccount = accountId
      ? getAccount(accountId)
      : accounts.length === 1
        ? accounts[0]
        : null;
    if (!targetAccount) return;
    const currentAccount = getCurrentAccount();
    const { instance: currentInstance } = api({ account: currentAccount });
    const { masto, instance } = api({ account: targetAccount });
    const sameInstance = currentInstance === instance;
    const account = targetAccount;
    void (async () => {
      const notifications = masto.v1.notifications as NotificationsApi;
      const notification = await notifications.$select(id).fetch();
      if (notification && account) {
        const accountInstance = account.instanceURL;
        const { type, status, account: notificationAccount } = notification;
        const hasModal = !!document.querySelector('#modal-container > *');
        const isFollow = type === 'follow' && !!notificationAccount?.id;
        const hasAccount = !!notificationAccount?.id;
        const hasStatus = !!status?.id;
        if (isFollow && sameInstance) {
          // Show account sheet, can handle different instances
          states.showAccount = {
            account: notificationAccount,
            instance: accountInstance,
          };
        } else if (hasModal || !sameInstance || (hasAccount && hasStatus)) {
          // Show sheet of notification, if
          // - there is a modal open
          // - the notification is from another instance
          // - the notification has both account and status, gives choice for users to go to account or status
          setShowNotificationSheet({
            id,
            account,
            notification,
            sameInstance,
          });
        } else {
          if (hasStatus) {
            // Go to status page
            navigatePath(`/${currentInstance}/s/${status?.id}`);
          } else if (isFollow) {
            // Go to profile page
            navigatePath(`/${currentInstance}/a/${notificationAccount?.id}`);
          } else {
            // Go to notifications page
            navigatePath('/notifications');
          }
        }
      } else {
        console.warn('🛎️ Notification not found', id);
      }
    })();
  }, [accountId, id, hasServiceWorker]);

  // useLayoutEffect(() => {
  //   // Listen to message from service worker
  //   const handleMessage = (event) => {
  //     console.log('💥💥💥 Message event', event);
  //     const { type, id } = event?.data || {};
  //     if (type === 'notification') {
  //       states.routeNotification = {
  //         id,
  //       };
  //     }
  //   };
  //   console.log('👂👂👂 Listen to message');
  //   navigator.serviceWorker.addEventListener('message', handleMessage);
  //   return () => {
  //     console.log('👂👂👂 Remove listen to message');
  //     navigator.serviceWorker.removeEventListener('message', handleMessage);
  //   };
  // }, []);

  useLayoutEffect(() => {
    if (navigator.clearAppBadge) {
      void navigator.clearAppBadge();
    }
  }, []);
  usePageVisibility((visible: boolean) => {
    if (visible && navigator.clearAppBadge) {
      console.log('🔰 Clear app badge');
      void navigator.clearAppBadge();
    }
  });

  if (!hasServiceWorker) return null;

  const onClose = () => {
    setShowNotificationSheet(false);
    states.routeNotification = null;

    if (/\/notifications\?(id|notification_id)=/i.test(currentAppPath())) {
      navigatePath('/notifications');
    }
  };

  if (showNotificationSheet) {
    const { account, notification, sameInstance } = showNotificationSheet;
    return (
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
              <Trans>Notification</Trans>
            </b>
          </header>
          <main>
            {!sameInstance && (
              <p>
                <Trans>This notification is from your other account.</Trans>
              </p>
            )}
            {/* TODO(oxlint:jsx-a11y/no-static-element-interactions,
                jsx-a11y/click-events-have-key-events): the wrapper div
                listens for click bubbles so it can auto-dismiss the toast
                when the user clicks a child button/link. Adding a keyboard
                mirror would intercept Enter before the child's own
                activation logic runs (closing the sheet first). The
                children themselves own their keyboard semantics. */}
            <div
              className="notification-peek"
              role="presentation"
              // style={{
              //   pointerEvents: sameInstance ? '' : 'none',
              // }}
              onClick={(e) => {
                const target = e.target as HTMLElement | null;
                // If button or links
                if (target?.tagName === 'BUTTON' || target?.tagName === 'A') {
                  onClose();
                }
              }}
            >
              <Notification
                instance={account.instanceURL}
                notification={notification as NotificationProps['notification']}
                isStatic
              />
            </div>
            <div
              style={{
                textAlign: 'end',
              }}
            >
              <Link
                to="/notifications"
                className="button light"
                onClick={onClose}
              >
                <span>
                  <Trans>View all notifications</Trans>
                </span>{' '}
                <Icon icon="arrow-right" />
              </Link>
            </div>
          </main>
        </div>
      </Modal>
    );
  }

  return null;
});

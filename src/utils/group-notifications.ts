import type { mastodon } from 'masto';

import { sorted } from './sorted';

// Loose shapes for the inputs and outputs of these helpers. The runtime data
// is `mastodon.v1.Notification` / `mastodon.v2.NotificationGroup` payloads,
// but these helpers also mutate notifications and accounts in-place (adding
// `_types`, `_accounts`, `_statuses`, etc.) and accept partial / malformed
// payloads. The masto entity unions are too strict for that pattern, so we
// describe a wider local shape that mirrors what the JS original allowed.
//
// TODO(oxlint:no-underscore-dangle) The `_types`, `_accounts`, `_statuses`,
// `_ids`, `_groupKeys`, `_notificationsCount`, `_sampleAccountsCount` fields
// throughout this file form the project-wide cross-module notification
// augmentation namespace, used by `status.tsx` / `notification.tsx` /
// `generic-accounts.tsx`. Renaming requires a cross-cutting refactor and is
// out of scope.

interface AccountWithTypes extends Partial<mastodon.v1.Account> {
  _types?: string[];
}

interface NotificationLike {
  id?: string;
  type?: string;
  createdAt?: string;
  account?: AccountWithTypes;
  status?: mastodon.v1.Status | null;
  _ids?: string;
  _accounts?: AccountWithTypes[];
  _statuses?: (mastodon.v1.Status | null | undefined)[];
  [key: string]: unknown;
}

interface NotificationGroupLike {
  id?: string;
  type?: string;
  createdAt?: string;
  account?: AccountWithTypes;
  status?: mastodon.v1.Status | null;
  groupKey?: string;
  sampleAccountIds?: string[];
  // `sampleAccounts` entries may be undefined: `massageNotifications2` resolves
  // each id via `accounts.find(...)`, which yields `undefined` for ids that
  // are not present in the payload. The JS original passed these undefineds
  // straight through, so we keep the loose entry type to match behavior.
  sampleAccounts?: (AccountWithTypes | undefined)[];
  statusId?: string | null;
  notificationsCount?: number;
  mostRecentNotificationId?: string | number;
  latestPageNotificationAt?: string;
  _ids?: string;
  _accounts?: (AccountWithTypes | undefined)[];
  _statuses?: (mastodon.v1.Status | null | undefined)[];
  _groupKeys?: string[];
  _notificationsCount?: number[];
  _sampleAccountsCount?: number[];
  [key: string]: unknown;
}

// Augmented shape used after an entry has been inserted into the local
// `notificationsMap` in `groupNotifications2` — these fields are guaranteed
// to be initialized by the `else` branch that creates the entry, so the
// merge branches can treat them as non-optional.
type AugmentedNotificationGroup = NotificationGroupLike & {
  _accounts: (AccountWithTypes | undefined)[];
  _groupKeys: string[];
  _notificationsCount: number[];
  _sampleAccountsCount: number[];
  sampleAccounts: (AccountWithTypes | undefined)[];
};

type AugmentedNotificationGroup2 = NotificationGroupLike & {
  _groupKeys: string[];
  _ids: string | undefined;
  _statuses: (mastodon.v1.Status | null | undefined)[];
};

type AugmentedNotification = NotificationLike & {
  _accounts: AccountWithTypes[];
  _ids: string | undefined;
};

type AugmentedNotification2 = NotificationLike & {
  _ids: string | undefined;
  _statuses: (mastodon.v1.Status | null | undefined)[];
};

interface GroupedNotificationsPayload {
  accounts?: AccountWithTypes[];
  notificationGroups?: NotificationGroupLike[];
  statuses?: mastodon.v1.Status[];
  [key: string]: unknown;
}

// This is like very lame "type-checking" lol
const notificationTypeKeys: Record<string, string[]> = {
  mention: ['account', 'status'],
  quote: ['account', 'status'],
  status: ['account', 'status'],
  reblog: ['account', 'status'],
  follow: ['account'],
  favourite: ['account', 'status'],
  update: ['status'],
};

const GROUP_TYPES = new Set(['favourite', 'reblog', 'follow', 'admin.sign_up']);
const groupable = (type: string | undefined): boolean =>
  !!type && GROUP_TYPES.has(type);

export function fixNotifications(
  notifications: NotificationLike[],
): NotificationLike[] {
  return notifications.filter((notification) => {
    const { type, id, createdAt } = notification;
    if (!type) {
      console.warn('Notification missing type', notification);
      return false;
    }
    if (!id || !createdAt) {
      console.warn('Notification missing id or createdAt', notification);
      // Continue processing this despite missing id or createdAt
    }
    const keys = notificationTypeKeys[type];
    if (keys?.length) {
      return keys.every((key) => !!notification[key]);
    }
    return true; // skip other types
  });
}

export function massageNotifications2(
  notifications: GroupedNotificationsPayload | NotificationLike[] | undefined,
): NotificationGroupLike[] | NotificationLike[] | undefined {
  if (
    notifications &&
    !Array.isArray(notifications) &&
    notifications.notificationGroups
  ) {
    const {
      accounts = [],
      notificationGroups = [],
      statuses = [],
    } = notifications;
    return notificationGroups.map((group) => {
      const { sampleAccountIds, statusId } = group;
      const sampleAccounts =
        sampleAccountIds?.map((id) => accounts.find((a) => a.id === id)) || [];
      const status = statuses?.find((s) => s.id === statusId) || null;
      return Object.assign({}, group, {
        sampleAccounts,
        status,
      }) as NotificationGroupLike;
    });
  }
  return notifications as NotificationLike[] | undefined;
}

export function groupNotifications2(
  notificationGroups: NotificationGroupLike[],
): NotificationGroupLike[] {
  // Make grouped notifications to look like faux grouped notifications. The
  // JS original assumed `sampleAccounts` was an array (built upstream by
  // `massageNotifications2`) and indexed into it directly; preserve that
  // contract — a missing `sampleAccounts` here is a malformed-input crash.
  const newGroupNotifications: NotificationGroupLike[] = notificationGroups.map(
    (gn) => {
      const {
        latestPageNotificationAt,
        mostRecentNotificationId,
        sampleAccounts,
      } = gn;

      return {
        id: '' + mostRecentNotificationId,
        createdAt: latestPageNotificationAt,
        account: sampleAccounts?.[0],
        ...gn,
      };
    },
  );

  // Merge favourited and reblogged of same status into a single notification
  // - new type: "favourite+reblog"
  // - sum numbers for `notificationsCount` and `sampleAccounts`
  const notificationsMap: Record<string, AugmentedNotificationGroup> = {};
  const newGroupNotifications1: NotificationGroupLike[] = [];
  for (let i = 0; i < newGroupNotifications.length; i++) {
    const gn = newGroupNotifications[i];
    const {
      type,
      status,
      createdAt,
      notificationsCount,
      sampleAccounts,
      groupKey,
    } = gn;
    const date = createdAt ? new Date(createdAt).toLocaleDateString() : '';
    let virtualType = type;
    // const sameCount = notificationsCount > 0 && notificationsCount === sampleAccounts?.length;
    // if (sameCount && (type === 'favourite' || type === 'reblog')) {
    // NOTE: The JS original compared `undefined > 0` etc., which is always
    // false. Use `as number` shims to keep that exact runtime behavior:
    // comparisons against undefined coerce to NaN-vs-number and yield false.
    const sampleCountDiffNotificationsCount =
      (notificationsCount as number) > 0 &&
      (sampleAccounts?.length as number) > 0 &&
      (notificationsCount as number) > (sampleAccounts?.length as number);
    if (
      !sampleCountDiffNotificationsCount &&
      (type === 'favourite' || type === 'reblog')
    ) {
      virtualType = 'favourite+reblog';
    }
    // const key = `${status?.id}-${virtualType}-${date}-${sameCount ? 1 : 0}`;
    const key = `${status?.id}-${virtualType}-${date}`;
    const mappedNotification = notificationsMap[key];
    if (!groupable(type)) {
      // Merge mention and quote if same status
      // NOTES:
      // - status.id is definitely the same
      // - account is definitely the same too and will only be one
      if ((type === 'mention' || type === 'quote') && status?.id) {
        const otherGN = newGroupNotifications1.find(
          (o) =>
            ((type === 'quote' && o.type === 'mention') ||
              (type === 'mention' && o.type === 'quote')) &&
            o.status?.id === status.id,
        );
        if (otherGN) {
          otherGN.type = 'mention+quote';
          continue; // Skip below logic
        }
      }

      newGroupNotifications1.push(gn);
    } else if (mappedNotification) {
      // Merge sampleAccounts + merge _types. The JS original assumed
      // `sampleAccounts` was an array (built upstream by
      // `massageNotifications2`) — a missing `sampleAccounts` here is a
      // malformed-input crash. Individual entries can still be `undefined`,
      // matching `massageNotifications2`'s lookup-by-id behavior.
      (sampleAccounts ?? []).forEach((a) => {
        if (!a) return;
        const mappedAccount = mappedNotification.sampleAccounts.find(
          (ma) => ma?.id === a.id,
        );
        if (!mappedAccount) {
          mappedNotification.sampleAccounts.push({
            ...a,
            _types: [type as string],
          });
        } else {
          mappedAccount._types ??= [];
          mappedAccount._types.push(type as string);
          // Equivalent to the JS original `_types.sort().reverse()`: default
          // string compare then reverse, without requiring ES2023 toSorted.
          mappedAccount._types = sorted(mappedAccount._types, (t1, t2) =>
            t1 < t2 ? 1 : t1 > t2 ? -1 : 0,
          );
        }
      });
      // mappedNotification.notificationsCount =
      //   mappedNotification.sampleAccounts.length;
      // NOTE: The JS original passed `undefined` straight into `Math.min` /
      // `push`, yielding `NaN` and `undefined` entries on partial inputs.
      // Preserve that with `as number` shims rather than normalizing to 0.
      mappedNotification.notificationsCount = Math.min(
        mappedNotification.notificationsCount as number,
        notificationsCount as number,
      );
      mappedNotification._notificationsCount.push(notificationsCount as number);
      mappedNotification._sampleAccountsCount.push(sampleAccounts?.length ?? 0);
      mappedNotification._accounts = mappedNotification.sampleAccounts;
      if (groupKey) mappedNotification._groupKeys.push(groupKey);
    } else {
      // The JS original calls `.map` on `sampleAccounts` directly — a
      // missing array here is a malformed-input crash. Individual entries
      // can still be `undefined` (see `massageNotifications2`), which the
      // spread turns into malformed `{_types: [type]}` objects downstream.
      const accounts = (sampleAccounts ?? []).map((a) =>
        Object.assign({}, a, { _types: [type as string] }),
      );
      // Preserve JS-original behavior: pushes `undefined` if the upstream
      // payload omitted the field, rather than normalizing to 0.
      const newEntry: AugmentedNotificationGroup = {
        ...gn,
        sampleAccounts: accounts,
        type: virtualType,
        _accounts: accounts,
        _groupKeys: groupKey ? [groupKey] : [],
        _notificationsCount: [notificationsCount as number],
        _sampleAccountsCount: [sampleAccounts?.length ?? 0],
      };
      notificationsMap[key] = newEntry;
      newGroupNotifications1.push(newEntry);
    }
  }

  // 2nd pass.
  // - Group 1 account favourte/reblog multiple posts
  // - _statuses: [status, status, ...]
  const notificationsMap2: Record<string, AugmentedNotificationGroup2> = {};
  const newGroupNotifications2: NotificationGroupLike[] = [];
  for (let i = 0; i < newGroupNotifications1.length; i++) {
    const gn = newGroupNotifications1[i];
    const { type, account, _accounts, sampleAccounts, createdAt, groupKey } =
      gn;
    const date = createdAt ? new Date(createdAt).toLocaleDateString() : '';
    const hasOneAccount =
      sampleAccounts?.length === 1 || _accounts?.length === 1;
    if (
      (type === 'favourite' ||
        type === 'reblog' ||
        type === 'favourite+reblog') &&
      hasOneAccount
    ) {
      const key = `${account?.id}-${type}-${date}`;
      const mappedNotification = notificationsMap2[key];
      if (mappedNotification) {
        mappedNotification._statuses.push(gn.status);
        mappedNotification._ids = `${mappedNotification._ids}-${gn.id}`;
        // Original JS pushed unconditionally, so `groupKey` may be `undefined`.
        mappedNotification._groupKeys.push(groupKey as string);
      } else {
        const newEntry: AugmentedNotificationGroup2 = {
          ...gn,
          type,
          _ids: gn.id,
          _statuses: [gn.status],
          _groupKeys: groupKey ? [groupKey] : [],
        };
        notificationsMap2[key] = newEntry;
        newGroupNotifications2.push(newEntry);
      }
    } else {
      newGroupNotifications2.push(gn);
    }
  }

  console.log('newGroupNotifications2', newGroupNotifications2);

  return newGroupNotifications2;
}

export default function groupNotifications(
  notifications: NotificationLike[],
): NotificationLike[] {
  // Filter out invalid notifications
  notifications = fixNotifications(notifications);

  // Create new flat list of notifications
  // Combine sibling notifications based on type and status id
  // Concat all notification.account into an array of _accounts
  const notificationsMap: Record<string, AugmentedNotification> = {};
  const cleanNotifications: NotificationLike[] = [];
  for (let i = 0, j = 0; i < notifications.length; i++) {
    const notification = notifications[i];
    const { id, status, account, type, createdAt } = notification;
    const date = createdAt ? new Date(createdAt).toLocaleDateString() : '';
    let virtualType = type;
    if (type === 'favourite' || type === 'reblog') {
      virtualType = 'favourite+reblog';
    }
    const key = `${status?.id}-${virtualType}-${date}`;
    const mappedNotification = notificationsMap[key];
    if (!groupable(type)) {
      cleanNotifications[j++] = notification;
    } else if (mappedNotification?.account && account) {
      // The JS original dereferences `account.id` directly here — `account`
      // is expected to exist when the existing mapped entry has one
      // (groupable notifications share the same key). Match that contract.
      const mappedAccount = mappedNotification._accounts.find(
        (a) => a.id === account.id,
      );
      if (mappedAccount) {
        mappedAccount._types ??= [];
        mappedAccount._types.push(type as string);
        // Equivalent to the JS original `_types.sort().reverse()`: default
        // string compare then reverse, without requiring ES2023 toSorted.
        mappedAccount._types = sorted(mappedAccount._types, (a, b) =>
          a < b ? 1 : a > b ? -1 : 0,
        );
        mappedNotification._ids = `${mappedNotification._ids}-${id}`;
      } else {
        account._types = [type as string];
        mappedNotification._accounts.push(account);
        mappedNotification._ids = `${mappedNotification._ids}-${id}`;
      }
    } else {
      if (account) account._types = [type as string];
      const newEntry: AugmentedNotification = {
        ...notification,
        type: virtualType,
        _ids: id,
        _accounts: account ? [account] : [],
      };
      notificationsMap[key] = newEntry;
      cleanNotifications[j++] = newEntry;
    }
  }

  // 2nd pass to group "favourite+reblog"-type notifications by account if _accounts.length <= 1
  // This means one acount has favourited and reblogged the multiple statuses
  // The grouped notification
  // - type: "favourite+reblog+account"
  // - _statuses: [status, status, ...]
  const notificationsMap2: Record<string, AugmentedNotification2> = {};
  const cleanNotifications2: NotificationLike[] = [];
  for (let i = 0, j = 0; i < cleanNotifications.length; i++) {
    const notification = cleanNotifications[i];
    const { id, account, _accounts, type, createdAt } = notification;
    const date = createdAt ? new Date(createdAt).toLocaleDateString() : '';
    // Original JS uses `_accounts.length` directly; `type === 'favourite+reblog'`
    // is only set in the first-pass `else` branch which initializes `_accounts`,
    // so `_accounts` is always an array here.
    if (type === 'favourite+reblog' && account && _accounts?.length === 1) {
      const key = `${account?.id}-${type}-${date}`;
      const mappedNotification = notificationsMap2[key];
      if (mappedNotification) {
        mappedNotification._statuses.push(notification.status);
        mappedNotification._ids = `${mappedNotification._ids}-${id}`;
      } else {
        const newEntry: AugmentedNotification2 = {
          ...notification,
          type,
          _ids: id,
          _statuses: [notification.status],
        };
        notificationsMap2[key] = newEntry;
        cleanNotifications2[j++] = newEntry;
      }
    } else {
      cleanNotifications2[j++] = notification;
    }
  }

  console.log({ notifications, cleanNotifications, cleanNotifications2 });

  // return cleanNotifications;
  return cleanNotifications2;
}

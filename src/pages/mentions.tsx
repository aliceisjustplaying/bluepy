import './mentions.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { useSearchParams } from 'react-router-dom';

import Link from '../components/link';
import TimelineUntyped from '../components/timeline';
import { api } from '../utils/api';
import { fixNotifications } from '../utils/group-notifications';
import { fetchRelationships } from '../utils/relationships';
import { saveStatus } from '../utils/states';
import { getCurrentAccountID } from '../utils/store-utils';
import useTitle from '../utils/useTitle';

const LIMIT = 20;
const emptySearchParams = new URLSearchParams();

interface NotificationLike {
  id?: string;
  type?: string;
  createdAt?: string;
  account?: mastodon.v1.Account;
  status?: mastodon.v1.Status | null;
  [key: string]: unknown;
}

interface ConversationLike {
  id?: string;
  lastStatus?: mastodon.v1.Status | null;
  [key: string]: unknown;
}

type StatusLike = mastodon.v1.Status;

interface MastoNotificationsApi {
  list(options: {
    limit: number;
    types?: string[];
    since_id?: string;
  }): {
    values(): AsyncIterator<NotificationLike[]>;
  };
}

interface MastoConversationsApi {
  list(options: {
    limit: number;
    since_id?: string;
  }): {
    values(): AsyncIterator<ConversationLike[]>;
  };
}

interface FetchItemsResult {
  done?: boolean;
  value: (StatusLike | null | undefined)[] | undefined;
}

interface TimelineProps {
  title?: string;
  id?: string;
  timelineKey?: string;
  emptyText?: string;
  errorText?: string;
  instance?: string;
  fetchItems?: (firstLoad?: boolean) => Promise<FetchItemsResult>;
  checkForUpdates?: () => Promise<boolean>;
  useItemID?: boolean;
  timelineStart?: preact.ComponentChildren;
  refresh?: string;
  filterContext?: string;
}

const Timeline = TimelineUntyped as unknown as ComponentType<TimelineProps>;

interface MentionsProps {
  columnMode?: boolean;
  type?: string;
  [key: string]: unknown;
}

function Mentions({ columnMode, ...props }: MentionsProps) {
  const { t } = useLingui();
  const { masto, instance } = api();
  const notificationsApi = (masto.v1 as unknown as {
    notifications: MastoNotificationsApi;
  }).notifications;
  const conversationsApi = (masto.v1 as unknown as {
    conversations: MastoConversationsApi;
  }).conversations;
  const [searchParams] = columnMode ? [emptySearchParams] : useSearchParams();
  const [stateType, setStateType] = useState<string | null>(null);
  const type = props?.type || searchParams.get('type') || stateType;
  useTitle(type === 'private' ? t`Private mentions` : t`Mentions`, '/mentions');

  const [onlyFollowings, setOnlyFollowings] = useState(false);
  const relationshipsMap = useRef<Record<string, mastodon.v1.Relationship>>({});

  const mentionsIterator = useRef<
    AsyncIterator<NotificationLike[]> | undefined
  >(undefined);
  const latestItem = useRef<string | undefined>(undefined);

  function filterByFollowings(
    items: (StatusLike | null | undefined)[] | undefined,
  ): (StatusLike | null | undefined)[] {
    if (!onlyFollowings || !items?.length) return items ?? [];

    const currentAccountID = getCurrentAccountID();
    return items.filter((item) => {
      const accountID = item?.account?.id;
      if (!accountID) return false;

      // Exclude self-posts
      if (accountID === currentAccountID) {
        return false;
      }

      const relationship = relationshipsMap.current[accountID];
      return relationship?.following === true;
    });
  }

  async function fetchMentions(firstLoad?: boolean): Promise<FetchItemsResult> {
    if (firstLoad || !mentionsIterator.current) {
      mentionsIterator.current = notificationsApi
        .list({
          limit: LIMIT,
          types: ['mention'],
        })
        .values();
    }
    const results = await mentionsIterator.current.next();
    let { value } = results as {
      done?: boolean;
      value: NotificationLike[] | undefined;
    };
    if (value?.length) {
      value = fixNotifications(
        value as unknown as Parameters<typeof fixNotifications>[0],
      ) as unknown as NotificationLike[];

      if (firstLoad) {
        latestItem.current = value[0]?.id;
        console.log('First load', latestItem.current);
      }

      value.forEach(({ status: item }) => {
        saveStatus(
          item as unknown as Parameters<typeof saveStatus>[0],
          instance,
        );
      });

      let statuses: (mastodon.v1.Status | null | undefined)[] = value.map(
        (item) => item.status,
      );
      if (onlyFollowings && statuses?.length) {
        const accounts = statuses
          .map((status) => status?.account)
          .filter((a): a is mastodon.v1.Account => !!a && !!a.id);
        const relationships = await fetchRelationships(
          accounts,
          relationshipsMap.current,
        );
        if (relationships) {
          relationshipsMap.current = {
            ...relationshipsMap.current,
            ...relationships,
          };
        }
        statuses = filterByFollowings(statuses);
      }

      return {
        ...(results as { done?: boolean }),
        value: statuses,
      };
    }
    return {
      ...(results as { done?: boolean }),
      value: (value as NotificationLike[] | undefined)?.map(
        (item) => item.status,
      ),
    };
  }

  const conversationsIterator = useRef<
    AsyncIterator<ConversationLike[]> | undefined
  >(undefined);
  const latestConversationItem = useRef<string | undefined>(undefined);
  async function fetchConversations(
    firstLoad?: boolean,
  ): Promise<FetchItemsResult> {
    if (firstLoad || !conversationsIterator.current) {
      conversationsIterator.current = conversationsApi
        .list({
          limit: LIMIT,
        })
        .values();
    }
    const results = await conversationsIterator.current.next();
    let { value } = results as {
      done?: boolean;
      value: ConversationLike[] | undefined;
    };
    value = value?.filter((item) => item.lastStatus);
    if (value?.length) {
      if (firstLoad) {
        latestConversationItem.current = value[0].lastStatus?.id;
        console.log('First load', latestConversationItem.current);
      }

      value.forEach(({ lastStatus: item }) => {
        saveStatus(
          item as unknown as Parameters<typeof saveStatus>[0],
          instance,
        );
      });

      let statuses: (mastodon.v1.Status | null | undefined)[] = value.map(
        (item) => item.lastStatus,
      );
      if (onlyFollowings && statuses?.length) {
        const accounts = statuses
          .map((status) => status?.account)
          .filter((a): a is mastodon.v1.Account => !!a && !!a.id);
        const relationships = await fetchRelationships(
          accounts,
          relationshipsMap.current,
        );
        if (relationships) {
          relationshipsMap.current = {
            ...relationshipsMap.current,
            ...relationships,
          };
        }
        statuses = filterByFollowings(statuses);
      }

      console.log('results', results);
      return {
        ...(results as { done?: boolean }),
        value: statuses,
      };
    }
    console.log('results', results);
    return {
      ...(results as { done?: boolean }),
      value: value?.map((item) => item.lastStatus),
    };
  }

  function fetchItems(firstLoad?: boolean): Promise<FetchItemsResult> {
    if (type === 'private') {
      return fetchConversations(firstLoad);
    }
    return fetchMentions(firstLoad);
  }

  async function checkForUpdates(): Promise<boolean> {
    if (type === 'private') {
      try {
        const results = await conversationsApi
          .list({
            limit: 1,
            since_id: latestConversationItem.current,
          })
          .values()
          .next();
        let { value } = results as { value: ConversationLike[] | undefined };
        console.log(
          'checkForUpdates PRIVATE',
          latestConversationItem.current,
          value,
        );
        const valueContainsLatestItem =
          value?.[0]?.id === latestConversationItem.current; // since_id might not be supported
        if (value?.length && !valueContainsLatestItem) {
          // Preserve JS behavior: throw if lastStatus is missing.
          const lastStatus = value[0].lastStatus;
          if (!lastStatus) {
            throw new TypeError(
              "Cannot read properties of undefined (reading 'id')",
            );
          }
          latestConversationItem.current = lastStatus.id;
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    } else {
      try {
        const results = await notificationsApi
          .list({
            limit: 1,
            types: ['mention'],
            since_id: latestItem.current,
          })
          .values()
          .next();
        let { value } = results as { value: NotificationLike[] | undefined };
        console.log('checkForUpdates ALL', latestItem.current, value);
        if (value?.length) {
          latestItem.current = value[0].id;
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    }
  }

  const TimelineStart = useMemo(() => {
    return (
      <>
        <div id="followings-option">
          <label>
            <input
              type="checkbox"
              checked={onlyFollowings}
              onChange={(e) => {
                setOnlyFollowings((e.currentTarget as HTMLInputElement).checked);
              }}
            />{' '}
            <Trans>Only followings</Trans>
          </label>
        </div>
        <div class="filter-bar">
          <Link
            to="/mentions"
            class={!type ? 'is-active' : ''}
            onClick={(e: Event) => {
              if (columnMode) {
                e.preventDefault();
                setStateType(null);
              }
            }}
          >
            <Trans>All</Trans>
          </Link>
          <Link
            to="/mentions?type=private"
            class={type === 'private' ? 'is-active' : ''}
            onClick={(e: Event) => {
              if (columnMode) {
                e.preventDefault();
                setStateType('private');
              }
            }}
          >
            <Trans>Private</Trans>
          </Link>
        </div>
      </>
    );
  }, [type, onlyFollowings]);

  return (
    <Timeline
      title={t`Mentions`}
      id="mentions"
      timelineKey={`mentions-${type}-${onlyFollowings}`}
      emptyText={t`No one mentioned you :(`}
      errorText={t`Unable to load mentions.`}
      instance={instance}
      fetchItems={fetchItems}
      checkForUpdates={checkForUpdates}
      useItemID
      timelineStart={TimelineStart}
      refresh={`${type}-${onlyFollowings}`}
      filterContext="notifications"
    />
  );
}

export default Mentions;

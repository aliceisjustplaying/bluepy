import './mentions.css';

import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useMemo, useRef, useState } from 'react';

import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import { fixNotifications } from '../utils/group-notifications';
import { fetchRelationships } from '../utils/relationships';
import { saveStatus } from '../utils/states';
import { getCurrentAccountID } from '../utils/store-utils';
import useTitle from '../utils/useTitle';

const LIMIT = 20;
interface MentionNotificationLike {
  id?: string;
  type?: string;
  createdAt?: string;
  account?: Partial<mastodon.v1.Account>;
  status?: mastodon.v1.Status | null;
  [key: string]: unknown;
}

type StatusLike = mastodon.v1.Status;

interface SaveStatusPayload extends Record<string, unknown> {
  id?: string;
  account?: Record<string, unknown> & { id?: string };
  repost?: SaveStatusPayload | null;
  quote?: SaveStatusPayload | null;
  state?: unknown;
  quotedStatus?: SaveStatusPayload | null;
}

function toSaveStatus(
  status: StatusLike | null | undefined,
): SaveStatusPayload | null | undefined {
  return status as SaveStatusPayload | null | undefined;
}

interface MastoNotificationsApi {
  list(options: { limit: number; types?: string[]; since_id?: string }): {
    values(): AsyncIterator<MentionNotificationLike[]>;
  };
}

interface FetchItemsResult {
  done?: boolean;
  value: (StatusLike | null | undefined)[] | undefined;
}

function Mentions() {
  const { t } = useLingui();
  const { masto, instance } = api();
  const notificationsApi = getMastoV1Resource<MastoNotificationsApi>(
    masto,
    'notifications',
  );
  useTitle(t`Mentions`, '/mentions');

  const [onlyFollowings, setOnlyFollowings] = useState(false);
  const relationshipsMap = useRef<Record<string, mastodon.v1.Relationship>>({});

  const mentionsIterator = useRef<
    AsyncIterator<MentionNotificationLike[]> | undefined
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
      return relationship?.following ?? false;
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
      value: MentionNotificationLike[] | undefined;
    };
    if (value?.length) {
      const fixedNotifications = fixNotifications(value);

      if (firstLoad) {
        latestItem.current = fixedNotifications[0]?.id;
        console.log('First load', latestItem.current);
      }

      fixedNotifications.forEach(({ status: item }) => {
        saveStatus(toSaveStatus(item), instance);
      });

      let statuses: (mastodon.v1.Status | null | undefined)[] =
        fixedNotifications.map((item) => item.status);
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
      ...results,
      value: value?.map((item) => item.status),
    };
  }

  function fetchItems(firstLoad?: boolean): Promise<FetchItemsResult> {
    return fetchMentions(firstLoad);
  }

  async function checkForUpdates(): Promise<boolean> {
    try {
      const results = await notificationsApi
        .list({
          limit: 1,
          types: ['mention'],
          since_id: latestItem.current,
        })
        .values()
        .next();
      let { value } = results as {
        value: MentionNotificationLike[] | undefined;
      };
      console.log('checkForUpdates ALL', latestItem.current, value);
      if (value?.length) {
        latestItem.current = value[0].id;
        return true;
      }
      return false;
    } catch {
      return false;
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
                setOnlyFollowings(e.currentTarget.checked);
              }}
            />{' '}
            <Trans>Only followings</Trans>
          </label>
        </div>
      </>
    );
  }, [onlyFollowings]);

  return (
    <Timeline
      title={t`Mentions`}
      id="mentions"
      timelineKey={`mentions-${onlyFollowings}`}
      emptyText={t`No one mentioned you :(`}
      errorText={t`Unable to load mentions.`}
      instance={instance}
      fetchItems={fetchItems}
      checkForUpdates={checkForUpdates}
      useItemID
      timelineStart={TimelineStart}
      refresh={`${onlyFollowings}`}
      filterContext="notifications"
    />
  );
}

export default Mentions;

import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';

import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import { filteredItems } from '../utils/filters';
import states, { getStatus, saveStatus } from '../utils/states';
import store from '../utils/store';
import { dedupeBoosts } from '../utils/timeline-utils';
import useTitle from '../utils/useTitle';

type StreamingEntry = {
  event: string;
  payload: unknown;
};

interface StreamingSubscription extends AsyncIterable<StreamingEntry> {
  unsubscribe?: () => void;
}

interface StreamingUser {
  user: {
    subscribe(): StreamingSubscription;
  };
}

interface FollowingProps {
  title?: string;
  path?: string;
  id?: string;
  [key: string]: unknown;
}

interface HomeTimelineParams {
  include_reblogs?: boolean;
  [key: string]: unknown;
}

interface HomeIterable {
  values(): AsyncIterator<mastodon.v1.Status[]>;
  params?: HomeTimelineParams | string;
}

interface HomeTimelineResource {
  list(options: { limit: number }): HomeIterable;
}

interface SaveStatusInput {
  id?: string;
  account?: { id?: string } | null;
  reblog?: SaveStatusInput | null;
  quote?: SaveStatusInput | null;
  state?: unknown;
  quotedStatus?: SaveStatusInput | null;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  _pinned?: unknown;
}

interface SaveStatusPayload extends Record<string, unknown> {
  id?: string;
  account?: Record<string, unknown> & { id?: string };
  reblog?: SaveStatusPayload | null;
  quote?: SaveStatusPayload | null;
  state?: unknown;
  quotedStatus?: SaveStatusPayload | null;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  _pinned?: unknown;
}

function toSaveStatus(
  status: SaveStatusInput | null | undefined,
): SaveStatusPayload | null | undefined {
  return status as SaveStatusPayload | null | undefined;
}

const LIMIT = 20;

function Following({ title, path, id, ...props }: FollowingProps) {
  const { t } = useLingui();
  useTitle(
    title ||
      t({
        id: 'following.title',
        message: 'Following',
      }),
    path || '/following',
  );
  const { masto, streaming, instance, client } = api();
  const [streamingClient, setStreamingClient] = useState<unknown>(streaming);

  const snapStates = useSnapshot(states);
  const homeIterable = useRef<HomeIterable | undefined>(undefined);
  const homeIterator = useRef<AsyncIterator<mastodon.v1.Status[]> | undefined>(
    undefined,
  );
  const latestItem = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (path === '/') return;
    const homeTimeline = { type: 'following' };
    store.account.set('homeTimeline', homeTimeline);
    states.homeTimeline = homeTimeline;
  }, [path]);

  // Streaming only happens after instance is initialized
  useEffect(() => {
    if (!streaming && client?.onStreamingReady) {
      client.onStreamingReady((nextStreaming) => {
        setStreamingClient(nextStreaming);
      });
    }
  }, [client, streaming]);
  __BENCHMARK.end('time-to-following');

  console.debug('RENDER Following', title, id);

  async function fetchHome(
    firstLoad?: boolean,
  ): Promise<IteratorResult<mastodon.v1.Status[]>> {
    if (firstLoad || !homeIterator.current) {
      __BENCHMARK.start('fetch-home-first');
      const homeTimeline = getMastoV1Resource<{ home: HomeTimelineResource }>(
        masto,
        'timelines',
      ).home;
      homeIterable.current = homeTimeline.list({
        limit: LIMIT,
      });
      homeIterator.current = homeIterable.current.values();
    }
    const results = await homeIterator.current.next();
    let { value } = results;
    if (value?.length) {
      if (firstLoad) {
        if (value[0].id !== latestItem.current) {
          latestItem.current = value[0].id;
        }
        console.log('First load', latestItem.current);
      }

      // value = filteredItems(value, 'home');
      value.forEach((item: mastodon.v1.Status) => {
        saveStatus(toSaveStatus(item), instance);
      });
      value = dedupeBoosts(value, instance);

      // ENFORCE sort by datetime (Latest first)
      value.sort((a: mastodon.v1.Status, b: mastodon.v1.Status) => {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    }
    __BENCHMARK.end('fetch-home-first');
    return {
      ...results,
      value,
    };
  }

  async function checkForUpdates(): Promise<boolean> {
    try {
      const opts: {
        limit: number;
        since_id?: string;
      } = {
        limit: 5,
        since_id: latestItem.current,
      };
      const homeTimeline = getMastoV1Resource<{
        home: {
          list(o: typeof opts): {
            values(): AsyncIterator<mastodon.v1.Status[]>;
          };
        };
      }>(masto, 'timelines').home;
      const results = await homeTimeline.list(opts).values().next();
      let { value } = results;
      console.log('checkForUpdates', latestItem.current, value);
      const valueContainsLatestItem = value?.[0]?.id === latestItem.current; // since_id might not be supported
      if (value?.length && !valueContainsLatestItem) {
        latestItem.current = value[0].id;
        value = dedupeBoosts(value, instance);
        value = filteredItems(value, 'home');
        if (value.some((item: mastodon.v1.Status) => !item.reblog)) {
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  useEffect(() => {
    let sub: StreamingSubscription | null = null;
    void (async () => {
      if (streamingClient) {
        sub = (streamingClient as StreamingUser).user.subscribe();
        console.log('🎏 Streaming user', sub);
        for await (const entry of sub) {
          if (!sub) break;
          if (entry.event === 'status.update') {
            const status = entry.payload as SaveStatusInput;
            console.log(`🔄 Status ${status.id} updated`);
            saveStatus(toSaveStatus(status), instance);
          } else if (entry.event === 'delete') {
            const statusID = entry.payload as string;
            console.log(`❌ Status ${statusID} deleted`);
            // delete states.statuses[statusID];
            const s = getStatus(statusID, instance) as
              | { _deleted?: boolean }
              | undefined;
            if (s) s._deleted = true;
          }
        }
        console.log('💥 Streaming user loop STOPPED');
      }
    })();
    return () => {
      sub?.unsubscribe?.();
      sub = null;
    };
  }, [streamingClient, instance]);

  return (
    <Timeline
      title={title || t({ id: 'following.title', message: 'Following' })}
      id={id || 'following'}
      emptyText={t`Nothing to see here.`}
      errorText={t`Unable to load posts.`}
      instance={instance}
      fetchItems={fetchHome}
      checkForUpdates={checkForUpdates}
      useItemID
      boostsCarousel={snapStates.settings.boostsCarousel}
      {...props}
      // allowFilters
      filterContext="home"
      showReplyParent
    />
  );
}

export default Following;

import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useEffect, useReducer } from 'react';

import Timeline2 from '../components/timeline2';
import { api, getMastoV1Resource } from '../utils/api';
import { filteredItems } from '../utils/filters';
import states, { getStatus, saveStatus } from '../utils/states';
import store from '../utils/store';
import supports from '../utils/supports';
import { dedupeBoosts } from '../utils/timeline-utils';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

interface FetchOpts {
  limit: number;
  max_id?: string;
  min_id?: string;
  since_id?: string;
  include_reblogs?: boolean;
}

interface FetchResult {
  done?: boolean;
  value: mastodon.v1.Status[] | undefined;
  originalValue: mastodon.v1.Status[];
}

type HomeTimelineResource = {
  list(opts: FetchOpts): {
    values(): AsyncIterator<mastodon.v1.Status[]>;
  };
};

interface StreamingEntry {
  event: 'status.update' | 'delete' | (string & {});
  payload: unknown;
}

interface StreamingUserSubscription extends AsyncIterable<StreamingEntry> {
  unsubscribe?(): void;
}

interface StreamingUserClient {
  user: {
    subscribe(): StreamingUserSubscription;
  };
}

interface Following2Props {
  title?: string;
  path?: string;
  id?: string;
  [key: string]: unknown;
}

function isStreamingUserClient(value: unknown): value is StreamingUserClient {
  return (
    !!value &&
    typeof value === 'object' &&
    'user' in value &&
    !!value.user &&
    typeof value.user === 'object' &&
    'subscribe' in value.user &&
    typeof value.user.subscribe === 'function'
  );
}

function isStatus(value: unknown): value is mastodon.v1.Status {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string'
  );
}

function isMutableDeletedStatus(
  value: unknown,
): value is Record<string, unknown> & { _deleted?: boolean } {
  return !!value && typeof value === 'object';
}

function Following2({ title, path, id, ...props }: Following2Props) {
  const { t } = useLingui();
  useTitle(
    title ||
      t({
        id: 'following.title',
        message: 'Following',
      }),
    path || '/_following2',
  );
  const { masto, streaming, instance, client } = api();
  const [streamingClient, setStreamingClient] = useReducer(
    (
      _currentClient: StreamingUserClient | undefined,
      nextClient: StreamingUserClient | undefined,
    ) => nextClient,
    isStreamingUserClient(streaming) ? streaming : undefined,
  );

  useEffect(() => {
    if (path === '/') return;
    const homeTimeline = { type: 'following' };
    store.account.set('homeTimeline', homeTimeline);
    states.homeTimeline = homeTimeline;
  }, [path]);

  // Streaming only happens after instance is initialized
  useEffect(() => {
    if (!streaming && client?.onStreamingReady) {
      client.onStreamingReady((newStreamingClient) => {
        if (isStreamingUserClient(newStreamingClient)) {
          setStreamingClient(newStreamingClient);
        }
      });
    }
  }, [client, streaming]);
  __BENCHMARK.end('time-to-following');

  console.debug('RENDER Following2', title, id);
  const supportsPixelfed = supports('@pixelfed/home-include-reblogs');

  async function fetchHome({
    max_id,
    min_id,
  }: { max_id?: string; min_id?: string } = {}): Promise<FetchResult> {
    __BENCHMARK.start('fetch-home');

    const opts: FetchOpts = {
      limit: LIMIT,
    };
    if (max_id) opts.max_id = max_id;
    if (min_id) opts.min_id = min_id;
    if (supportsPixelfed) {
      opts.include_reblogs = true;
    }

    const homeResource = getMastoV1Resource<{ home: HomeTimelineResource }>(
      masto,
      'timelines',
    ).home;
    const results = await homeResource.list(opts).values().next();
    const value = Array.isArray(results.value)
      ? results.value.filter(isStatus)
      : undefined;

    const originalValue = [...(value || [])];
    if (value?.length) {
      // value = filteredItems(value, 'home');
      value.forEach((item) => {
        saveStatus(item, instance);
      });
      // value = dedupeBoosts(value, instance);

      // ENFORCE sort by datetime (Latest first)
      value.sort((a, b) => {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    }

    __BENCHMARK.end('fetch-home');
    return {
      done: results.done,
      value,
      originalValue,
    };
  }

  async function checkForUpdates({
    minID,
  }: {
    minID?: string | null;
  }): Promise<boolean> {
    try {
      const opts: FetchOpts = {
        limit: 5,
        since_id: minID ?? undefined,
      };
      if (supportsPixelfed) {
        opts.include_reblogs = true;
      }
      const homeResource = getMastoV1Resource<{ home: HomeTimelineResource }>(
        masto,
        'timelines',
      ).home;
      const results = await homeResource.list(opts).values().next();
      const value = Array.isArray(results.value)
        ? results.value.filter(isStatus)
        : undefined;
      if (value?.length) {
        const deduped = dedupeBoosts(value, instance);
        const filtered = filteredItems(deduped, 'home');
        return filtered.length > 0;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  useEffect(() => {
    let sub: StreamingUserSubscription | null = null;
    void (async () => {
      if (streamingClient) {
        sub = streamingClient.user.subscribe();
        console.log('🎏 Streaming user (Following2)', sub);
        for await (const entry of sub) {
          if (!sub) break;
          if (entry.event === 'status.update') {
            const { payload: status } = entry;
            if (!isStatus(status)) continue;
            console.log(`🔄 Status ${status.id} updated`);
            saveStatus(status, instance);
          } else if (entry.event === 'delete') {
            if (typeof entry.payload !== 'string') continue;
            const statusID = entry.payload;
            console.log(`❌ Status ${statusID} deleted`);
            const statusValue = getStatus(statusID, instance);
            const s = isMutableDeletedStatus(statusValue)
              ? statusValue
              : undefined;
            if (s) s._deleted = true;
          }
        }
        console.log('💥 Streaming user loop STOPPED (Following2)');
      }
    })();
    return () => {
      sub?.unsubscribe?.();
      sub = null;
    };
  }, [streamingClient, instance]);

  return (
    <Timeline2
      title={title || t({ id: 'following.title', message: 'Following' })}
      id={id || 'following2'}
      emptyText={t`Nothing to see here.`}
      errorText={t`Unable to load posts.`}
      instance={instance}
      fetchItems={fetchHome}
      checkForUpdates={checkForUpdates}
      useItemID
      {...props}
      filterContext="home"
      showReplyParent
    />
  );
}

export default Following2;

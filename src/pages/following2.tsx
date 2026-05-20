import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useEffect, useState } from 'react';

import Timeline2 from '../components/timeline2';
import { api, getMastoV1Resource } from '../utils/api';
import { filteredItems } from '../utils/filters';
import states, { getStatus, saveStatus } from '../utils/states';
import store from '../utils/store';
import supports from '../utils/supports';
import { dedupeReposts } from '../utils/timeline-utils';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

interface FetchOpts {
  limit: number;
  max_id?: string;
  min_id?: string;
  since_id?: string;
  include_reposts?: boolean;
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

interface SaveStatusInput {
  id?: string;
  account?: { id?: string } | null;
  repost?: SaveStatusInput | null;
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
  repost?: SaveStatusPayload | null;
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
  const [streamingClient, setStreamingClient] = useState<
    StreamingUserClient | undefined
  >(streaming as StreamingUserClient | undefined);

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
        setStreamingClient(newStreamingClient as StreamingUserClient);
      });
    }
  }, [client, streaming]);
  __BENCHMARK.end('time-to-following');

  console.debug('RENDER Following2', title, id);
  const supportsIncludeReposts = supports('@atproto/home-include-reposts');

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
    if (supportsIncludeReposts) {
      opts.include_reposts = true;
    }

    const homeResource = getMastoV1Resource<{ home: HomeTimelineResource }>(
      masto,
      'timelines',
    ).home;
    const results = await homeResource.list(opts).values().next();
    let { value } = results as { value: mastodon.v1.Status[] | undefined };

    const originalValue = [...(value || [])];
    if (value?.length) {
      // value = filteredItems(value, 'home');
      value.forEach((item) => {
        saveStatus(toSaveStatus(item), instance);
      });
      // value = dedupeReposts(value, instance);

      // ENFORCE sort by datetime (Latest first)
      value.sort((a, b) => {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    }

    __BENCHMARK.end('fetch-home');
    return {
      ...(results as { done?: boolean }),
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
      if (supportsIncludeReposts) {
        opts.include_reposts = true;
      }
      const homeResource = getMastoV1Resource<{ home: HomeTimelineResource }>(
        masto,
        'timelines',
      ).home;
      const results = await homeResource.list(opts).values().next();
      const { value } = results as {
        value: mastodon.v1.Status[] | undefined;
      };
      if (value?.length) {
        const deduped = dedupeReposts(value, instance);
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
            const status = entry.payload as mastodon.v1.Status;
            console.log(`🔄 Status ${status.id} updated`);
            saveStatus(toSaveStatus(status), instance);
          } else if (entry.event === 'delete') {
            const statusID = entry.payload as string;
            console.log(`❌ Status ${statusID} deleted`);
            const s = getStatus(statusID, instance) as
              | (Record<string, unknown> & { _deleted?: boolean })
              | undefined;
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
      dedupeReposts
      {...props}
      filterContext="home"
      showReplyParent
    />
  );
}

export default Following2;

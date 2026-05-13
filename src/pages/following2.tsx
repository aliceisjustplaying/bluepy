import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import Timeline2Untyped from '../components/timeline2';
import { api } from '../utils/api';
import { filteredItems } from '../utils/filters';
import states, { getStatus, saveStatus } from '../utils/states';
import store from '../utils/store';
import supports from '../utils/supports';
import { assignFollowedTags, dedupeBoosts } from '../utils/timeline-utils';
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

interface Timeline2Props {
  title?: string;
  id?: string;
  emptyText?: string;
  errorText?: string;
  instance?: string;
  fetchItems?: (params?: {
    max_id?: string;
    min_id?: string;
  }) => Promise<unknown>;
  checkForUpdates?: (params: { minID?: string }) => Promise<boolean>;
  useItemID?: boolean;
  filterContext?: string;
  showFollowedTags?: boolean;
  showReplyParent?: boolean;
  path?: string;
}

const Timeline2 = Timeline2Untyped as unknown as ComponentType<Timeline2Props>;

interface StreamingEntry {
  event: 'status.update' | 'delete' | string;
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
  }, [client]);
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

    const homeResource = (
      masto.v1 as unknown as { timelines: { home: HomeTimelineResource } }
    ).timelines.home;
    const results = await homeResource.list(opts).values().next();
    let { value } = results as { value: mastodon.v1.Status[] | undefined };

    const originalValue = [...(value || [])];
    if (value?.length) {
      // value = filteredItems(value, 'home');
      value.forEach((item) => {
        saveStatus(item as unknown as Parameters<typeof saveStatus>[0], instance);
      });
      // value = dedupeBoosts(value, instance);
      setTimeout(() => {
        assignFollowedTags(value, instance);
      }, 100);

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
    minID?: string;
  }): Promise<boolean> {
    try {
      const opts: FetchOpts = {
        limit: 5,
        since_id: minID,
      };
      if (supportsPixelfed) {
        opts.include_reblogs = true;
      }
      const homeResource = (
        masto.v1 as unknown as { timelines: { home: HomeTimelineResource } }
      ).timelines.home;
      const results = await homeResource.list(opts).values().next();
      const { value } = results as {
        value: mastodon.v1.Status[] | undefined;
      };
      if (value?.length) {
        const deduped = dedupeBoosts(value, instance) as mastodon.v1.Status[];
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
            saveStatus(
              status as unknown as Parameters<typeof saveStatus>[0],
              instance,
            );
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
  }, [streamingClient]);

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
      showFollowedTags
      showReplyParent
    />
  );
}

export default Following2;

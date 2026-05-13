import { api } from './api';
import store from './store';

type AccessLevel = string;

type TimelinesAccess = Record<string, Record<string, AccessLevel | undefined>>;

interface InstanceInfoLike {
  readonly configuration?: {
    readonly timelinesAccess?: TimelinesAccess;
  };
}

interface InstanceV2Resource {
  readonly fetch: () => Promise<InstanceInfoLike | null | undefined>;
}

interface MastoLike {
  readonly v2: {
    readonly instance: InstanceV2Resource;
  };
}

interface FeedSpec {
  readonly feed: string;
  readonly feedType: string;
}

interface CheckTimelineAccessOptions {
  readonly feed?: string;
  readonly feedType?: string;
  readonly feeds?: readonly FeedSpec[];
  readonly instance?: string;
}

// Mock data to test timeline access controls
const MOCK_INSTANCES: Record<string, AccessLevel> = {
  'disabled.example.com': 'disabled',
  'authenticated.example.com': 'authenticated',
};

async function getInstanceInfo(
  masto: MastoLike,
  instance: string | undefined,
): Promise<InstanceInfoLike | undefined> {
  const instances =
    store.local.getJSON<Record<string, InstanceInfoLike>>('instances') || {};
  let instanceInfo: InstanceInfoLike | undefined =
    instances[instance?.toLowerCase() ?? ''];

  const timelinesAccess = instanceInfo?.configuration?.timelinesAccess;
  if (!timelinesAccess) {
    const freshInfo = await masto.v2.instance.fetch().catch(() => null);
    if (freshInfo) {
      instanceInfo = freshInfo;
      instances[instance?.toLowerCase() ?? ''] = freshInfo;
      store.local.setJSON('instances', instances);
    }
  }

  return instanceInfo;
}

// Check timeline access
// - feed: liveFeeds, hashtagFeeds, trendingLinkFeeds
// - feedType: local, remote
// - feeds: array of {feed, feedType} for batch checking
// - instance: optional, defaults to current instance from api()
export async function checkTimelineAccess({
  feed,
  feedType,
  feeds,
  instance,
}: CheckTimelineAccessOptions): Promise<
  AccessLevel | Record<string, AccessLevel>
> {
  const { masto, instance: currentInstance } = api({ instance });
  const instanceName = instance || currentInstance;
  const mastoTyped = masto as unknown as MastoLike;

  try {
    const mockInstance = MOCK_INSTANCES[instanceName?.toLowerCase() ?? ''];

    // Batch check
    if (feeds) {
      if (mockInstance) {
        const result: Record<string, AccessLevel> = {};
        feeds.forEach(({ feed: f, feedType: ft }) => {
          result[`${f}_${ft}`] = mockInstance;
        });
        return result;
      }

      const instanceInfo = await getInstanceInfo(mastoTyped, instanceName);
      const result: Record<string, AccessLevel> = {};
      feeds.forEach(({ feed: f, feedType: ft }) => {
        result[`${f}_${ft}`] =
          instanceInfo?.configuration?.timelinesAccess?.[f]?.[ft] || 'public';
      });
      return result;
    }

    // Single check
    if (mockInstance) return mockInstance;

    const instanceInfo = await getInstanceInfo(mastoTyped, instanceName);
    const timelinesAccess = instanceInfo?.configuration?.timelinesAccess;
    const accessLevel = timelinesAccess?.[feed as string]?.[feedType as string];
    return accessLevel || 'public';
  } catch (e) {
    return feeds ? {} : 'public';
  }
}

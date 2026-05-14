import PQueue from 'p-queue';
import { snapshot } from 'valtio/vanilla';

import { api, getMastoV2Resource } from './api';
import getDomain from './get-domain';
// TODO(oxlint:import/no-cycle): states <-> unfurl-link cycle is structural;
// breaking it requires extracting unfurled-link types into a separate module
// shared by states.ts. Out of scope for the oxlint cleanup batch.
import states, { saveStatus } from './states';

export const unfurlQueue = new PQueue({
  concurrency: 1,
  interval: 1000,
  intervalCap: 1,
});

const STATUS_ID_REGEXES = [
  /\/@[^@/]+@?[^/]+?\/(\d+)$/i, // Mastodon
  /\/notice\/(\w+)$/i, // Pleroma
];
function getStatusID(path: string): string | null {
  for (let i = 0; i < STATUS_ID_REGEXES.length; i++) {
    const statusMatchID = path.match(STATUS_ID_REGEXES[i])?.[1];
    if (statusMatchID) {
      return statusMatchID;
    }
  }
  return null;
}

// Minimal unfurled-link shape used here. The valtio proxy stores `unknown`
// values, so we narrow on read with this local type.
interface UnfurledLinkSnapshot {
  url?: string;
  [key: string]: unknown;
}

function asUnfurledLinkSnapshot(
  value: unknown,
): UnfurledLinkSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { url?: unknown };
  if (candidate.url !== undefined && typeof candidate.url !== 'string') {
    return undefined;
  }
  return value as UnfurledLinkSnapshot;
}

// Minimal status shape from masto responses for the codepaths we touch.
interface UnfurlStatus {
  id: string;
  content?: string;
  [key: string]: unknown;
}

interface UnfurlResult {
  status: UnfurlStatus;
  instance: string;
}

interface UnfurledLinkData extends UnfurledLinkSnapshot {
  id: string;
  instance: string;
  url: string;
  originalURL: string;
  originalDomain: string;
  canonicalURL: string | undefined;
  canonicalDomain: string | undefined;
}

// Minimal masto endpoints we touch. The masto client carries open index
// signatures, so nested members read as `unknown` and need local narrowing.
interface StatusesV1Endpoint {
  $select(id: string): { fetch(): Promise<UnfurlStatus | null | undefined> };
}
interface SearchV2Endpoint {
  fetch(options: {
    q: string;
    type: 'statuses';
    resolve: boolean;
    limit: number;
  }): Promise<{ statuses?: UnfurlStatus[] } | null | undefined>;
}

const denylistDomains = /(twitter|github)\.com/i;
const failedUnfurls: Record<string, boolean> = {};
function unfurlMastodonLinkImpl(
  instance: string,
  url: string,
): Promise<UnfurledLinkSnapshot | undefined> | undefined {
  const snapStates = snapshot(states);
  if (denylistDomains.test(url)) {
    return undefined;
  }
  if (failedUnfurls[url]) {
    return undefined;
  }
  const instanceRegex = new RegExp(instance + '/');
  // Snapshot values are `unknown` in states.ts; narrow the single entry we
  // read through a small guard rather than asserting the whole record shape.
  const cached = asUnfurledLinkSnapshot(snapStates.unfurledLinks[url]);
  if (instanceRegex.test(cached?.url ?? '')) {
    return Promise.resolve(cached);
  }
  console.debug('🦦 Unfurling URL', url);

  let remoteInstanceFetch: Promise<UnfurlResult> | undefined;
  let theURL = url;

  // https://elk.zone/domain.com/@stest/123 -> https://domain.com/@stest/123
  if (/\/\/elk\.[^/]+\/[^/]+\.[^/]+/i.test(theURL)) {
    theURL = theURL.replace(/elk\.[^/]+\//i, '');
  }

  // https://trunks.social/status/domain.com/@stest/123 -> https://domain.com/@stest/123
  if (/\/\/trunks\.[^/]+\/status\/[^/]+\.[^/]+/i.test(theURL)) {
    theURL = theURL.replace(/trunks\.[^/]+\/status\//i, '');
  }

  // https://phanpy.social/#/domain.com/s/123 -> https://domain.com/statuses/123
  if (/\/#\/[^/]+\.[^/]+\/s\/.+/i.test(theURL)) {
    const urlAfterHash = theURL.split('/#/')[1];
    const finalURL = urlAfterHash.replace(/\/s\//i, '/@fakeUsername/');
    theURL = `https://${finalURL}`;
  }

  const urlObj = URL.parse(theURL);
  if (!urlObj) return undefined;
  const domain = urlObj.hostname;
  const path = urlObj.pathname;
  if (!domain) return undefined; // No domain, something is wrong
  // Regex /:username/:id, where username = @username or @username@domain, id = post ID
  let statusMatchID = getStatusID(path);

  if (statusMatchID) {
    const id = statusMatchID;
    const { masto } = api({ instance: domain });
    const statusesEndpoint = masto.v1.statuses as StatusesV1Endpoint;
    remoteInstanceFetch = statusesEndpoint
      .$select(id)
      .fetch()
      .then((status) => {
        if (status?.id) {
          return {
            status,
            instance: domain,
          };
        } else {
          throw new Error('No results');
        }
      });
  }

  const { masto } = api({ instance });
  const searchEndpoint = getMastoV2Resource<SearchV2Endpoint>(
    masto,
    'search',
  );
  const mastoSearchFetch: Promise<UnfurlResult> = searchEndpoint
    .fetch({
      q: theURL,
      type: 'statuses',
      resolve: true,
      limit: 1,
    })
    .then((results) => {
      const statuses = results?.statuses;
      if (statuses && statuses.length > 0) {
        // Filter out statuses that has content that contains the URL, in-case-sensitive
        const theStatuses = statuses.filter(
          (status) =>
            !status.content?.toLowerCase().includes(theURL.toLowerCase()),
        );

        if (theStatuses.length === 1) {
          return {
            status: theStatuses[0],
            instance,
          };
        }
        // If there are multiple statuses, give up, something is wrong
      }
      throw new Error('No results');
    });

  function handleFulfill(result: UnfurlResult): UnfurledLinkData {
    const { status, instance: resultInstance } = result;
    const { id } = status;
    const selfURL = `/${resultInstance}/s/${id}`;
    console.debug('🦦 Unfurled URL', url, id, selfURL);
    const hasCanonical = theURL !== url;
    const data: UnfurledLinkData = {
      id,
      instance: resultInstance,
      url: selfURL,
      originalURL: url,
      originalDomain: getDomain(url),
      canonicalURL: hasCanonical ? theURL : undefined,
      canonicalDomain: hasCanonical ? getDomain(theURL) : undefined,
    };
    states.unfurledLinks[url] = data;
    saveStatus(status, resultInstance, {
      skipThreading: true,
    });
    return data;
  }
  function handleCatch(_e: unknown): undefined {
    failedUnfurls[url] = true;
    return undefined;
  }

  if (remoteInstanceFetch) {
    // return Promise.any([remoteInstanceFetch, mastoSearchFetch])
    //   .then(handleFulfill)
    //   .catch(handleCatch);
    // If mastoSearchFetch is fulfilled within 3s, return it, else return remoteInstanceFetch
    const fetchTimeout = remoteInstanceFetch;
    const finalPromise: Promise<UnfurlResult> = Promise.race([
      mastoSearchFetch,
      new Promise<UnfurlResult>((_resolve, reject) => {
        setTimeout(reject, 3000);
      }),
    ]).catch(() => {
      // If remoteInstanceFetch is fullfilled, return it, else return mastoSearchFetch
      return fetchTimeout.catch(() => mastoSearchFetch);
    });
    return finalPromise.then(handleFulfill).catch(handleCatch);
  } else {
    return mastoSearchFetch.then(handleFulfill).catch(handleCatch);
  }
}

const unfurlMastodonLink = (
  instance: string,
  url: string,
  signal?: AbortSignal,
): Promise<UnfurledLinkSnapshot | undefined> =>
  // PQueue's Task accepts `T | PromiseLike<T>`; `unfurlMastodonLinkImpl` can
  // return `Promise<T> | undefined`, which only fits after async wrapping.
  // Observationally identical: PQueue resolves the returned promise either
  // way (it internally awaits a Promise.resolve(taskResult)).
  unfurlQueue.add(async () => unfurlMastodonLinkImpl(instance, url), {
    signal,
  });
export default unfurlMastodonLink;

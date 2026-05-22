import type { mastodon } from 'masto';

import { api } from './api';
import { isFiltered } from './filters';
import {
  getMutedPostVisibility,
  shouldHideMutedStatus,
} from './muted-post-visibility';
import pmem from './pmem';
import { shouldFetchReplyContextForInstance } from './reply-context';
import states, { saveStatus, statusKey } from './states';
import store from './store';
import { getCurrentAccountID } from './store-utils';
import {
  canonicalTimelineContextId,
  groupContextItems,
} from './timeline-context';

// Status payloads carry a handful of mutation flags the timeline pipeline
// attaches (`_pinned`, `_differentAuthor`). Keep the type loose so callers
// passing already-extended objects from `states.statuses` still fit.
type TimelineStatus = mastodon.v1.Status & {
  _pinned?: unknown;
  _differentAuthor?: boolean;
  account?: mastodon.v1.Status['account'] & { group?: boolean };
  _atproto?: {
    root?: { uri?: string };
  };
};

interface BoostsGroup {
  id: string[];
  items: TimelineStatus[];
  type: 'boosts';
}

interface ThreadGroup {
  id: string[];
  items: TimelineStatus[];
  type: 'thread' | 'conversation';
  incompleteThread?: boolean;
}

type TimelineItem = TimelineStatus | BoostsGroup | ThreadGroup;

interface BoostedStatusIDsMap {
  [statusKey: string]: string;
}

interface ReplyHint {
  sKey: string;
  inReplyToId: string;
}

interface MastoStatusesList {
  list(params: { id: readonly string[] }): Promise<mastodon.v1.Status[]>;
  $select(id: string): { fetch(): Promise<mastodon.v1.Status> };
}

export function groupBoosts(
  values: readonly TimelineStatus[],
): TimelineItem[] | readonly TimelineStatus[] {
  let newValues: TimelineItem[] = [];
  const boostStash: TimelineStatus[] = [];
  let serialBoosts = 0;
  for (let i = 0; i < values.length; i++) {
    const item = values[i];
    if (item.reblog && !item.account?.group) {
      boostStash.push(item);
      serialBoosts++;
    } else {
      newValues.push(item);
      if (serialBoosts < 3) {
        serialBoosts = 0;
      }
    }
  }
  // if boostStash is more than quarter of values
  // or if there are 3 or more boosts in a row
  if (
    values.length > 10 &&
    (boostStash.length > values.length / 4 || serialBoosts >= 3)
  ) {
    // if boostStash is more than 3 quarter of values
    const boostStashID = boostStash.map((status) => status.id);
    if (boostStash.length > (values.length * 3) / 4) {
      // insert boost array at the end of specialHome list
      newValues = [
        ...newValues,
        { id: boostStashID, items: boostStash, type: 'boosts' },
      ];
    } else {
      // insert boosts array in the middle of specialHome list
      const half = Math.floor(newValues.length / 2);
      newValues = [
        ...newValues.slice(0, half),
        {
          id: boostStashID,
          items: boostStash,
          type: 'boosts',
        },
        ...newValues.slice(half),
      ];
    }
    return newValues;
  } else {
    return values;
  }
}

const BOOSTS_LIMIT = 100;
export function dedupeBoosts<T extends TimelineStatus>(
  items: readonly T[],
  instance: string | undefined,
): T[] {
  const boostedStatusIDs =
    store.account.get<BoostedStatusIDsMap>('boostedStatusIDs') || {};
  const filteredItems = items.filter((item) => {
    if (!item.reblog) return true;
    const boostStatusKey = `${instance}-${item.reblog.id}`;
    const boosterID = boostedStatusIDs[boostStatusKey];
    if (boosterID && boosterID !== item.id) {
      console.warn(
        `🚫 Duplicate boost by ${item.account.displayName}`,
        item,
        item.reblog,
      );
      return false;
    } else {
      boostedStatusIDs[boostStatusKey] = item.id;
    }
    return true;
  });
  // Limit to BOOSTS_LIMIT
  const keys = Object.keys(boostedStatusIDs);
  if (keys.length > BOOSTS_LIMIT) {
    keys.slice(0, keys.length - BOOSTS_LIMIT).forEach((key) => {
      delete boostedStatusIDs[key];
    });
  }
  store.account.set('boostedStatusIDs', boostedStatusIDs);
  return filteredItems;
}

export function filterHiddenStatuses<T extends TimelineStatus>(
  items: readonly T[],
  filterContext: string | null | undefined,
): readonly T[] {
  const currentAccount = getCurrentAccountID();
  const mutedPostVisibility = getMutedPostVisibility(states.settings);
  return items.filter((item) => {
    // Muted-account visibility is a timeline preference, not a Mastodon filter
    // context. Keep applying it when content filters are disabled.
    if (
      shouldHideMutedStatus({
        status: item,
        currentAccountID: currentAccount,
        visibility: mutedPostVisibility,
      })
    ) {
      return false;
    }
    if (!filterContext) return true;
    if (!item?.filtered) return true;
    const isOwnPost = item?.account?.id === currentAccount;
    const filterInfo = isFiltered(item.filtered, filterContext);
    if (!isOwnPost && filterInfo && filterInfo.action === 'hide') {
      return false;
    }
    return true;
  });
}

export function groupContext(
  items: readonly TimelineStatus[],
  instance: string | undefined,
): TimelineItem[] {
  const contexts = groupContextItems(items);

  if (contexts.length) console.log('🧵 Contexts', contexts);

  const newItems: TimelineItem[] = [];
  const appliedContextIndices: number[] = [];
  const inReplyToIds: ReplyHint[] = [];
  items.forEach((item) => {
    for (let ctxIndex = 0; ctxIndex < contexts.length; ctxIndex++) {
      if (
        contexts[ctxIndex].items.find(
          (t) =>
            canonicalTimelineContextId(t) === canonicalTimelineContextId(item),
        )
      ) {
        if (appliedContextIndices.includes(ctxIndex)) return;
        const contextItems = contexts[ctxIndex].items;
        newItems.push({
          id: contextItems.map((ci) => ci.id),
          items: contextItems,
          type: contexts[ctxIndex].type,
          incompleteThread: contexts[ctxIndex].incompleteThread,
        });
        appliedContextIndices.push(ctxIndex);
        return;
      }
    }
    if (item.reblog) {
      newItems.push(item);
      return;
    }

    // PREPARE FOR REPLY HINTS
    if (
      shouldFetchReplyContextForInstance(instance) &&
      item.inReplyToId &&
      item.inReplyToAccountId !== item.account.id
    ) {
      const sKey = statusKey(item.id, instance);
      if (sKey && !states.statusReply[sKey]) {
        // If it's a reply and not a thread
        inReplyToIds.push({
          sKey,
          inReplyToId: item.inReplyToId,
        });
        // queueMicrotask(async () => {
        //   try {
        //     const { masto } = api({ instance });
        //     // const replyToStatus = await masto.v1.statuses
        //     //   .$select(item.inReplyToId)
        //     //   .fetch();
        //     const replyToStatus = await fetchStatus(item.inReplyToId, masto);
        //     saveStatus(replyToStatus, instance, {
        //       skipThreading: true,
        //       skipUnfurling: true,
        //     });
        //     states.statusReply[sKey] = {
        //       id: replyToStatus.id,
        //       instance,
        //     };
        //   } catch (e) {
        //     // Silently fail
        //     console.error(e);
        //   }
        // });
      }
    }

    newItems.push(item);
  });

  // FETCH AND SHOW REPLY HINTS
  if (inReplyToIds?.length) {
    setTimeout(() => {
      const { masto } = api({ instance });
      console.log('REPLYHINT', inReplyToIds);

      const statusesResource = masto.v1.statuses as MastoStatusesList;

      // Fallback if batch fetch fails or returns nothing or not supported
      async function fallbackFetch(): Promise<void> {
        for (let i = 0; i < inReplyToIds.length; i++) {
          const { sKey, inReplyToId } = inReplyToIds[i];
          try {
            const replyToStatus = await fetchStatus(
              inReplyToId,
              statusesResource,
            );
            saveStatus(replyToStatus, instance, {
              skipThreading: true,
            });
            states.statusReply[sKey] = {
              id: replyToStatus.id,
              instance,
            };
            // Pause 1s
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 1000);
            });
          } catch (e) {
            // Silently fail
            console.error(e);
          }
        }
      }

      // This is batch fetching yooo, woot
      // Limit 20, returns 422 if exceeded https://github.com/mastodon/mastodon/pull/27871
      const ids = inReplyToIds.map(({ inReplyToId }) => inReplyToId);
      void (async () => {
        try {
          const replyToStatuses = await statusesResource.list({ id: ids });
          if (replyToStatuses?.length) {
            for (const replyToStatus of replyToStatuses) {
              saveStatus(replyToStatus, instance, {
                skipThreading: true,
              });
              // Several visible posts can reply to the same parent, so set the
              // reply hint for every matching sKey, not just the first.
              const matchingHints = inReplyToIds.filter(
                ({ inReplyToId }) => inReplyToId === replyToStatus.id,
              );
              for (const { sKey } of matchingHints) {
                states.statusReply[sKey] = {
                  id: replyToStatus.id,
                  instance,
                };
              }
            }
          } else {
            void fallbackFetch();
          }
        } catch (e) {
          // Silently fail
          console.error(e);
          void fallbackFetch();
        }
      })();
    }, 10);
  }

  return newItems;
}

const fetchStatus = pmem(
  (statusID: string, masto: MastoStatusesList): Promise<mastodon.v1.Status> => {
    return masto.$select(statusID).fetch();
  },
);

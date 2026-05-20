import type { mastodon } from 'masto';

import { api } from './api';
import { isFiltered } from './filters';
import pmem from './pmem';
import { shouldFetchReplyContextForInstance } from './reply-context';
import states, { saveStatus, statusKey } from './states';
import store from './store';
import { getCurrentAccountID } from './store-utils';
import supports from './supports';
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
  repost?: TimelineStatus | null;
  _atproto?: {
    root?: { uri?: string };
  };
};

interface RepostsGroup {
  id: string[];
  items: TimelineStatus[];
  type: 'reposts';
}

interface ThreadGroup {
  id: string[];
  items: TimelineStatus[];
  type: 'thread' | 'conversation';
  incompleteThread?: boolean;
}

type TimelineItem = TimelineStatus | RepostsGroup | ThreadGroup;

interface RepostedStatusIDsMap {
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

export function groupReposts(
  values: readonly TimelineStatus[],
): TimelineItem[] | readonly TimelineStatus[] {
  let newValues: TimelineItem[] = [];
  const repostStash: TimelineStatus[] = [];
  let serialReposts = 0;
  for (let i = 0; i < values.length; i++) {
    const item = values[i];
    if (item.repost && !item.account?.group) {
      repostStash.push(item);
      serialReposts++;
    } else {
      newValues.push(item);
      if (serialReposts < 3) {
        serialReposts = 0;
      }
    }
  }
  if (
    values.length > 10 &&
    (repostStash.length > values.length / 4 || serialReposts >= 3)
  ) {
    const repostStashID = repostStash.map((status) => status.id);
    if (repostStash.length > (values.length * 3) / 4) {
      newValues = [
        ...newValues,
        { id: repostStashID, items: repostStash, type: 'reposts' },
      ];
    } else {
      const half = Math.floor(newValues.length / 2);
      newValues = [
        ...newValues.slice(0, half),
        {
          id: repostStashID,
          items: repostStash,
          type: 'reposts',
        },
        ...newValues.slice(half),
      ];
    }
    return newValues;
  } else {
    return values;
  }
}

const REPOSTS_LIMIT = 100;
export function dedupeReposts<T extends TimelineStatus>(
  items: readonly T[],
  instance: string | undefined,
): T[] {
  const repostedStatusIDs =
    store.account.get<RepostedStatusIDsMap>('repostedStatusIDs') || {};
  const filteredItems = items.filter((item) => {
    if (!item.repost) return true;
    const repostStatusKey = `${instance}-${item.repost.id}`;
    const repostWrapperID = repostedStatusIDs[repostStatusKey];
    if (repostWrapperID && repostWrapperID !== item.id) {
      console.warn(
        `Duplicate repost by ${item.account.displayName}`,
        item,
        item.repost,
      );
      return false;
    } else {
      repostedStatusIDs[repostStatusKey] = item.id;
    }
    return true;
  });
  const keys = Object.keys(repostedStatusIDs);
  if (keys.length > REPOSTS_LIMIT) {
    keys.slice(0, keys.length - REPOSTS_LIMIT).forEach((key) => {
      delete repostedStatusIDs[key];
    });
  }
  store.account.set('repostedStatusIDs', repostedStatusIDs);
  return filteredItems;
}

export function filterHiddenStatuses<T extends TimelineStatus>(
  items: readonly T[],
  filterContext: string | null | undefined,
): readonly T[] {
  if (!filterContext) return items;
  const currentAccount = getCurrentAccountID();
  return items.filter((item) => {
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
    if (item.repost) {
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

      if (supports('@atproto/fetch-multiple-posts')) {
        // This is batch fetching yooo, woot
        const ids = inReplyToIds.map(({ inReplyToId }) => inReplyToId);
        void (async () => {
          try {
            const replyToStatuses = await statusesResource.list({ id: ids });
            if (replyToStatuses?.length) {
              for (const replyToStatus of replyToStatuses) {
                saveStatus(replyToStatus, instance, {
                  skipThreading: true,
                });
                const sKey = inReplyToIds.find(
                  ({ inReplyToId }) => inReplyToId === replyToStatus.id,
                )?.sKey;
                if (sKey) {
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
      } else {
        void fallbackFetch();
      }
    }, 10);
  }

  return newItems;
}

const fetchStatus = pmem(
  (statusID: string, masto: MastoStatusesList): Promise<mastodon.v1.Status> => {
    return masto.$select(statusID).fetch();
  },
);

import type { mastodon } from 'masto';

import { api } from './api';
import { isFiltered } from './filters';
import { extractTagsFromStatus, getFollowedTags } from './followed-tags';
import pmem from './pmem';
import { fetchRelationships } from './relationships';
import { shouldFetchReplyContextForInstance } from './reply-context';
import states, { saveStatus, statusKey } from './states';
import store from './store';
import { getCurrentAccountID } from './store-utils';
import supports from './supports';

// Status payloads carry a handful of mutation flags the timeline pipeline
// attaches (`_pinned`, `_differentAuthor`). Keep the type loose so callers
// passing already-extended objects from `states.statuses` still fit.
type TimelineStatus = mastodon.v1.Status & {
  _pinned?: unknown;
  _differentAuthor?: boolean;
  account?: mastodon.v1.Status['account'] & { group?: boolean };
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

// `saveStatus` accepts the loose record-shaped `Status` declared inside
// `states.ts`. Masto's `mastodon.v1.Status` lacks an index signature, so a
// cast bridges the two shapes without introducing `any`.
type SaveStatusInput = Parameters<typeof saveStatus>[0];

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
  instance: string,
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
  instance: string,
): TimelineItem[] {
  const contexts: TimelineStatus[][] = [];
  let contextIndex = 0;
  items.forEach((item) => {
    for (let i = 0; i < contexts.length; i++) {
      if (contexts[i].find((t) => t.id === item.id)) return;
      if (
        contexts[i].find((t) => t.id === item.inReplyToId) ||
        contexts[i].find((t) => t.inReplyToId === item.id)
      ) {
        contexts[i].push(item);
        return;
      }
    }
    const repliedItem = items.find((i) => i.id === item.inReplyToId);
    if (repliedItem) {
      contexts[contextIndex++] = [item, repliedItem];
    }
  });

  // Check for cross-item contexts
  // Merge contexts into one if they have a common item (same id)
  for (let i = 0; i < contexts.length; i++) {
    for (let j = i + 1; j < contexts.length; j++) {
      const commonItem = contexts[i].find((t) => contexts[j].includes(t));
      if (commonItem) {
        contexts[i] = [...contexts[i], ...contexts[j]];
        // Remove duplicate items
        contexts[i] = contexts[i].filter(
          (item, index, self) =>
            self.findIndex((t) => t.id === item.id) === index,
        );
        contexts.splice(j, 1);
        j--;
      }
    }
  }

  // Sort items by checking inReplyToId
  contexts.forEach((context) => {
    context.sort((a, b) => {
      if (!a.inReplyToId && !b.inReplyToId) {
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      }
      if (a.inReplyToId === b.id) return 1;
      if (b.inReplyToId === a.id) return -1;
      if (!a.inReplyToId) return -1;
      if (!b.inReplyToId) return 1;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
  });

  // Tag items that has different author than first post's author
  contexts.forEach((context) => {
    const firstItemAccountID = context[0].account.id;
    context.forEach((item) => {
      if (item.account.id !== firstItemAccountID) {
        item._differentAuthor = true;
      }
    });
  });

  if (contexts.length) console.log('🧵 Contexts', contexts);

  const newItems: TimelineItem[] = [];
  const appliedContextIndices: number[] = [];
  const inReplyToIds: ReplyHint[] = [];
  items.forEach((item) => {
    if (item.reblog) {
      newItems.push(item);
      return;
    }
    for (let ctxIndex = 0; ctxIndex < contexts.length; ctxIndex++) {
      if (contexts[ctxIndex].find((t) => t.id === item.id)) {
        if (appliedContextIndices.includes(ctxIndex)) return;
        const contextItems = contexts[ctxIndex];
        contextItems.sort((a, b) => {
          return Date.parse(a.createdAt) - Date.parse(b.createdAt);
        });
        const firstItemAccountID = contextItems[0].account.id;
        newItems.push({
          id: contextItems.map((ci) => ci.id),
          items: contextItems,
          type: contextItems.every((it) => it.account.id === firstItemAccountID)
            ? 'thread'
            : 'conversation',
        });
        appliedContextIndices.push(ctxIndex);
        return;
      }
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
            saveStatus(replyToStatus as unknown as SaveStatusInput, instance, {
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

      if (supports('@mastodon/fetch-multiple-statuses')) {
        // This is batch fetching yooo, woot
        // Limit 20, returns 422 if exceeded https://github.com/mastodon/mastodon/pull/27871
        const ids = inReplyToIds.map(({ inReplyToId }) => inReplyToId);
        void (async () => {
          try {
            const replyToStatuses = await statusesResource.list({ id: ids });
            if (replyToStatuses?.length) {
              for (const replyToStatus of replyToStatuses) {
                saveStatus(
                  replyToStatus as unknown as SaveStatusInput,
                  instance,
                  {
                    skipThreading: true,
                  },
                );
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

interface FollowedTagsCandidate {
  item: TimelineStatus;
  sKey: string;
  followedTags: string[];
}

export async function assignFollowedTags(
  items: readonly TimelineStatus[],
  instance: string,
): Promise<void> {
  const allFollowedTags = await getFollowedTags(); // [{name: 'tag'}, {...}]
  if (!allFollowedTags.length) return;
  const { statusFollowedTags } = states;
  console.log('statusFollowedTags', statusFollowedTags);
  const statusWithFollowedTags: FollowedTagsCandidate[] = [];
  items.forEach((item) => {
    if (item.reblog) return;
    const { id, content } = item;
    const tags = item.tags ?? [];
    const sKey = statusKey(id, instance);
    if (!sKey) return;
    const existing = statusFollowedTags[sKey];
    if (Array.isArray(existing) && existing.length) return;
    const extractedTags = extractTagsFromStatus(content);
    if (!extractedTags.length && !tags.length) return;
    const itemFollowedTags = allFollowedTags.reduce<string[]>((acc, tag) => {
      if (
        extractedTags.some((t) => t.toLowerCase() === tag.name.toLowerCase()) ||
        tags.some((t) => t.name.toLowerCase() === tag.name.toLowerCase())
      ) {
        acc.push(tag.name);
      }
      return acc;
    }, []);
    if (itemFollowedTags.length) {
      // statusFollowedTags[sKey] = itemFollowedTags;
      statusWithFollowedTags.push({
        item,
        sKey,
        followedTags: itemFollowedTags,
      });
    }
  });

  if (statusWithFollowedTags.length) {
    const accounts = statusWithFollowedTags.map((s) => s.item.account);
    const relationships = await fetchRelationships(accounts);
    if (!relationships) return;

    statusWithFollowedTags.forEach((s) => {
      const { item, sKey, followedTags: itemTags } = s;
      const r = relationships[item.account.id];
      if (r && !r.following) {
        statusFollowedTags[sKey] = itemTags;
      }
    });
  }
}

export function clearFollowedTagsState(): void {
  states.statusFollowedTags = {};
}

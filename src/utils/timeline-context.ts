import { encodeAtprotoID } from './atproto-route';

interface TimelineContextAccount {
  id: string;
}

interface TimelineContextRef {
  uri?: string;
}

export interface TimelineContextStatus {
  id: string;
  createdAt: string;
  inReplyToId?: string | null;
  account: TimelineContextAccount;
  repost?: TimelineContextStatus | null;
  _pinned?: unknown;
  _differentAuthor?: boolean;
  _atproto?: {
    root?: TimelineContextRef;
  };
}

export interface TimelineContextGroup<T extends TimelineContextStatus> {
  id: string[];
  items: T[];
  type: 'thread' | 'conversation';
  incompleteThread?: boolean;
}

interface TimelineContextDedupeGroup<T extends TimelineContextStatus> {
  id: string | string[];
  items: T[];
  type: string;
  incompleteThread?: boolean;
}

export type TimelineContextDedupeEntry<T extends TimelineContextStatus> =
  | T
  | TimelineContextDedupeGroup<T>;

function atprotoRootId(item: TimelineContextStatus): string | undefined {
  const uri = item._atproto?.root?.uri;
  return uri ? encodeAtprotoID(uri) : undefined;
}

export function canonicalTimelineContextId(
  item: TimelineContextStatus,
): string {
  return item.repost?.id || item.id;
}

function canonicalTimelineContextAccountId(
  item: TimelineContextStatus,
): string {
  return item.repost?.account.id || item.account.id;
}

function isThreadContextEntry<T extends TimelineContextStatus>(
  item: TimelineContextDedupeEntry<T>,
): item is TimelineContextDedupeGroup<T> {
  const group = item as Partial<TimelineContextDedupeGroup<T>>;
  return (
    Array.isArray(group.items) &&
    (group.type === 'thread' || group.type === 'conversation')
  );
}

export function dedupeTimelineContextItems<T extends TimelineContextStatus>(
  items: readonly TimelineContextDedupeEntry<T>[],
): TimelineContextDedupeEntry<T>[] {
  // Timeline pages are grouped before pagination appends them. Match
  // social-app's stream-level post dedupe across the accumulated page list so
  // later pages cannot re-render an already visible thread context.
  const seenIDs = new Set<string>();
  const deduped: TimelineContextDedupeEntry<T>[] = [];

  items.forEach((item) => {
    if (!isThreadContextEntry(item)) {
      if (!Array.isArray((item as { items?: unknown }).items)) {
        if (item._pinned) {
          deduped.push(item);
          return;
        }
        const itemID = canonicalTimelineContextId(item);
        if (seenIDs.has(itemID)) return;
        seenIDs.add(itemID);
      }
      deduped.push(item);
      return;
    }

    const groupItems = [...item.items];
    let skipGroup = false;
    for (let i = 0; i < groupItems.length; i++) {
      const itemID = canonicalTimelineContextId(groupItems[i]);
      if (seenIDs.has(itemID)) {
        if (i === 0) {
          groupItems.splice(0, 1);
          i--;
        }
        if (i === groupItems.length - 1) {
          skipGroup = true;
          break;
        }
      } else {
        seenIDs.add(itemID);
      }
    }

    if (skipGroup || !groupItems.length) return;
    if (groupItems.length === 1) {
      deduped.push(groupItems[0]);
      return;
    }
    deduped.push({
      ...item,
      id: groupItems.map((groupItem) => groupItem.id),
      items: groupItems,
    });
  });

  return deduped;
}

function addUnique<T extends TimelineContextStatus>(context: T[], item: T) {
  const itemID = canonicalTimelineContextId(item);
  const existingIndex = context.findIndex(
    (t) => canonicalTimelineContextId(t) === itemID,
  );
  if (existingIndex === -1) {
    context.push(item);
  } else if (item.repost && !context[existingIndex].repost) {
    // ATProto reposts have synthetic wrapper IDs. Group by the original post
    // ID, but keep the wrapper object so the repost reason can render once.
    const existing = context[existingIndex];
    context[existingIndex] = {
      ...existing,
      ...item,
      _atproto:
        existing._atproto || item._atproto
          ? { ...existing._atproto, ...item._atproto }
          : undefined,
    };
  } else if (!item.repost && context[existingIndex].repost) {
    const existing = context[existingIndex];
    context[existingIndex] = {
      ...item,
      ...existing,
      _atproto:
        item._atproto || existing._atproto
          ? { ...item._atproto, ...existing._atproto }
          : undefined,
    };
  } else if (item.repost) {
    // Match social-app's one-reason-per-slice shape: the first repost wrapper
    // for a canonical post wins if multiple reposts land in the same batch.
  }
}

function hasIncompleteThread(
  contextItems: readonly TimelineContextStatus[],
): boolean {
  return contextItems.some((item, index) => {
    if (!item.inReplyToId) return false;
    if (index === 0) return true;
    return (
      item.inReplyToId !== canonicalTimelineContextId(contextItems[index - 1])
    );
  });
}

export function groupContextItems<T extends TimelineContextStatus>(
  items: readonly T[],
): TimelineContextGroup<T>[] {
  const contexts: T[][] = [];
  const findItemById = (id: string | null | undefined) =>
    id ? items.find((i) => canonicalTimelineContextId(i) === id) : undefined;

  items.forEach((item) => {
    const relatedItems: T[] = [];
    [findItemById(item.inReplyToId), findItemById(atprotoRootId(item))].forEach(
      (relatedItem) => {
        if (
          relatedItem &&
          canonicalTimelineContextId(relatedItem) !==
            canonicalTimelineContextId(item)
        ) {
          addUnique(relatedItems, relatedItem);
        }
      },
    );
    for (let i = 0; i < contexts.length; i++) {
      if (
        contexts[i].find(
          (t) =>
            canonicalTimelineContextId(t) === canonicalTimelineContextId(item),
        )
      ) {
        addUnique(contexts[i], item);
        return;
      }
      if (
        contexts[i].find(
          (t) => canonicalTimelineContextId(t) === item.inReplyToId,
        ) ||
        contexts[i].find(
          (t) => t.inReplyToId === canonicalTimelineContextId(item),
        ) ||
        relatedItems.some((relatedItem) =>
          contexts[i].find(
            (t) =>
              canonicalTimelineContextId(t) ===
              canonicalTimelineContextId(relatedItem),
          ),
        )
      ) {
        addUnique(contexts[i], item);
        relatedItems.forEach((relatedItem) => {
          addUnique(contexts[i], relatedItem);
        });
        return;
      }
    }
    if (relatedItems.length) {
      const context = [item];
      relatedItems.forEach((relatedItem) => {
        addUnique(context, relatedItem);
      });
      contexts.push(context);
    }
  });

  for (let i = 0; i < contexts.length; i++) {
    for (let j = i + 1; j < contexts.length; j++) {
      const commonItem = contexts[i].find((left) =>
        contexts[j].some(
          (right) =>
            canonicalTimelineContextId(right) ===
            canonicalTimelineContextId(left),
        ),
      );
      if (commonItem) {
        contexts[i] = [...contexts[i], ...contexts[j]];
        contexts[i] = contexts[i].filter(
          (item, index, self) =>
            self.findIndex(
              (t) =>
                canonicalTimelineContextId(t) ===
                canonicalTimelineContextId(item),
            ) === index,
        );
        contexts.splice(j, 1);
        j--;
      }
    }
  }

  contexts.forEach((context) => {
    context.sort((a, b) => {
      if (!a.inReplyToId && !b.inReplyToId) {
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      }
      if (a.inReplyToId === canonicalTimelineContextId(b)) return 1;
      if (b.inReplyToId === canonicalTimelineContextId(a)) return -1;
      if (!a.inReplyToId) return -1;
      if (!b.inReplyToId) return 1;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
  });

  return contexts.map((context) => {
    const firstItemAccountID = canonicalTimelineContextAccountId(context[0]);
    context.forEach((item) => {
      if (canonicalTimelineContextAccountId(item) !== firstItemAccountID) {
        item._differentAuthor = true;
      }
    });
    return {
      id: context.map((item) => item.id),
      items: context,
      type: context.every(
        (item) =>
          canonicalTimelineContextAccountId(item) === firstItemAccountID,
      )
        ? 'thread'
        : 'conversation',
      incompleteThread: hasIncompleteThread(context),
    };
  });
}

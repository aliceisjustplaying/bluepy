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
  reblog?: TimelineContextStatus | null;
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

function atprotoRootId(item: TimelineContextStatus): string | undefined {
  const uri = item._atproto?.root?.uri;
  return uri ? encodeAtprotoID(uri) : undefined;
}

export function canonicalTimelineContextId(
  item: TimelineContextStatus,
): string {
  return item.reblog?.id || item.id;
}

function canonicalTimelineContextAccountId(item: TimelineContextStatus): string {
  return item.reblog?.account.id || item.account.id;
}

function addUnique<T extends TimelineContextStatus>(context: T[], item: T) {
  const itemID = canonicalTimelineContextId(item);
  const existingIndex = context.findIndex(
    (t) => canonicalTimelineContextId(t) === itemID,
  );
  if (existingIndex === -1) {
    context.push(item);
  } else if (item.reblog && !context[existingIndex].reblog) {
    // ATProto reposts have synthetic wrapper IDs. Group by the original post
    // ID, but keep the wrapper object so the boost reason can render once.
    const existing = context[existingIndex];
    context[existingIndex] = {
      ...existing,
      ...item,
      _atproto:
        existing._atproto || item._atproto
          ? { ...existing._atproto, ...item._atproto }
          : undefined,
    };
  } else if (!item.reblog && context[existingIndex].reblog) {
    const existing = context[existingIndex];
    context[existingIndex] = {
      ...item,
      ...existing,
      _atproto:
        item._atproto || existing._atproto
          ? { ...item._atproto, ...existing._atproto }
          : undefined,
    };
  } else if (item.reblog) {
    // Match social-app's one-reason-per-slice shape: the first boost wrapper
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
    [
      findItemById(item.inReplyToId),
      findItemById(atprotoRootId(item)),
    ].forEach((relatedItem) => {
      if (
        relatedItem &&
        canonicalTimelineContextId(relatedItem) !==
          canonicalTimelineContextId(item)
      ) {
        addUnique(relatedItems, relatedItem);
      }
    });
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
        (item) => canonicalTimelineContextAccountId(item) === firstItemAccountID,
      )
        ? 'thread'
        : 'conversation',
      incompleteThread: hasIncompleteThread(context),
    };
  });
}

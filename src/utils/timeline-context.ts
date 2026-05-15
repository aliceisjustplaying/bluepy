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

function addUnique<T extends TimelineContextStatus>(context: T[], item: T) {
  if (!context.find((t) => t.id === item.id)) {
    context.push(item);
  }
}

function hasIncompleteThread(
  contextItems: readonly TimelineContextStatus[],
): boolean {
  return contextItems.some((item, index) => {
    if (!item.inReplyToId) return false;
    if (index === 0) return true;
    return item.inReplyToId !== contextItems[index - 1].id;
  });
}

export function groupContextItems<T extends TimelineContextStatus>(
  items: readonly T[],
): TimelineContextGroup<T>[] {
  const contexts: T[][] = [];
  const findItemById = (id: string | null | undefined) =>
    id ? items.find((i) => i.id === id) : undefined;

  items.forEach((item) => {
    const relatedItems: T[] = [];
    [
      findItemById(item.inReplyToId),
      findItemById(atprotoRootId(item)),
    ].forEach((relatedItem) => {
      if (relatedItem && relatedItem.id !== item.id) {
        addUnique(relatedItems, relatedItem);
      }
    });
    for (let i = 0; i < contexts.length; i++) {
      if (contexts[i].find((t) => t.id === item.id)) return;
      if (
        contexts[i].find((t) => t.id === item.inReplyToId) ||
        contexts[i].find((t) => t.inReplyToId === item.id) ||
        relatedItems.some((relatedItem) =>
          contexts[i].find((t) => t.id === relatedItem.id),
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
      const commonItem = contexts[i].find((t) => contexts[j].includes(t));
      if (commonItem) {
        contexts[i] = [...contexts[i], ...contexts[j]];
        contexts[i] = contexts[i].filter(
          (item, index, self) =>
            self.findIndex((t) => t.id === item.id) === index,
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
      if (a.inReplyToId === b.id) return 1;
      if (b.inReplyToId === a.id) return -1;
      if (!a.inReplyToId) return -1;
      if (!b.inReplyToId) return 1;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
  });

  return contexts.map((context) => {
    const firstItemAccountID = context[0].account.id;
    context.forEach((item) => {
      if (item.account.id !== firstItemAccountID) {
        item._differentAuthor = true;
      }
    });
    return {
      id: context.map((item) => item.id),
      items: context,
      type: context.every((item) => item.account.id === firstItemAccountID)
        ? 'thread'
        : 'conversation',
      incompleteThread: hasIncompleteThread(context),
    };
  });
}

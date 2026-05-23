import { api } from './api';
import pmem from './pmem';
import store from './store';

const FETCH_MAX_AGE = 1000 * 60; // 1 minute
const MAX_AGE = 24 * 60 * 60 * 1000; // 1 day

export interface ListLike {
  id: string;
  title: string;
  _atproto?: { type?: string; uri?: string; cid?: string } | null;
  [key: string]: unknown;
}

interface StoredLists {
  lists: ListLike[];
  updatedAt: number;
}

interface MastoListsApi {
  list(): Promise<ListLike[]>;
  $select(id: string): { fetch(): Promise<ListLike> };
}

export function isFeedList<T extends ListLike>(
  list: T | null | undefined,
): list is T & { _atproto: { type: 'feed' } } {
  // TODO(oxlint:no-underscore-dangle) `_atproto` is the project-wide cache key
  // used by the atproto adapter across many modules; renaming is out of scope.
  return list?._atproto?.type === 'feed';
}

export function splitListsAndFeeds(lists: ListLike[] = []): {
  lists: ListLike[];
  feeds: ListLike[];
} {
  return {
    lists: lists.filter((list) => !isFeedList(list)),
    feeds: lists.filter(isFeedList),
  };
}

export const fetchLists = pmem(
  async () => {
    const { masto } = api();
    const lists = await (masto.v1.lists as MastoListsApi).list();
    lists.sort((a, b) => a.title.localeCompare(b.title));

    if (lists.length) {
      setTimeout(() => {
        // Save to local storage, with saved timestamp
        store.account.set('lists', {
          lists,
          updatedAt: Date.now(),
        });
      }, 1);
    }

    return lists;
  },
  {
    expires: FETCH_MAX_AGE,
  },
);

export async function getLists(): Promise<ListLike[]> {
  try {
    const { lists, updatedAt } =
      store.account.get<StoredLists>('lists') || ({} as Partial<StoredLists>);
    if (!lists?.length) return await fetchLists();
    if (Date.now() - (updatedAt as number) > MAX_AGE) {
      // Stale-while-revalidate
      void fetchLists();
      return lists;
    }
    return lists;
  } catch {
    return [];
  }
}

export async function getUserLists(): Promise<ListLike[]> {
  const lists = await getLists();
  return splitListsAndFeeds(lists).lists;
}

const fetchList = pmem(
  (id: string, instance?: string) => {
    const { masto } = api({ instance });
    return (masto.v1.lists as MastoListsApi).$select(id).fetch();
  },
  {
    expires: FETCH_MAX_AGE,
  },
);

export async function getList(
  id: string,
  instance?: string,
): Promise<ListLike | null> {
  const { lists } =
    store.account.get<StoredLists>('lists') || ({} as Partial<StoredLists>);
  console.log({ lists });
  if (!instance && lists?.length) {
    const theList = lists.find((l) => l.id === id);
    if (theList) return theList;
  }
  try {
    return fetchList(id, instance);
  } catch {
    return null;
  }
}

export async function getListTitle(id: string): Promise<string> {
  const list = await getList(id);
  return list?.title || '';
}

export function addListStore(list: ListLike): void {
  const { lists } =
    store.account.get<StoredLists>('lists') || ({} as Partial<StoredLists>);
  if (lists?.length) {
    lists.push(list);
    lists.sort((a, b) => a.title.localeCompare(b.title));
    store.account.set('lists', {
      lists,
      updatedAt: Date.now(),
    });
  }
}

export function updateListStore(list: ListLike): void {
  const { lists } =
    store.account.get<StoredLists>('lists') || ({} as Partial<StoredLists>);
  if (lists?.length) {
    const index = lists.findIndex((l) => l.id === list.id);
    if (index !== -1) {
      lists[index] = list;
      lists.sort((a, b) => a.title.localeCompare(b.title));
      store.account.set('lists', {
        lists,
        updatedAt: Date.now(),
      });
    }
  }
}

export function deleteListStore(listID: string): void {
  const { lists } =
    store.account.get<StoredLists>('lists') || ({} as Partial<StoredLists>);
  if (lists?.length) {
    const index = lists.findIndex((l) => l.id === listID);
    if (index !== -1) {
      lists.splice(index, 1);
      store.account.set('lists', {
        lists,
        updatedAt: Date.now(),
      });
    }
  }
}

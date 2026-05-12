import { api } from './api';
import pmem from './pmem';
import store from './store';

const FETCH_MAX_AGE = 1000 * 60; // 1 minute
const MAX_AGE = 24 * 60 * 60 * 1000; // 1 day

interface ListLike {
  id: string;
  title: string;
  _atproto?: { type?: string } | null;
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

export function isFeedList(list: ListLike | null | undefined): boolean {
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
    const lists = await (masto.v1.lists as unknown as MastoListsApi).list();
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
      fetchLists();
      return lists;
    }
    return lists;
  } catch (e) {
    return [];
  }
}

export async function getUserLists(): Promise<ListLike[]> {
  const lists = await getLists();
  return splitListsAndFeeds(lists).lists;
}

export const fetchList = pmem(
  (id: string) => {
    const { masto } = api();
    return (masto.v1.lists as unknown as MastoListsApi).$select(id).fetch();
  },
  {
    expires: FETCH_MAX_AGE,
  },
);

export async function getList(id: string): Promise<ListLike | null> {
  const { lists } =
    store.account.get<StoredLists>('lists') || ({} as Partial<StoredLists>);
  console.log({ lists });
  if (lists?.length) {
    const theList = lists.find((l) => l.id === id);
    if (theList) return theList;
  }
  try {
    return fetchList(id);
  } catch (e) {
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

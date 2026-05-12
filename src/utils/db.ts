import {
  clear,
  createStore,
  del,
  delMany,
  get,
  getMany,
  keys,
  set,
} from 'idb-keyval';

function initDB(dbName: string, storeName: string) {
  const store = createStore(dbName, storeName);
  return {
    set: (key: IDBValidKey, val: unknown) => set(key, val, store),
    get: (key: IDBValidKey) => get(key, store),
    getMany: (keys: IDBValidKey[]) => getMany(keys, store),
    del: (key: IDBValidKey) => del(key, store),
    delMany: (keys: IDBValidKey[]) => delMany(keys, store),
    clear: () => clear(store),
    keys: () => keys(store),
  };
}

export default {
  drafts: initDB('drafts-db', 'drafts-store'),
  catchup: initDB('catchup-db', 'catchup-store'),
  yearInPosts: initDB('year-in-posts-db', 'year-in-posts-store'),
};

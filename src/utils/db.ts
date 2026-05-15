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
    getMany: (keysArg: IDBValidKey[]) => getMany(keysArg, store),
    del: (key: IDBValidKey) => del(key, store),
    delMany: (keysArg: IDBValidKey[]) => delMany(keysArg, store),
    clear: () => clear(store),
    keys: () => keys(store),
  };
}

export default {
  drafts: initDB('drafts-db', 'drafts-store'),
  catchup: initDB('catchup-db', 'catchup-store'),
  yearInPosts: initDB('year-in-posts-db', 'year-in-posts-store'),
};

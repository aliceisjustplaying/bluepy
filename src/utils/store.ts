import Cookies from 'js-cookie';

// TODO(oxlint:import/no-cycle): store <-> store-utils cycle is structural;
// the account namespace needs getCurrentAccountNS() at runtime, and
// store-utils needs the store to read accounts/instances. Breaking this
// requires extracting the per-account key namespace into a third leaf
// module shared by both. Out of scope for the oxlint cleanup batch.
import { getCurrentAccountNS } from './store-utils';

interface StorageNamespace {
  del(key: string): undefined | null;
  get(key: string): string | null;
  getJSON<Result = unknown>(
    key: string,
    revive?: (value: unknown) => Result,
  ): Result | null;
  set(key: string, value: string): undefined | null;
  setJSON(key: string, value: unknown): undefined | null;
}

interface CookieNamespace {
  del(key: string): void;
  get(key: string): string | undefined;
  set(key: string, value: string): string | undefined;
}

interface SessionCookieNamespace {
  del(key: string): unknown;
  get(key: string): string | null | undefined;
  set(key: string, value: string): unknown;
}

interface AccountNamespace {
  del(key: string): undefined | null;
  get<Result = unknown>(
    key: string,
    revive?: (value: unknown) => Result,
  ): Result | null;
  set(key: string, value: unknown): undefined | null;
}

export interface Store {
  readonly account: AccountNamespace;
  readonly cookie: CookieNamespace;
  readonly local: StorageNamespace;
  readonly session: StorageNamespace;
  readonly sessionCookie: SessionCookieNamespace;
}

const cookies = Cookies.withAttributes({ sameSite: 'strict', secure: true });

const canSetSecureCookie =
  navigator.cookieEnabled &&
  (() => {
    try {
      const key = '__phanpy_can_set_secure_cookie__';
      const value = '1';
      cookies.set(key, value);
      const result = cookies.get(key) === value;
      cookies.remove(key);
      return result;
    } catch {
      return false;
    }
  })();

const local: StorageNamespace = {
  del: (key) => {
    try {
      localStorage.removeItem(key);
      return undefined;
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  getJSON<Result = unknown>(key: string, revive?: (value: unknown) => Result) {
    try {
      const value = local.get(key);
      if (value === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(value);
      return revive ? revive(parsed) : (parsed as Result);
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
      return undefined;
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  setJSON: (key, value) => {
    try {
      return local.set(key, JSON.stringify(value));
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
};

const session: StorageNamespace = {
  del: (key) => {
    try {
      sessionStorage.removeItem(key);
      return undefined;
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  get: (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  getJSON<Result = unknown>(key: string, revive?: (value: unknown) => Result) {
    try {
      const value = session.get(key);
      if (value === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(value);
      return revive ? revive(parsed) : (parsed as Result);
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  set: (key, value) => {
    try {
      sessionStorage.setItem(key, value);
      return undefined;
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  setJSON: (key, value) => {
    try {
      return session.set(key, JSON.stringify(value));
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
};

// Session secure cookie
const cookie: CookieNamespace = {
  del: (key) => {
    cookies.remove(key);
  },
  get: (key) => cookies.get(key),
  set: (key, value) => cookies.set(key, value),
};

// Cookie with sessionStorage fallback
const sessionCookie: SessionCookieNamespace = {
  del: (key) => {
    if (canSetSecureCookie) {
      cookie.del(key);
      return undefined;
    }
    return session.del(key);
  },
  get: (key) => {
    if (canSetSecureCookie) {
      return cookie.get(key);
    }
    return session.get(key);
  },
  set: (key, value) => {
    if (canSetSecureCookie) {
      return cookie.set(key, value);
    }
    return session.set(key, value);
  },
};

// Store with account namespace (id@domain.tld) <- uses id, not username
const account: AccountNamespace = {
  del: (key) => {
    try {
      const data = local.getJSON<Record<string, unknown>>(key) ?? {};
      delete data[getCurrentAccountNS()];
      return local.setJSON(key, data);
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  get<Result = unknown>(key: string, revive?: (value: unknown) => Result) {
    try {
      const value =
        local.getJSON<Record<string, unknown>>(key)?.[getCurrentAccountNS()] ??
        null;
      return value === null ? null : revive ? revive(value) : (value as Result);
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
  set: (key, value) => {
    try {
      const data = local.getJSON<Record<string, unknown>>(key) ?? {};
      data[getCurrentAccountNS()] = value;
      return local.setJSON(key, data);
    } catch (error) {
      console.warn(error);
      return null;
    }
  },
};

const store: Store = { account, cookie, local, session, sessionCookie };

export default store;

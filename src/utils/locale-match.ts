import { match } from '@formatjs/intl-localematcher';

import mem from './mem';
import store from './store';

const CACHE_STORE = 'localeMatchCache';

type MatchArgs = Parameters<typeof match>;

export function _localeMatch(...args: MatchArgs): string | false {
  try {
    return match(...args);
  } catch (e) {
    const defaultLocale = args[2];
    return defaultLocale || false;
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { _localeMatch: typeof _localeMatch })._localeMatch =
    _localeMatch; // For debugging
}

function cacheMem<Args extends readonly unknown[], Result>(
  fn: (...args: Args) => Result,
) {
  return function (...args: Args): Result {
    const cacheKey = args
      .map((arg) => (Array.isArray(arg) ? arg.join(',') : arg))
      .join('|');

    let cache: Record<string, Result>;
    try {
      cache = store.session.getJSON<Record<string, Result>>(CACHE_STORE) || {};
    } catch (e) {
      // If fails, just call the function
      return fn(...args);
    }

    if (cache[cacheKey]) return cache[cacheKey];

    const result = fn(...args);

    try {
      cache[cacheKey] = result;
      store.session.setJSON(CACHE_STORE, cache);
    } catch (e) {
      // Ignore errors
    }

    return result;
  };
}

const localeMatch = mem(cacheMem(_localeMatch));

export default localeMatch;

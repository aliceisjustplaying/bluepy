import { match } from '@formatjs/intl-localematcher';

import mem from './mem';
import store from './store';

const CACHE_STORE = 'localeMatchCache';

type MatchArgs = Parameters<typeof match>;

export function baseLocaleMatch(...args: MatchArgs): string | false {
  try {
    return match(...args);
  } catch {
    const defaultLocale = args[2];
    return defaultLocale || false;
  }
}

if (typeof window !== 'undefined') {
  // TODO(oxlint:no-underscore-dangle) Intentional debug global; renaming would
  // break existing devtools workflows that rely on `_localeMatch`.
  (window as unknown as { _localeMatch: typeof baseLocaleMatch })._localeMatch =
    baseLocaleMatch;
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
    } catch {
      // If fails, just call the function
      return fn(...args);
    }

    if (cache[cacheKey]) return cache[cacheKey];

    const result = fn(...args);

    try {
      cache[cacheKey] = result;
      store.session.setJSON(CACHE_STORE, cache);
    } catch {
      // Ignore errors
    }

    return result;
  };
}

const localeMatch = mem(cacheMem(baseLocaleMatch));

export default localeMatch;

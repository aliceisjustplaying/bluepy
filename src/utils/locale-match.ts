import { match } from '@formatjs/intl-localematcher';

import mem from './mem';
import store from './store';

const CACHE_STORE = 'localeMatchCache';

type MatchArgs = Parameters<typeof match>;

interface LocaleInfo {
  canonical: string;
  language: string;
  matchedValue: string;
  script?: string;
  region?: string;
}

const canonicalLocale = (locale: string): string => {
  try {
    return Intl.getCanonicalLocales(locale)[0] || locale;
  } catch {
    return locale;
  }
};

const getLocaleInfo = (locale: string): LocaleInfo | undefined => {
  const canonical = canonicalLocale(locale);
  try {
    const parsed = new Intl.Locale(canonical);
    return {
      canonical,
      language: parsed.language,
      matchedValue:
        canonical.toLowerCase() === locale.toLowerCase() ? canonical : locale,
      script: parsed.script,
      region: parsed.region,
    };
  } catch {
    return undefined;
  }
};

const getMaximizedScript = (locale: string): string | undefined => {
  try {
    return new Intl.Locale(canonicalLocale(locale)).maximize().script;
  } catch {
    return undefined;
  }
};

function normalizeBestFitMatch(
  requestedLocales: readonly string[],
  availableLocales: readonly string[],
  matchedLocale: string,
): string {
  const canonicalMatch = canonicalLocale(matchedLocale);
  const requestedInfo = requestedLocales.map(getLocaleInfo).find(Boolean);
  if (!requestedInfo) return canonicalMatch;

  const exactMatch = availableLocales
    .map(getLocaleInfo)
    .find((available) => available?.canonical === requestedInfo.canonical);
  if (exactMatch) return exactMatch.matchedValue;

  const requestedScript = getMaximizedScript(requestedInfo.canonical);
  const availableInfos = availableLocales
    .map(getLocaleInfo)
    .filter((available): available is LocaleInfo => !!available);

  const scriptOnlyMatch = availableInfos.find(
    (available) =>
      available.language === requestedInfo.language &&
      !!requestedScript &&
      available.script === requestedScript &&
      !available.region,
  );
  if (scriptOnlyMatch) return scriptOnlyMatch.matchedValue;

  const bareLanguageMatch = availableInfos.find(
    (available) =>
      available.language === requestedInfo.language &&
      !available.script &&
      !available.region,
  );
  if (bareLanguageMatch) return bareLanguageMatch.matchedValue;

  return canonicalMatch;
}

export function baseLocaleMatch(...args: MatchArgs): string | false {
  try {
    const matchedLocale = match(...args);
    return normalizeBestFitMatch(args[0], args[1], matchedLocale);
  } catch {
    const defaultLocale = args[2];
    return defaultLocale ? canonicalLocale(defaultLocale) : false;
  }
}

export const _localeMatch = baseLocaleMatch;

if (typeof window !== 'undefined') {
  // TODO(oxlint:no-underscore-dangle) Intentional debug global; renaming would
  // break existing devtools workflows that rely on `_localeMatch`.
  (window as unknown as { _localeMatch: typeof _localeMatch })._localeMatch =
    _localeMatch;
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

const localeMatch = mem(cacheMem(_localeMatch));

export default localeMatch;

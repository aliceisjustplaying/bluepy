import { clearDtfLocaleCache, getDtfLocale } from './dtf-locale';
import localeMatch from './locale-match';
import mem from './mem';

type NullableRequestedLocaleMatch = (
  requestedLocales: readonly (string | null | undefined)[],
  availableLocales: readonly string[],
  defaultLocale: string,
) => string | false;

const localeMatchWithNullableRequested =
  localeMatch as NullableRequestedLocaleMatch;

interface LocaleLike {
  language: string;
  region: string | null;
  toString: () => string;
  [key: string]: unknown;
}

function initLocales(): string[] {
  const newLocales = [...navigator.languages];
  const dtfLocale = getDtfLocale();
  if (dtfLocale && !newLocales.includes(dtfLocale)) {
    newLocales.unshift(dtfLocale);
  }
  return newLocales;
}

let locales = initLocales();

// For testing: refresh locales from current navigator state
export function refreshLocales(): void {
  clearDtfLocaleCache();
  locales = initLocales();
}

const createLocale = mem(
  (
    language: string,
    options: Intl.LocaleOptions = {},
  ): Intl.Locale | LocaleLike | null => {
    try {
      return new Intl.Locale(language, options);
    } catch {
      // Fallback to simple string splitting
      // May not work properly due to how complicated this is
      if (!language) return null;

      // https://www.w3.org/International/articles/language-tags/
      // Parts: language-extlang-script-region-variant-extension-privateuse
      const [langPart, ...parts] = language.split('-', 4);
      const regionPart = parts.pop() || null;
      const fallbackLocale: LocaleLike = {
        language: langPart,
        region: regionPart,
        ...options,
        toString: () => {
          const lang = fallbackLocale.language;
          const middle = parts.length > 0 ? `-${parts.join('-')}-` : '-';
          const reg = fallbackLocale.region;
          return reg ? `${lang}${middle}${reg}` : lang;
        },
      };
      return fallbackLocale;
    }
  },
);

const createDateTimeFormat = (
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  const options = opts;

  const appLocale = createLocale(locale);

  // Find first user locale with a region
  let userRegion: string | null = null;
  for (const loc of locales) {
    const region = createLocale(loc)?.region;
    if (region) {
      userRegion = region;
      break;
    }
  }

  const userRegionLocale =
    userRegion && appLocale && appLocale.region !== userRegion
      ? createLocale(appLocale.language, {
          ...(appLocale as Record<string, unknown>),
          region: userRegion,
        } as Intl.LocaleOptions)?.toString()
      : null;

  const matchedLocale = localeMatchWithNullableRequested(
    [userRegionLocale, locale, locale?.replace(/-[a-z]+$/i, '')],
    locales,
    locale,
  );

  try {
    return new Intl.DateTimeFormat(
      matchedLocale === false ? undefined : matchedLocale,
      options,
    );
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
};

const DateTimeFormat = mem(createDateTimeFormat);

export default DateTimeFormat;

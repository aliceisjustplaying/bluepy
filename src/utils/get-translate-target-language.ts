import languages from '../data/translang-languages.json';

import { getDtfLocale } from './dtf-locale';
import localeMatch from './locale-match';
import states from './states';

// Preserve the original JS shape: values in `languages.tl` are strings, but the
// existing code destructures `{ name }` from each one (yielding `undefined`).
// `name` is unused downstream — only `code` is — so we keep the bug as-is and
// type the entry value as `{ name: string }` to match the runtime destructure.
const translationTargetLanguages = Object.entries(
  languages.tl as unknown as Record<string, { name: string }>,
).map(([code, { name }]) => ({
  code,
  name,
}));

const locales = [...navigator.languages];
const dtfLocale = getDtfLocale();
if (dtfLocale && !locales.includes(dtfLocale)) {
  locales.unshift(dtfLocale);
}

const localeTargetLanguages = () =>
  localeMatch(
    locales,
    translationTargetLanguages.map((l) => l.code.replace('_', '-')), // The underscore will fail Intl.Locale inside `match`
    'en',
  );

function getTranslateTargetLanguage(fromSettings = false): string | false {
  if (fromSettings) {
    const { contentTranslationTargetLanguage } = states.settings;
    if (contentTranslationTargetLanguage) {
      return contentTranslationTargetLanguage;
    }
  }
  return localeTargetLanguages();
}

export default getTranslateTargetLanguage;

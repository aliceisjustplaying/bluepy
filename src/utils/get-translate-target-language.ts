import languages from '../data/translang-languages.json';

import { getDtfLocale } from './dtf-locale';
import localeMatch from './locale-match';
import states from './states';

// Original JS destructured `{ name }` from string values, so `name` stayed
// undefined. Only `code` is used for locale matching.
const translationLanguageNames = languages.tl as Record<string, string>;
const translationTargetLanguages = Object.keys(translationLanguageNames).map(
  (code) => ({
    code,
    name: undefined,
  }),
);

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

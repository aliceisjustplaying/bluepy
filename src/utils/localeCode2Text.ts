import { i18n } from '@lingui/core';

import translangLanguagesNative from '../data/translang-languages-native.json';

import mem from './mem';

// Some codes are not supported by Intl.DisplayNames
// These are mapped to other codes as fallback
const codeMappings: Record<string, string> = {
  'zh-YUE': 'YUE',
  zh_HANT: 'zh-Hant',
  mnMong: 'mn-Mong',
};

const IntlDN = mem(
  (locale: string | undefined) =>
    new Intl.DisplayNames(locale || undefined, {
      type: 'language',
    }),
);

function notSameIncaseSensitive(
  s1: string | undefined,
  s2: string | undefined,
): boolean {
  if (!s1 || !s2) return s1 !== s2;
  return s1.toLowerCase() !== s2.toLowerCase();
}

interface LocaleCode2TextOptions {
  code: string;
  locale?: string;
  fallback?: string;
}

type LocaleCode2TextInput = string | LocaleCode2TextOptions;

function localeCode2TextImpl(
  input: LocaleCode2TextInput,
): string | undefined {
  let code: string;
  let locale: string | undefined;
  let fallback: string | undefined;
  if (typeof input === 'object') {
    ({ code, locale, fallback } = input);
  } else {
    code = input;
  }
  try {
    const text = IntlDN(locale || i18n.locale).of(code);
    if (notSameIncaseSensitive(text, code)) return text;
    if (!fallback) {
      const anotherText = IntlDN(code).of(code);
      if (notSameIncaseSensitive(anotherText, code)) return anotherText;
      const yetAnotherText = (
        translangLanguagesNative as Record<string, string | undefined>
      )[locale as string];
      if (notSameIncaseSensitive(yetAnotherText, code)) return yetAnotherText;
    }
    return fallback || '';
  } catch {
    if (codeMappings[code]) {
      try {
        const text = IntlDN(
          codeMappings[locale as string] || locale || i18n.locale,
        ).of(codeMappings[code]);
        if (notSameIncaseSensitive(text, codeMappings[code])) return text;
        return fallback || '';
      } catch (e2) {
        console.warn(code, e2);
      }
    }
    return fallback || '';
  }
}

export default mem(localeCode2TextImpl);

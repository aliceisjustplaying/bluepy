import { i18n } from '@lingui/core';
import {
  fromNavigator,
  fromStorage,
  fromUrl,
  multipleDetect,
} from '@lingui/detect-locale';
import Locale from 'intl-locale-textinfo-polyfill';

import { ALL_LOCALES, DEFAULT_LANG } from '../locales';
import { messages } from '../locales/en.po';
import localeMatch from '../utils/locale-match';

const { PHANPY_DEFAULT_LANG } = import.meta.env;

const langFileMaps: Record<string, string> = {
  // kab: 'kab-KAB',
};

// intl-locale-textinfo-polyfill ships only a global `Intl.Locale` ambient
// declaration; the default export is the same Locale class. Some runtimes
// expose `textInfo` as a getter rather than the spec'd `getTextInfo()` method,
// so the original JS reads both. Model both surfaces here.
interface LocaleTextInfo {
  direction: 'ltr' | 'rtl';
}
interface LocaleCompat {
  getTextInfo?: () => LocaleTextInfo;
  textInfo: LocaleTextInfo;
}

i18n.load(DEFAULT_LANG, messages);
i18n.on('change', () => {
  const lang = i18n.locale;
  if (lang) {
    // lang
    document.documentElement.lang = lang;
    // LTR or RTL
    try {
      const loc = new Locale(lang) as unknown as LocaleCompat;
      const { direction } = loc.getTextInfo?.() || loc.textInfo;
      document.documentElement.dir = direction;
    } catch (e) {
      console.error(e);
    }
  }
});

export async function activateLang(lang: string | false | undefined | null) {
  if (!lang || lang === DEFAULT_LANG) {
    i18n.activate(DEFAULT_LANG);
    console.log('💬 ACTIVATE LANG', DEFAULT_LANG, lang);
  } else {
    try {
      const { messages: loadedMessages } = await import(
        `../locales/${langFileMaps[lang] || lang}.po`
      );
      i18n.loadAndActivate({ locale: lang, messages: loadedMessages });
      console.log('💬 ACTIVATE LANG', lang, loadedMessages);
    } catch (e) {
      console.error(e);
      // Fallback to default language
      i18n.activate(DEFAULT_LANG);
      console.log('💬 ACTIVATE LANG', DEFAULT_LANG, lang);
    }
  }
}

export function initActivateLang() {
  const languages = multipleDetect(
    fromUrl('lang'),
    fromStorage('lang'),
    fromNavigator(),
    PHANPY_DEFAULT_LANG,
    DEFAULT_LANG,
  );
  // Original JS calls localeMatch with two args; the wrapper catches the
  // resulting TypeError (defaultLocale required) and returns `false`, which
  // activateLang then treats as falsy and falls back to DEFAULT_LANG.
  // Preserve that exact two-arg call shape via a narrowed type assertion.
  const localeMatchTwoArg = localeMatch as unknown as (
    requested: readonly string[],
    available: readonly string[],
  ) => string | false;
  const matchedLang =
    languages.find((l) => ALL_LOCALES.includes(l)) ||
    localeMatchTwoArg(languages, ALL_LOCALES);
  void activateLang(matchedLang);

  // const yes = confirm(t`Reload to apply language setting?`);
  // if (yes) {
  //   window.location.reload();
  // }
}

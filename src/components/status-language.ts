import { useEffect, useMemo, useState } from 'react';

import {
  checkDifferentLanguage,
  detectLang,
  DIFFERENT_LANG_CHECK,
  diffLangCheckCacheKey,
  getHTMLTextForDetectLang,
} from './status-helpers';
import type { AnyStatus } from './status-types';

interface StatusLanguageArgs {
  content?: string;
  language?: string | null;
  emojis?: AnyStatus['emojis'];
  contentTranslationHideLanguages?: readonly string[];
}

export default function useStatusLanguage({
  content,
  language: statusLanguage,
  emojis,
  contentTranslationHideLanguages: contentTranslationHideLanguagesSource,
}: StatusLanguageArgs) {
  const [languageAutoDetected, setLanguageAutoDetected] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (!content) return undefined;
    if (statusLanguage) return undefined;
    if (languageAutoDetected) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    timer = setTimeout(() => {
      void (async () => {
        let detected = await detectLang(
          getHTMLTextForDetectLang(content, emojis),
        );
        setLanguageAutoDetected(detected);
      })();
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [content, statusLanguage, languageAutoDetected, emojis]);
  const language = statusLanguage || languageAutoDetected;

  const contentTranslationHideLanguages: string[] = useMemo(
    () => [...(contentTranslationHideLanguagesSource || [])],
    [contentTranslationHideLanguagesSource],
  );
  const [differentLanguage, setDifferentLanguage] = useState<boolean>(
    DIFFERENT_LANG_CHECK[
      diffLangCheckCacheKey(language as string, contentTranslationHideLanguages)
    ],
  );
  useEffect(() => {
    if (!language || differentLanguage) {
      return undefined;
    }
    if (
      !differentLanguage &&
      DIFFERENT_LANG_CHECK[
        diffLangCheckCacheKey(language, contentTranslationHideLanguages)
      ]
    ) {
      setDifferentLanguage(true);
      return undefined;
    }
    let timeout = setTimeout(() => {
      const different = checkDifferentLanguage(
        language,
        contentTranslationHideLanguages,
      );
      if (different) setDifferentLanguage(different);
    }, 100);
    return () => {
      clearTimeout(timeout);
    };
  }, [language, differentLanguage, contentTranslationHideLanguages]);

  return {
    language,
    languageAutoDetected,
    differentLanguage,
  };
}

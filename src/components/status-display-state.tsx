import type { mastodon } from 'masto';
import { Fragment } from 'react';
import { useMemo, useState } from 'react';
import { useSnapshot } from 'valtio';

import { getPreferences } from '../utils/api';
import htmlContentLength from '../utils/html-content-length';
import states from '../utils/states';

import { INLINE_TRANSLATE_LIMIT } from './status-helpers';
import useStatusLanguage from './status-language';

interface StatusDisplayStateArgs {
  id: string;
  content?: string | null;
  language?: string | null;
  emojis?: mastodon.v1.CustomEmoji[];
  readOnly?: boolean;
  withinContext?: boolean;
  isSizeLarge: boolean;
  previewMode?: boolean;
  spoilerText?: string | null;
  sensitive?: boolean | null;
  card?: unknown;
  filterInfoMaybe?: { action: 'hide' | 'blur' | 'warn' };
  enableTranslate?: boolean;
  forceTranslate?: boolean;
}

export default function useStatusDisplayState({
  id,
  content,
  language: statusLanguage,
  emojis,
  readOnly,
  withinContext,
  isSizeLarge,
  previewMode,
  spoilerText,
  sensitive,
  card,
  filterInfoMaybe,
  enableTranslate: initialEnableTranslate,
  forceTranslate: initialForceTranslate,
}: StatusDisplayStateArgs) {
  const prefs = getPreferences();
  const readingExpandSpoilers = !!prefs['reading:expand:spoilers'];
  const readingExpandMedia =
    (prefs['reading:expand:media'] as string | undefined)?.toLowerCase() ||
    'default';
  const snapStates = useSnapshot(states);
  const showSpoiler =
    previewMode || readingExpandSpoilers || !!snapStates.spoilers[id];
  const showSpoilerMedia =
    previewMode ||
    (readingExpandMedia === 'show_all' && filterInfoMaybe?.action !== 'blur') ||
    !!snapStates.spoilersMedia[id];

  const StatusParent = Fragment;

  const contentLength = useMemo(
    () => htmlContentLength(content || ''),
    [content],
  );
  const [forceTranslate, setForceTranslate] = useState(initialForceTranslate);
  const { contentTranslation, contentTranslationAutoInline } =
    snapStates.settings;
  const { language, languageAutoDetected, differentLanguage } =
    useStatusLanguage({
      content: content || '',
      language: statusLanguage ?? undefined,
      emojis,
      contentTranslationHideLanguages:
        snapStates.settings.contentTranslationHideLanguages,
    });
  const enableTranslate = contentTranslation ? initialEnableTranslate : false;
  const inlineTranslate = useMemo(() => {
    if (
      !contentTranslation ||
      !contentTranslationAutoInline ||
      readOnly ||
      (withinContext && !isSizeLarge) ||
      previewMode ||
      spoilerText ||
      sensitive ||
      card
    ) {
      return false;
    }
    return contentLength > 0 && contentLength <= INLINE_TRANSLATE_LIMIT;
  }, [
    contentTranslation,
    contentTranslationAutoInline,
    readOnly,
    withinContext,
    isSizeLarge,
    previewMode,
    spoilerText,
    sensitive,
    card,
    contentLength,
  ]);

  return {
    StatusParent,
    contentLength,
    forceTranslate,
    setForceTranslate,
    enableTranslate,
    inlineTranslate,
    language,
    languageAutoDetected,
    differentLanguage,
    readingExpandSpoilers,
    readingExpandMedia,
    showSpoiler,
    showSpoilerMedia,
  };
}

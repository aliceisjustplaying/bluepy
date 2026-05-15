import type { ComponentChildren } from 'preact';
import type { mastodon } from 'masto';
import { Fragment } from 'preact';
import { useCallback, useMemo, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import { getPreferences } from '../utils/api';
import htmlContentLength from '../utils/html-content-length';
import states from '../utils/states';

import Icon from './icon';
import Link from './link';
import { INLINE_TRANSLATE_LIMIT } from './status-helpers';
import useStatusLanguage from './status-language';

interface StatusDisplayStateArgs {
  sKey: string;
  instance: string;
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
  poll?: unknown;
  card?: unknown;
  filterInfoMaybe?: { action: 'hide' | 'blur' | 'warn' };
  showFollowedTags?: boolean;
  enableTranslate?: boolean;
  forceTranslate?: boolean;
  debugHover: (event: MouseEvent) => void;
}

export default function useStatusDisplayState({
  sKey,
  instance,
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
  poll,
  card,
  filterInfoMaybe,
  showFollowedTags,
  enableTranslate: initialEnableTranslate,
  forceTranslate: initialForceTranslate,
  debugHover,
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

  const followedTagsForKey = snapStates.statusFollowedTags[sKey] as
    | readonly string[]
    | undefined;
  const FollowedTagsParent = useCallback(
    ({ children }: { children?: ComponentChildren }) => (
      <div
        data-state-post-id={sKey}
        class="status-followed-tags"
        onMouseEnter={debugHover}
      >
        <div class="status-pre-meta">
          <Icon icon="hashtag" size="l" />{' '}
          {followedTagsForKey!.slice(0, 3).map((tag: string) => (
            <Link
              key={tag}
              to={instance ? `/${instance}/t/${tag}` : `/t/${tag}`}
              class="status-followed-tag-item"
            >
              {tag}
            </Link>
          ))}
        </div>
        {children}
      </div>
    ),
    [sKey, instance, followedTagsForKey, debugHover],
  );
  const StatusParent =
    showFollowedTags && !!followedTagsForKey?.length
      ? FollowedTagsParent
      : Fragment;

  const contentLength = useMemo(() => htmlContentLength(content || ''), [content]);
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
      poll ||
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
    poll,
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

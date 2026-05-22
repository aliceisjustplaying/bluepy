import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ReactNode, CSSProperties, RefObject } from 'react';

import states from '../utils/states';

import EmojiText from './emoji-text';
import Icon from './icon';
import MathBlock from './math-block';
import MediaFirstContainer from './media-first-container';
import PostContent from './post-content';
import StatusCard from './status-card';
import { getPostText, isTranslateble, readMoreText } from './status-helpers';
import StatusMediaEmbeds from './status-media-embeds';
import QuoteStatuses, { type FallbackQuote } from './status-quotes';
import StatusTags from './status-tags';
import type {
  AnyMediaAttachment,
  AnyPreviewCard,
  AnyStatus,
} from './status-types';
import type { StatusComponentProps } from './status-view';
import TranslationBlock from './translation-block';

type FilterInfoMaybe = {
  action: 'hide' | 'blur' | 'warn';
  titlesStr?: string;
};

interface StatusPostBodyProps {
  mediaFirst?: boolean;
  hasMediaAttachments: boolean;
  spoilerText?: string | null;
  sensitive?: boolean | null;
  filterInfoMaybe?: FilterInfoMaybe;
  readingExpandMedia?: string;
  showSpoiler: boolean;
  showSpoilerMedia: boolean;
  contentTextWeight?: boolean;
  textWeight: () => number;
  isSizeLarge: boolean;
  readingExpandSpoilers: boolean;
  language?: string | null;
  spoilerContentRef: RefObject<HTMLDivElement>;
  emojis?: mastodon.v1.CustomEmoji[];
  id: string;
  mediaAttachments: AnyMediaAttachment[];
  instance: string;
  content?: string | null;
  contentRef: RefObject<HTMLDivElement>;
  status: AnyStatus;
  previewMode?: boolean;
  reloadPostContentCount: number;
  reloadPostContent: () => void;
  enableTranslate?: boolean;
  inlineTranslate?: boolean;
  differentLanguage?: boolean;
  forceTranslate?: boolean;
  withinContext?: boolean;
  languageAutoDetected?: boolean;
  displayedMediaAttachments: AnyMediaAttachment[];
  showMultipleMediaCaptions: boolean;
  captionChildren: ReactNode;
  mediaContainerRef: RefObject<HTMLDivElement>;
  onMediaClick?: (
    e: React.MouseEvent,
    index: number,
    media: AnyMediaAttachment,
    status: AnyStatus,
  ) => void;
  quoted?: boolean | number;
  quote?: FallbackQuote | null;
  renderStatus: (props: StatusComponentProps) => ReactNode;
  card?: AnyPreviewCard | null;
  statusQuoteState?: unknown;
  accountURL?: string | null;
  size: string;
  tags?: mastodon.v1.Tag[];
  showCommentCount?: boolean;
  showQuoteCount?: boolean;
  repliesCount?: number;
  quotesCount?: number;
}

export default function StatusPostBody({
  mediaFirst,
  hasMediaAttachments,
  spoilerText,
  sensitive,
  filterInfoMaybe,
  readingExpandMedia,
  showSpoiler,
  showSpoilerMedia,
  contentTextWeight,
  textWeight,
  isSizeLarge,
  readingExpandSpoilers,
  language,
  spoilerContentRef,
  emojis,
  id,
  mediaAttachments,
  instance,
  content,
  contentRef,
  status,
  previewMode,
  reloadPostContentCount,
  reloadPostContent,
  enableTranslate,
  inlineTranslate,
  differentLanguage,
  forceTranslate,
  withinContext,
  languageAutoDetected,
  displayedMediaAttachments,
  showMultipleMediaCaptions,
  captionChildren,
  mediaContainerRef,
  onMediaClick,
  quoted,
  quote,
  renderStatus,
  card,
  statusQuoteState,
  accountURL,
  size,
  tags,
  showCommentCount,
  showQuoteCount,
  repliesCount = 0,
  quotesCount = 0,
}: StatusPostBodyProps) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  return (
    <>
      <div
        className={`content-container ${
          spoilerText ||
          sensitive ||
          filterInfoMaybe?.action === 'blur' ||
          readingExpandMedia === 'hide_all'
            ? 'has-spoiler'
            : ''
        } ${showSpoiler ? 'show-spoiler' : ''} ${
          showSpoilerMedia ? 'show-media' : ''
        }`}
        data-content-text-weight={contentTextWeight ? textWeight() : null}
        style={
          isSizeLarge || contentTextWeight
            ? ({
                '--content-text-weight': textWeight(),
              } as CSSProperties)
            : undefined
        }
      >
        {mediaFirst && hasMediaAttachments ? (
          <>
            {(!!spoilerText || sensitive) && !readingExpandSpoilers && (
              <>
                {!!spoilerText && (
                  <span
                    className="spoiler-content media-first-spoiler-content"
                    lang={language ?? undefined}
                    dir="auto"
                    ref={spoilerContentRef}
                    data-read-more={_(readMoreText)}
                  >
                    <EmojiText text={spoilerText} />{' '}
                  </span>
                )}
                <SpoilerButton
                  id={id}
                  showSpoiler={showSpoiler}
                  readingExpandSpoilers={readingExpandSpoilers}
                  mediaFirst
                />
              </>
            )}
            <MediaFirstContainer
              mediaAttachments={mediaAttachments}
              language={language ?? undefined}
              postID={id}
              instance={instance}
            />
            {!!content && (
              <div className="media-first-content content" ref={contentRef}>
                <PostContent
                  post={status}
                  instance={instance}
                  previewMode={previewMode}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {!!spoilerText && (
              <>
                <div
                  className="content spoiler-content"
                  lang={language ?? undefined}
                  dir="auto"
                  ref={spoilerContentRef}
                  data-read-more={_(readMoreText)}
                >
                  <p>
                    <EmojiText text={spoilerText} />
                  </p>
                </div>
                {readingExpandSpoilers || previewMode ? (
                  <div className="spoiler-divider">
                    <Icon icon="eye-open" /> <Trans>Content warning</Trans>
                  </div>
                ) : (
                  <SpoilerButton
                    id={id}
                    showSpoiler={showSpoiler}
                    readingExpandSpoilers={readingExpandSpoilers}
                  />
                )}
              </>
            )}
            {!!content && (
              <div
                className="content"
                ref={contentRef}
                data-read-more={_(readMoreText)}
                inert={!!spoilerText && !showSpoiler ? true : undefined}
              >
                <PostContent
                  key={reloadPostContentCount}
                  post={status}
                  instance={instance}
                  previewMode={previewMode}
                />
              </div>
            )}
            {!!content && (
              <MathBlock
                content={content}
                contentRef={contentRef}
                onRevert={reloadPostContent}
              />
            )}
            {((!!content &&
              (enableTranslate || inlineTranslate) &&
              isTranslateble(content, emojis) &&
              differentLanguage) ||
              forceTranslate) && (
              <TranslationBlock
                forceTranslate={forceTranslate || inlineTranslate}
                mini={!isSizeLarge && !withinContext}
                sourceLanguage={language ?? undefined}
                autoDetected={!!languageAutoDetected}
                text={getPostText(status, {
                  maskCustomEmojis: true,
                  maskURLs: true,
                  hideInlineQuote: true,
                })}
              />
            )}
            <StatusMediaEmbeds
              previewMode={previewMode}
              sensitive={sensitive}
              filterInfoMaybe={filterInfoMaybe}
              readingExpandMedia={readingExpandMedia}
              readingExpandSpoilers={readingExpandSpoilers}
              spoilerText={spoilerText}
              mediaAttachments={mediaAttachments}
              showSpoilerMedia={showSpoilerMedia}
              isSizeLarge={isSizeLarge}
              withinContext={withinContext}
              size={size}
              language={language}
              instance={instance}
              id={id}
              onMediaClick={onMediaClick}
              status={status}
              showMultipleMediaCaptions={showMultipleMediaCaptions}
              captionChildren={captionChildren}
              mediaContainerRef={mediaContainerRef}
              displayedMediaAttachments={displayedMediaAttachments}
              content={content}
            />
            <QuoteStatuses
              id={id}
              instance={instance}
              level={
                quoted === true
                  ? 1
                  : typeof quoted === 'number'
                    ? quoted
                    : undefined
              }
              collapsed={!isSizeLarge && !withinContext}
              fallbackQuote={quote}
              renderStatus={(quoteStatusProps) =>
                renderStatus({
                  ...quoteStatusProps,
                  size: 's',
                  quoted: quoteStatusProps.level,
                  enableCommentHint: true,
                })
              }
            />
            {!!card?.url &&
              /^https/i.test(card.url) &&
              !sensitive &&
              !spoilerText &&
              !mediaAttachments.length &&
              !statusQuoteState && (
                <StatusCard
                  card={card}
                  selfAuthor={card?.authors?.some(
                    (a) => a.account?.url === accountURL,
                  )}
                />
              )}
            {size !== 's' && (
              <StatusTags tags={tags} content={content ?? undefined} />
            )}
          </>
        )}
      </div>
      {!isSizeLarge && (showCommentCount || showQuoteCount) && (
        <div className="content-comment-hint insignificant">
          {showCommentCount && (
            <>
              <Icon icon="comment2" alt={t`Replies`} /> {repliesCount}
            </>
          )}{' '}
          {showQuoteCount && (
            <>
              <Icon icon="quote" alt={t`Quotes`} /> {quotesCount}
            </>
          )}
        </div>
      )}
    </>
  );
}

function SpoilerButton({
  id,
  showSpoiler,
  readingExpandSpoilers,
  mediaFirst,
}: {
  id: string;
  showSpoiler: boolean;
  readingExpandSpoilers: boolean;
  mediaFirst?: boolean;
}) {
  const { t } = useLingui();
  return (
    <button
      className={[
        'light',
        'spoiler-button',
        mediaFirst ? 'media-first-spoiler-button' : '',
        showSpoiler ? 'spoiling' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (showSpoiler) {
          delete states.spoilers[id];
          if (!readingExpandSpoilers) {
            delete states.spoilersMedia[id];
          }
        } else {
          states.spoilers[id] = true;
          if (!readingExpandSpoilers) {
            states.spoilersMedia[id] = true;
          }
        }
      }}
    >
      <Icon icon={showSpoiler ? 'eye-open' : 'eye-close'} />{' '}
      {showSpoiler ? t`Show less` : t`Show content`}
    </button>
  );
}

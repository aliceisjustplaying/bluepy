import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode, RefObject } from 'react';

import states from '../utils/states';

import Icon from './icon';
import Media from './media';
import MultipleMediaFigure from './multiple-media-figure';
import type { AnyMediaAttachment, AnyStatus } from './status-types';

type FilterInfoMaybe = {
  action: 'hide' | 'blur' | 'warn';
  titlesStr?: string;
};

function mediaRoute(
  instance: string,
  id: string,
  key: 'media' | 'media-only',
  index: number,
): string {
  return `/${instance}/s/${id}?${key}=${index}`;
}

function rememberMediaSource(): void {
  const from = `${window.location.pathname}${window.location.search}`;
  window.sessionStorage.setItem('bluepy:last-feed-path', from);
  states.prevLocation = {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
  const listPage = document.querySelector<HTMLElement>('#list-page');
  if (!listPage) return;
  window.sessionStorage.setItem(
    `bluepy:feed-scroll:${from}`,
    String(listPage.scrollTop),
  );
  window.sessionStorage.setItem(
    'bluepy:last-feed-scroll',
    String(listPage.scrollTop),
  );
}

interface StatusMediaEmbedsProps {
  previewMode?: boolean;
  sensitive?: boolean | null;
  filterInfoMaybe?: FilterInfoMaybe;
  readingExpandMedia?: string;
  readingExpandSpoilers: boolean;
  spoilerText?: string | null;
  mediaAttachments: AnyMediaAttachment[];
  showSpoilerMedia: boolean;
  isSizeLarge: boolean;
  withinContext?: boolean;
  size: string;
  language?: string | null;
  instance: string;
  id: string;
  onMediaClick?: (
    e: React.MouseEvent,
    index: number,
    media: AnyMediaAttachment,
    status: AnyStatus,
  ) => void;
  status: AnyStatus;
  showMultipleMediaCaptions: boolean;
  captionChildren: ReactNode;
  mediaContainerRef: RefObject<HTMLDivElement>;
  displayedMediaAttachments: AnyMediaAttachment[];
  content?: string | null;
}

export default function StatusMediaEmbeds({
  previewMode,
  sensitive,
  filterInfoMaybe,
  readingExpandMedia,
  readingExpandSpoilers,
  spoilerText,
  mediaAttachments,
  showSpoilerMedia,
  isSizeLarge,
  withinContext,
  size,
  language,
  instance,
  id,
  onMediaClick,
  status,
  showMultipleMediaCaptions,
  captionChildren,
  mediaContainerRef,
  displayedMediaAttachments,
  content,
}: StatusMediaEmbedsProps) {
  const { t } = useLingui();

  return (
    <>
      {!previewMode &&
        (sensitive ||
          filterInfoMaybe?.action === 'blur' ||
          readingExpandMedia === 'hide_all') &&
        !!mediaAttachments.length &&
        (readingExpandMedia !== 'show_all' ||
          filterInfoMaybe?.action === 'blur') && (
          <button
            className={`plain spoiler-media-button ${
              showSpoilerMedia ? 'spoiling' : ''
            }`}
            type="button"
            hidden={!readingExpandSpoilers && !!spoilerText}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (showSpoilerMedia) {
                delete states.spoilersMedia[id];
              } else {
                states.spoilersMedia[id] = true;
              }
            }}
          >
            <Icon icon={showSpoilerMedia ? 'eye-open' : 'eye-close'} />{' '}
            <span>
              {filterInfoMaybe?.action === 'blur' && (
                <small>
                  <Trans>Filtered: {filterInfoMaybe?.titlesStr}</Trans>
                  <br />
                </small>
              )}
              {showSpoilerMedia ? t`Show less` : t`Show media`}
            </span>
          </button>
        )}
      {!!mediaAttachments.length &&
        (mediaAttachments.length > 1 &&
        (isSizeLarge || (withinContext && size === 'm')) ? (
          <div className="media-large-container">
            {mediaAttachments.map((media: AnyMediaAttachment, i: number) => (
              <div key={media.id} className={`media-container media-eq1`}>
                <Media
                  media={media}
                  autoAnimate
                  showCaption
                  allowLongerCaption={!content || isSizeLarge}
                  lang={language ?? undefined}
                  to={mediaRoute(
                    instance,
                    id,
                    withinContext ? 'media' : 'media-only',
                    i + 1,
                  )}
                  onClick={
                    onMediaClick
                      ? (e: React.MouseEvent) => {
                          onMediaClick(e, i, media, status);
                        }
                      : rememberMediaSource
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <MultipleMediaFigure
            lang={language ?? undefined}
            enabled={showMultipleMediaCaptions}
            captionChildren={captionChildren}
          >
            <div
              ref={mediaContainerRef}
              className={`media-container media-eq${mediaAttachments.length} ${
                mediaAttachments.length > 2 ? 'media-gt2' : ''
              } ${mediaAttachments.length > 4 ? 'media-gt4' : ''}`}
            >
              {displayedMediaAttachments.map(
                (media: AnyMediaAttachment, i: number) => (
                  <Media
                    key={media.id}
                    media={media}
                    autoAnimate={isSizeLarge}
                    showCaption={mediaAttachments.length === 1}
                    allowLongerCaption={
                      !content && mediaAttachments.length === 1
                    }
                    lang={language ?? undefined}
                    altIndex={
                      showMultipleMediaCaptions && !!media.description
                        ? i + 1
                        : undefined
                    }
                    to={mediaRoute(
                      instance,
                      id,
                      withinContext ? 'media' : 'media-only',
                      i + 1,
                    )}
                    onClick={
                      onMediaClick
                        ? (e: React.MouseEvent) => {
                            onMediaClick(e, i, media, status);
                          }
                        : rememberMediaSource
                    }
                    checkAspectRatio={mediaAttachments.length === 1}
                  />
                ),
              )}
            </div>
          </MultipleMediaFigure>
        ))}
    </>
  );
}

import { Trans, useLingui } from '@lingui/react/macro';
import { getBlurHashAverageColor } from 'fast-blurhash';
import type {
  ComponentChildren,
  ComponentType,
  HTMLAttributes,
  Ref,
  TargetedMouseEvent,
} from 'preact';
import { Fragment } from 'preact';
import { forwardRef, memo } from 'preact/compat';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import QuickPinchZoomImport, {
  make3dTransformValue,
} from 'react-quick-pinch-zoom';

const QuickPinchZoom = QuickPinchZoomImport as unknown as ComponentType<
  Record<string, unknown>
>;

import formatDuration from '../utils/format-duration';
import mem from '../utils/mem';
import states from '../utils/states';

import Icon from './icon';
import Link from './link';
import type { LinkProps } from './link';

const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent); // https://stackoverflow.com/a/23522755

const postViewState = () =>
  window.matchMedia('(min-width: calc(40em + 350px))').matches
    ? 'large'
    : 'small';

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => void;
};

/*
Media type
===
unknown = unsupported or unrecognized file type
image = Static image
gifv = Looping, soundless animation
video = Video clip
audio = Audio track
*/

const dataAltLabel = 'ALT';
interface AltBadgeProps {
  alt?: string | null;
  lang?: string;
  index?: number;
  [key: string]: unknown;
}
const AltBadge = (props: AltBadgeProps) => {
  const { t } = useLingui();
  const { alt, lang, index, ...rest } = props;
  if (!alt || !alt.trim()) return null;
  return (
    <button
      type="button"
      class="alt-badge clickable"
      {...(rest as HTMLAttributes<HTMLButtonElement>)}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        states.showMediaAlt = {
          alt,
          lang,
        };
      }}
      title={t`Media description`}
    >
      {dataAltLabel}
      {!!index && <sup>{index}</sup>}
    </button>
  );
};

const MEDIA_CAPTION_LIMIT = 140;
const MEDIA_CAPTION_LIMIT_LONGER = 280;
export const isMediaCaptionLong = mem((caption: string | null | undefined) =>
  caption?.length
    ? caption.length > MEDIA_CAPTION_LIMIT ||
      /[\n\r].*[\n\r]/.test(caption.trim())
    : false,
);

// https://caniuse.com/http-live-streaming
const isStreamingVideoSupported = (() => {
  try {
    const video = document.createElement('video');
    if (!video.canPlayType) return false;
    return (
      video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
      video.canPlayType('application/x-mpegURL') !== '' ||
      video.canPlayType('audio/mpegurl') !== ''
    );
  } catch {
    return false;
  }
})();

export interface MediaAttachment {
  id?: string;
  blurhash?: string | null;
  description?: string | null;
  meta?: {
    original?: { width?: number; height?: number; duration?: number };
    small?: { width?: number; height?: number };
    focus?: { x: number; y: number };
  } | null;
  previewRemoteUrl?: string | null;
  previewUrl?: string | null;
  remoteUrl?: string | null;
  url?: string | null;
  type?: string;
}

export interface MediaProps {
  class?: string;
  media: MediaAttachment;
  to?: string;
  lang?: string;
  showOriginal?: boolean;
  autoAnimate?: boolean;
  showCaption?: boolean;
  allowLongerCaption?: boolean;
  altIndex?: number;
  checkAspectRatio?: boolean;
  onClick?: (e: TargetedMouseEvent<HTMLElement>) => void;
}

interface MediaParentProps extends Record<string, unknown> {
  children?: ComponentChildren;
}

function Media({
  class: className = '',
  media,
  to,
  lang,
  showOriginal,
  autoAnimate,
  showCaption,
  allowLongerCaption,
  altIndex,
  checkAspectRatio = true,
  onClick,
}: MediaProps) {
  let {
    id,
    blurhash,
    description,
    meta,
    previewRemoteUrl,
    previewUrl,
    remoteUrl,
    url,
    type,
  } = media;
  if (previewUrl && /no-preview\./i.test(previewUrl)) {
    previewUrl = null;
  }
  const mediaVTN = getSafeViewTransitionName((id || blurhash || url) as string);
  const { original = {}, small, focus } = meta || {};

  const width = showOriginal
    ? original?.width
    : small?.width || original?.width;
  const height = showOriginal
    ? original?.height
    : small?.height || original?.height;
  const mediaURL = (showOriginal ? url : previewUrl || url) || undefined;
  const remoteMediaURL = showOriginal
    ? remoteUrl || undefined
    : previewRemoteUrl || remoteUrl || undefined;

  const hasPreviewDimensions = small?.width && small?.height;
  const hasDimensions = width && height;
  const orientation = hasDimensions
    ? width > height
      ? 'landscape'
      : 'portrait'
    : null;

  const rgbAverageColor = blurhash ? getBlurHashAverageColor(blurhash) : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  let focalPosition: string | undefined;
  if (focus) {
    // Convert focal point to CSS background position
    // Formula from jquery-focuspoint
    // x = -1, y = 1 => 0% 0%
    // x = 0, y = 0 => 50% 50%
    // x = 1, y = -1 => 100% 100%
    const x = ((focus.x + 1) / 2) * 100;
    const y = ((1 - focus.y) / 2) * 100;
    focalPosition = `${x.toFixed(0)}% ${y.toFixed(0)}%`;
  }

  const mediaRef = useRef<HTMLElement | null>(null);
  const onUpdate = useCallback(
    ({ x, y, scale }: { x: number; y: number; scale: number }) => {
      const { current: mediaEl } = mediaRef;

      if (mediaEl) {
        const value = make3dTransformValue({ x, y, scale });

        if (scale === 1) {
          mediaEl.style.removeProperty('transform');
        } else {
          mediaEl.style.setProperty('transform', value);
        }

        (mediaEl.closest('.media-zoom') as HTMLElement).style.touchAction =
          scale <= 1.01 ? 'pan-x' : '';
      }
    },
    [],
  );

  const [pinchZoomEnabled, setPinchZoomEnabled] = useState(false);
  const quickPinchZoomProps = {
    enabled: pinchZoomEnabled,
    draggableUnZoomed: false,
    inertiaFriction: 0.9,
    tapZoomFactor: 2,
    doubleTapToggleZoom: true,
    containerProps: {
      className: 'media-zoom',
      style: {
        overflow: 'visible',
        //   width: 'inherit',
        //   height: 'inherit',
        //   justifyContent: 'inherit',
        //   alignItems: 'inherit',
        //   display: 'inherit',
      },
    },
    onUpdate,
  };

  const [mediaLoadError, setMediaLoadError] = useState(false);

  const Parent = useMemo<ComponentType<MediaParentProps>>(
    () => {
      if (to && !mediaLoadError) {
        return forwardRef<HTMLElement, MediaParentProps>((props, ref) => (
          <Link
            to={to}
            {...(props as Omit<LinkProps, 'to'>)}
            ref={ref as Ref<HTMLAnchorElement>}
          />
        ));
      }
      return forwardRef<HTMLElement, MediaParentProps>((props, ref) => (
        <div
          {...(props as HTMLAttributes<HTMLDivElement>)}
          ref={ref as Ref<HTMLDivElement>}
        />
      ));
    },
    [to, mediaLoadError],
  );

  const remoteMediaURLObj = remoteMediaURL ? getURLObj(remoteMediaURL) : null;
  const isVideoMaybe =
    type === 'unknown' &&
    remoteMediaURLObj &&
    /\.(mp4|m4r|m4v|mov|webm)$/i.test(remoteMediaURLObj.pathname);
  const isStreamingVideoMaybe =
    remoteMediaURLObj &&
    /\.m3u8$/i.test(remoteMediaURLObj.pathname) &&
    isStreamingVideoSupported;
  const isAudioMaybe =
    type === 'unknown' &&
    remoteMediaURLObj &&
    /\.(mp3|ogg|wav|m4a|m4p|m4b)$/i.test(remoteMediaURLObj.pathname);
  const isImage =
    type === 'image' ||
    (type === 'unknown' &&
      previewUrl &&
      !isVideoMaybe &&
      !isStreamingVideoMaybe &&
      !isAudioMaybe);
  const isPreviewVideoMaybe =
    (previewUrl &&
      /\.(mp4|m4r|m4v|mov|webm)$/i.test(
        (getURLObj(previewUrl) as URL).pathname,
      )) ||
    isStreamingVideoMaybe;

  const parentRef = useRef<HTMLElement | null>(null);
  const [imageSmallerThanParent, setImageSmallerThanParent] = useState(false);
  useLayoutEffect(() => {
    if (!isImage) return;
    if (!showOriginal) return;
    if (!parentRef.current) return;
    const { offsetWidth, offsetHeight } = parentRef.current;
    const smaller =
      (width as number) < offsetWidth && (height as number) < offsetHeight;
    if (smaller) setImageSmallerThanParent(smaller);
  }, [width, height, isImage, showOriginal]);

  const maxAspectHeight =
    window.innerHeight * (orientation === 'portrait' ? 0.45 : 0.33);
  const maxHeight = orientation === 'portrait' ? 0 : 160;
  const averageColorStyle = {
    '--average-color': rgbAverageColor && `rgb(${rgbAverageColor.join(',')})`,
  };
  const mediaStyles =
    width && height
      ? {
          '--width': `${width}px`,
          '--height': `${height}px`,
          // Calculate '--aspectWidth' based on aspect ratio calculated from '--width' and '--height', max height has to be 160px
          '--aspectWidth': `${
            (width / height) * Math.max(maxHeight, maxAspectHeight)
          }px`,
          aspectRatio: `${width} / ${height}`,
          ...averageColorStyle,
        }
      : {
          ...averageColorStyle,
        };

  const longDesc = isMediaCaptionLong(description);
  let showInlineDesc =
    !!showCaption && !showOriginal && !!description && !longDesc;
  if (
    allowLongerCaption &&
    !showInlineDesc &&
    (description?.length as number) <= MEDIA_CAPTION_LIMIT_LONGER
  ) {
    showInlineDesc = true;
  }
  const Figure: ComponentType<{ children?: ComponentChildren }> =
    !showInlineDesc
      ? (Fragment as ComponentType<{
          children?: ComponentChildren;
        }>)
      : (props: { children?: ComponentChildren }) => {
          const { children, ...restProps } = props;
          return (
            <figure {...(restProps as HTMLAttributes<HTMLElement>)}>
              {children}
              {/* TODO(oxlint:jsx-a11y/no-noninteractive-tabindex,click-events-have-key-events):
                  figcaption serves the dual role of semantic caption and an
                  interactive "expand alt text" surface. We keep the figcaption
                  for its figure-semantics and add keyboard support. Converting
                  to <button> would lose the figure semantics and require CSS
                  rework around .media-caption. */}
              <figcaption
                class="media-caption"
                lang={lang}
                dir="auto"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  states.showMediaAlt = {
                    alt: description,
                    lang,
                  };
                }}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    states.showMediaAlt = {
                      alt: description,
                      lang,
                    };
                  }
                }}
              >
                {description}
              </figcaption>
            </figure>
          );
        };

  const interceptOnClick = useCallback(
    (e: TargetedMouseEvent<HTMLElement>) => {
      const target = e.target as Element;
      const isOnPostPage = target.closest('.status-deck');
      const startViewTransition = (document as ViewTransitionDocument)
        .startViewTransition?.bind(document);
      if (
        showOriginal ||
        (postViewState() === 'large' && isOnPostPage) ||
        !startViewTransition
      ) {
        onClick?.(e);
        return;
      }
      const el =
        target.closest<HTMLElement>('[data-view-transition-name]') ||
        target.querySelector<HTMLElement>('[data-view-transition-name]');
      if (el) {
        // BUG: both link and onClick is triggered at the same time
        // Temporarily disable view transition if has onClick
        // Detecting preventDefault for an onClick has to happen before view transition but it's only possible after click, and this mean the link is already clicked even before we know it's default prevented.
        if (onClick) {
          onClick(e);
        } else {
          e.preventDefault();
          if (el.dataset.viewTransitioned) {
            el.style.viewTransitionName = mediaVTN;
            try {
              startViewTransition(() => {
                el.style.viewTransitionName = '';
                location.hash = `#${to}`;
              });
            } catch (err) {
              console.error(err);
              el.style.viewTransitionName = '';
              location.hash = `#${to}`;
            }
          } else {
            location.hash = `#${to}`;
          }
        }
      } else {
        onClick?.(e);
      }
    },
    [mediaVTN, showOriginal, onClick, to],
  );

  useLayoutEffect(() => {
    if (!isImage) return;
    if (!isSafari) return;
    if (!showOriginal) return;
    void (async () => {
      try {
        await fetch(mediaURL as string, { mode: 'no-cors' });
        (mediaRef.current as HTMLImageElement).src = mediaURL as string;
      } catch {
        // Ignore
      }
    })();
  }, [mediaURL, isImage, showOriginal]);

  if (isImage) {
    // Note: type: unknown might not have width/height
    (
      quickPinchZoomProps.containerProps.style as Record<string, unknown>
    ).display = 'inherit';

    return (
      <Figure>
        <Parent
          ref={parentRef}
          class={`media media-image ${className}`}
          onClick={interceptOnClick}
          data-orientation={orientation}
          data-has-alt={!showInlineDesc || undefined}
          style={
            showOriginal
              ? {
                  backgroundImage: `url(${previewUrl})`,
                  '--bg-image': `url(${previewUrl})`,
                  backgroundSize: imageSmallerThanParent
                    ? `${width}px ${height}px`
                    : undefined,
                  ...averageColorStyle,
                }
              : mediaStyles
          }
        >
          {showOriginal ? (
            <QuickPinchZoom {...quickPinchZoomProps}>
              <img
                ref={mediaRef as Ref<HTMLImageElement>}
                src={mediaURL}
                alt={description as string | undefined}
                width={width}
                height={height}
                data-orientation={orientation}
                loading="eager"
                decoding="sync"
                style={{
                  'view-transition-name': mediaVTN,
                }}
                onLoad={(e) => {
                  const el = e.target as HTMLImageElement;
                  const mediaImage = el.closest<HTMLElement>('.media-image');
                  if (mediaImage) {
                    mediaImage.style.backgroundImage = `url(${el.src})`;
                    mediaImage.style.removeProperty('--bg-image');
                  }
                  (el.closest('.media-zoom') as HTMLElement).style.display = '';
                  setPinchZoomEnabled(true);
                }}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  const { src } = target;
                  if (
                    src === mediaURL &&
                    remoteMediaURL &&
                    mediaURL !== remoteMediaURL
                  ) {
                    target.src = remoteMediaURL;
                  }
                }}
              />
            </QuickPinchZoom>
          ) : (
            <>
              <img
                src={mediaURL}
                alt={showInlineDesc ? '' : (description as string | undefined)}
                width={width}
                height={height}
                data-orientation={orientation}
                loading="lazy"
                data-view-transition-name={mediaVTN}
                style={{
                  // backgroundColor:
                  //   rgbAverageColor && `rgb(${rgbAverageColor.join(',')})`,
                  // backgroundPosition: focalBackgroundPosition || 'center',
                  // Duration based on width or height in pixels
                  objectPosition: focalPosition || 'center',
                  // 100px per second (rough estimate)
                  // Clamp between 5s and 120s
                  '--anim-duration': `${Math.min(
                    Math.max(
                      Math.max(width as number, height as number) / 100,
                      5,
                    ),
                    120,
                  )}s`,
                }}
                onLoad={(e) => {
                  // e.target.closest('.media-image').style.backgroundImage = '';
                  const target = e.target as HTMLImageElement;
                  (target.dataset as Record<string, string>).loaded = 'true';
                  const $media = target.closest<HTMLElement>('.media');
                  if (!hasPreviewDimensions && $media) {
                    const { naturalWidth, naturalHeight } = target;
                    $media.dataset.orientation =
                      naturalWidth > naturalHeight ? 'landscape' : 'portrait';
                    $media.style.setProperty('--width', `${naturalWidth}px`);
                    $media.style.setProperty('--height', `${naturalHeight}px`);
                    $media.style.aspectRatio = `${naturalWidth}/${naturalHeight}`;
                  }

                  // Check natural aspect ratio vs display aspect ratio
                  if (checkAspectRatio && $media) {
                    setTimeout(() => {
                      const {
                        clientWidth,
                        clientHeight,
                        naturalWidth,
                        naturalHeight,
                      } = target;
                      if (
                        clientWidth &&
                        clientHeight &&
                        naturalWidth &&
                        naturalHeight
                      ) {
                        const minDimension = 88;
                        if (
                          naturalWidth < minDimension ||
                          naturalHeight < minDimension
                        ) {
                          (
                            $media.dataset as Record<string, string>
                          ).hasSmallDimension = 'true';
                        } else {
                          const displayNaturalHeight =
                            (naturalHeight * clientWidth) / naturalWidth;
                          const almostSimilarHeight =
                            Math.abs(displayNaturalHeight - clientHeight) < 5;

                          if (almostSimilarHeight) {
                            const $mediaParent =
                              $media.closest<HTMLElement>('.media');
                            if ($mediaParent) {
                              (
                                $mediaParent.dataset as Record<string, string>
                              ).hasNaturalAspectRatio = 'true';
                            }
                          }
                        }
                      }
                    }, 300);
                  }
                }}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  const { src } = target;
                  if (
                    src === mediaURL &&
                    remoteMediaURL &&
                    mediaURL !== remoteMediaURL
                  ) {
                    target.src = remoteMediaURL;
                  } else {
                    setMediaLoadError(true);
                  }
                }}
              />
              {!showInlineDesc && (
                <AltBadge alt={description} lang={lang} index={altIndex} />
              )}
            </>
          )}
        </Parent>
        {mediaLoadError && (
          <div>
            <a
              href={remoteUrl as string | undefined}
              class="button plain6 small"
              target="_blank"
            >
              <Icon icon="external" />{' '}
              <span>
                <Trans>Open file</Trans>
              </span>
            </a>
          </div>
        )}
      </Figure>
    );
  } else if (
    type === 'gifv' ||
    type === 'video' ||
    isVideoMaybe ||
    isStreamingVideoMaybe
  ) {
    const duration = original.duration as number;
    const hasDuration = duration > 0;
    const shortDuration = duration < 31;
    const isGIF = type === 'gifv' && shortDuration;
    // If GIF is too long, treat it as a video
    const loopable = duration < 61;
    const formattedDuration = formatDuration(duration);
    const hoverAnimate = !showOriginal && !autoAnimate && isGIF;
    const autoGIFAnimate = !showOriginal && autoAnimate && isGIF;
    const showProgress = duration > 5;

    // This string is only for autoplay + muted to work on Mobile Safari
    const gifHTML = `
      <video
        src="${url}"
        poster="${previewUrl}"
        width="${width}"
        height="${height}"
        data-orientation="${orientation}"
        style="view-transition-name: ${mediaVTN}"
        preload="auto"
        autoplay
        muted
        playsinline
        ${loopable ? 'loop' : ''}
        ondblclick="this.paused ? this.play() : this.pause()"
        ${
          showProgress
            ? "ontimeupdate=\"this.closest('.media-gif') && this.closest('.media-gif').style.setProperty('--progress', `${~~((this.currentTime / this.duration) * 100)}%`)\""
            : ''
        }
      ></video>
  `;

    const videoURL = isStreamingVideoMaybe ? remoteMediaURL : url;
    const videoHTML = `
      <video
        src="${videoURL}"
        poster="${previewUrl}"
        width="${width}"
        height="${height}"
        data-orientation="${orientation}"
        style="view-transition-name: ${mediaVTN}"
        preload="auto"
        autoplay
        playsinline
        ${loopable ? 'loop' : ''}
        controls
      ></video>
    `;

    return (
      <Figure>
        <Parent
          ref={parentRef}
          class={`media ${className} media-${isGIF ? 'gif' : 'video'} ${
            autoGIFAnimate ? 'media-contain' : ''
          } ${hoverAnimate ? 'media-hover-animate' : ''}`}
          data-orientation={orientation}
          data-formatted-duration={
            !showOriginal ? formattedDuration : undefined
          }
          data-label={
            isGIF && !showOriginal && !autoGIFAnimate ? 'GIF' : undefined
          }
          data-has-alt={!showInlineDesc || undefined}
          // style={{
          //   backgroundColor:
          //     rgbAverageColor && `rgb(${rgbAverageColor.join(',')})`,
          // }}
          style={!showOriginal ? mediaStyles : undefined}
          onClick={(e: TargetedMouseEvent<HTMLElement>) => {
            if (hoverAnimate) {
              try {
                videoRef.current?.pause();
              } catch {}
            }
            interceptOnClick(e);
          }}
          onMouseEnter={() => {
            if (hoverAnimate) {
              try {
                void videoRef.current?.play();
              } catch {}
            }
          }}
          onMouseLeave={() => {
            if (hoverAnimate) {
              try {
                videoRef.current?.pause();
              } catch {}
            }
          }}
          onFocus={() => {
            if (hoverAnimate) {
              try {
                void videoRef.current?.play();
              } catch {}
            }
          }}
          onBlur={() => {
            if (hoverAnimate) {
              try {
                videoRef.current?.pause();
              } catch {}
            }
          }}
        >
          {showOriginal || autoGIFAnimate ? (
            isGIF && showOriginal ? (
              <QuickPinchZoom {...quickPinchZoomProps} enabled>
                <div
                  ref={mediaRef as Ref<HTMLDivElement>}
                  dangerouslySetInnerHTML={{
                    __html: gifHTML,
                  }}
                />
              </QuickPinchZoom>
            ) : isGIF ? (
              <div
                class="video-container"
                dangerouslySetInnerHTML={{
                  __html: gifHTML,
                }}
              />
            ) : (
              <div
                class="video-container"
                dangerouslySetInnerHTML={{ __html: videoHTML }}
              />
            )
          ) : isGIF ? (
            <video
              ref={videoRef}
              src={url ?? undefined}
              poster={previewUrl as string | undefined}
              width={width}
              height={height}
              data-orientation={orientation}
              data-view-transition-name={mediaVTN}
              preload="auto"
              // controls
              playsinline
              loop
              muted
              onTimeUpdate={
                showProgress
                  ? (e) => {
                      const target = e.target as HTMLVideoElement | null;
                      const container = target?.closest(
                        '.media-gif',
                      ) as HTMLElement | null;
                      if (container && target) {
                        const percentage =
                          (target.currentTime / target.duration) * 100;
                        container.style.setProperty(
                          '--progress',
                          `${percentage}%`,
                        );
                      }
                    }
                  : undefined
              }
            />
          ) : (
            <>
              {previewUrl && !isPreviewVideoMaybe ? (
                <img
                  src={previewUrl}
                  alt={
                    showInlineDesc ? '' : (description as string | undefined)
                  }
                  width={width}
                  height={height}
                  data-orientation={orientation}
                  loading="lazy"
                  decoding="async"
                  data-view-transition-name={mediaVTN}
                  onLoad={(e) => {
                    if (!hasPreviewDimensions) {
                      const target = e.target as HTMLImageElement;
                      const $media = target.closest<HTMLElement>('.media');
                      if ($media) {
                        const { naturalHeight, naturalWidth } = target;
                        $media.dataset.orientation =
                          naturalWidth > naturalHeight
                            ? 'landscape'
                            : 'portrait';
                        $media.style.setProperty(
                          '--width',
                          `${naturalWidth}px`,
                        );
                        $media.style.setProperty(
                          '--height',
                          `${naturalHeight}px`,
                        );
                        $media.style.aspectRatio = `${naturalWidth}/${naturalHeight}`;
                      }
                    }
                  }}
                />
              ) : (
                <video
                  src={videoURL + '#t=0.1'} // Make Safari show 1st-frame preview
                  width={width}
                  height={height}
                  data-orientation={orientation}
                  data-view-transition-name={mediaVTN}
                  preload="metadata"
                  muted
                  disablePictureInPicture
                  onLoadedMetadata={(e) => {
                    if (!hasDuration) {
                      const target = e.target as HTMLVideoElement;
                      const { duration: targetDuration } = target;
                      if (targetDuration) {
                        const loadedDuration = formatDuration(targetDuration);
                        const container =
                          target.closest<HTMLElement>('.media-video');
                        if (container) {
                          container.dataset.formattedDuration = loadedDuration;
                        }
                      }
                    }
                  }}
                />
              )}
              <div class="media-play">
                <Icon icon="play" size="xl" alt="▶" />
              </div>
            </>
          )}
          {!showOriginal && !showInlineDesc && (
            <AltBadge alt={description} lang={lang} index={altIndex} />
          )}
        </Parent>
      </Figure>
    );
  } else if (type === 'audio' || isAudioMaybe) {
    const formattedDuration = formatDuration(original.duration);
    return (
      <Figure>
        <Parent
          class={`media media-audio ${className}`}
          data-formatted-duration={
            !showOriginal ? formattedDuration : undefined
          }
          data-has-alt={!showInlineDesc || undefined}
          onClick={onClick}
          style={!showOriginal ? mediaStyles : undefined}
        >
          {showOriginal ? (
            previewUrl ? (
              // TODO(oxlint:jsx-a11y/media-has-caption): Mastodon's media
              // model does not surface caption tracks; alt-text is exposed
              // separately via the figcaption above. Inserting an empty
              // <track src=""> would advertise a non-existent captions file.
              <video
                src={remoteUrl || url ? `${remoteUrl || url}#t=0.1` : undefined}
                width={width}
                height={height}
                data-orientation={orientation}
                poster={previewUrl}
                style={{
                  background: `url(${previewUrl}) center/cover`,
                  aspectRatio: `${width}/${height}`,
                }}
                preload="metadata"
                controls
                controlsList="nofullscreen"
                autoPlay
                playsInline
              />
            ) : (
              // TODO(oxlint:jsx-a11y/media-has-caption): see note on <video>
              // above; alt-text is surfaced via the figcaption.
              <audio
                src={remoteUrl || url || undefined}
                preload="none"
                controls
                autoPlay
              />
            )
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt={showInlineDesc ? '' : (description as string | undefined)}
              width={width}
              height={height}
              data-orientation={orientation}
              loading="lazy"
              onError={(e) => {
                try {
                  // Remove self if broken
                  (e.target as HTMLImageElement | null)?.remove?.();
                } catch {}
              }}
            />
          ) : null}
          {!showOriginal && (
            <>
              <div class="media-play">
                <Icon icon="play" size="xl" alt="▶" />
              </div>
              {!showInlineDesc && (
                <AltBadge alt={description} lang={lang} index={altIndex} />
              )}
            </>
          )}
        </Parent>
      </Figure>
    );
  }
  return null;
}

function getURLObj(url: string) {
  // Fake base URL if url doesn't have https:// prefix
  return URL.parse(url, location.origin);
}

export function getSafeViewTransitionName(inputString: string) {
  // Replace any character that is not a letter, number, hyphen, or underscore with a hyphen.
  let safeName = inputString.replace(/[^a-zA-Z0-9_-]/g, '-');

  // Ensure it starts with a letter, underscore, or two hyphens (to prevent starting with a number or single hyphen).
  // This covers edge cases where the original string might start with an invalid character after replacement.
  if (safeName.match(/^[0-9-]/)) {
    safeName = 'vt-' + safeName;
  }

  return safeName;
}

export default memo(Media, (oldProps, newProps) => {
  const oldMedia = oldProps.media || {};
  const newMedia = newProps.media || {};

  return (
    oldMedia?.id === newMedia?.id &&
    oldMedia.url === newMedia.url &&
    oldProps.to === newProps.to &&
    oldProps.class === newProps.class
  );
});

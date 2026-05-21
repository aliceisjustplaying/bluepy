import { Trans, useLingui } from '@lingui/react/macro';
import { MenuDivider, MenuItem } from '@szhsin/react-menu';
import { getBlurHashAverageColor } from 'fast-blurhash';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { oklch2rgb, rgb2oklch } from '../utils/color-utils';
import isRTL from '../utils/is-rtl';
import showToast from '../utils/show-toast';
import states from '../utils/states';
import store from '../utils/store';

import Icon from './icon';
import Link from './link';
import Media from './media';
import MenuLink from './menu-link';
import Menu2 from './menu2';

const { PHANPY_IMG_ALT_API_URL: IMG_ALT_API_URL } = import.meta.env;

interface MediaAttachment {
  id: string;
  blurhash?: string | null;
  description?: string | null;
  type?: string;
  url?: string | null;
  remoteUrl?: string | null;
  [key: string]: unknown;
}

interface ToastHandle {
  showToast(): void;
  hideToast(): void;
}

type RGB = readonly number[];

interface AccentColor {
  light: RGB;
  dark: RGB;
  default: RGB;
}

type CarouselCloseHandler = (
  e?: unknown,
  currentIndex?: number,
  mediaAttachments?: MediaAttachment[],
  carouselRef?: { current: HTMLElement | null },
) => void;

export interface MediaModalProps {
  mediaAttachments: MediaAttachment[];
  statusID?: string;
  instance?: string;
  lang?: string;
  index?: number;
  onClose?: CarouselCloseHandler;
}

function MediaModal({
  mediaAttachments,
  statusID,
  instance,
  lang,
  index = 0,
  onClose = () => {},
}: MediaModalProps) {
  const { t } = useLingui();
  const [uiState, setUIState] = useState<'default' | 'loading'>('default');
  const carouselRef = useRef<HTMLElement | null>(null);

  const [currentIndex, setCurrentIndex] = useState(index);
  const carouselFocusItem = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    carouselFocusItem.current?.scrollIntoView();

    // history.pushState({ mediaModal: true }, '');
    // const handlePopState = (e) => {
    //   if (e.state?.mediaModal) {
    //     onClose();
    //   }
    // };
    // window.addEventListener('popstate', handlePopState);
    // return () => {
    //   window.removeEventListener('popstate', handlePopState);
    // };
  }, []);
  const prevStatusID = useRef(statusID);
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const scrollLeft = index * carousel.clientWidth;
    const differentStatusID = prevStatusID.current !== statusID;
    if (differentStatusID) prevStatusID.current = statusID;
    carousel.focus();
    carousel.scrollTo({
      left: scrollLeft * (isRTL() ? -1 : 1),
      behavior: differentStatusID ? 'auto' : 'smooth',
    });
  }, [index, statusID]);

  const [showControls, setShowControls] = useState(true);
  const closeFromSwipe = useEffectEvent((e: Event) => {
    onClose(e, currentIndex, mediaAttachments, carouselRef);
  });

  useEffect(() => {
    const handleSwipe = (e: Event) => {
      closeFromSwipe(e);
    };
    const carousel = carouselRef.current;
    if (carousel) {
      carousel.addEventListener('swiped-down', handleSwipe);
    }
    return () => {
      if (carousel) {
        carousel.removeEventListener('swiped-down', handleSwipe);
      }
    };
  }, []);

  useHotkeys(
    'esc',
    (e) => {
      onClose(e, currentIndex, mediaAttachments, carouselRef);
    },
    {
      ignoreEventWhen: (e) => {
        const hasModal = !!document.querySelector('#modal-container > *');
        return hasModal || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
      useKey: true,
    },
    [onClose, currentIndex, mediaAttachments],
  );

  useEffect(() => {
    const handleScroll = () => {
      const { clientWidth, scrollLeft } = carouselRef.current ?? {
        clientWidth: 1,
        scrollLeft: 0,
      };
      const nextIndex = Math.round(Math.abs(scrollLeft) / clientWidth);
      setCurrentIndex(nextIndex);
    };
    const carousel = carouselRef.current;
    if (carousel) {
      carousel.addEventListener('scroll', handleScroll, {
        passive: true,
      });
    }
    return () => {
      if (carousel) {
        carousel.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    let timer = setTimeout(() => {
      carouselRef.current?.focus?.();
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const mediaOkColors = useMemo(() => {
    return mediaAttachments?.map((media: MediaAttachment) => {
      const { blurhash } = media;
      if (blurhash) {
        const averageColor = getBlurHashAverageColor(blurhash);
        return rgb2oklch(averageColor) as readonly number[];
      }
      return null;
    });
  }, [mediaAttachments]);
  const mediaAccentColors = useMemo(() => {
    return mediaOkColors?.map((okColor: readonly number[] | null) => {
      if (okColor) {
        return {
          light: oklch2rgb([0.95, 0.01, okColor[2]]),
          dark: oklch2rgb([0.35, 0.01, okColor[2]]),
          default: oklch2rgb([0.6, okColor[1], okColor[2]]),
        } satisfies AccentColor;
      }
      return null;
    });
  }, [mediaOkColors]);
  const mediaAccentGradients = useMemo(() => {
    const gap = 5;
    const range = 100 / mediaAccentColors.length;
    const colors = mediaAccentColors.map((color, i) => {
      const start = i * range + gap;
      const end = (i + 1) * range - gap;
      if (color?.light && color?.dark) {
        return {
          light: `
                rgb(${color.light?.join(',')}) ${start}%, 
                rgb(${color.light?.join(',')}) ${end}%
              `,
          dark: `
                rgb(${color.dark?.join(',')}) ${start}%, 
                rgb(${color.dark?.join(',')}) ${end}%
              `,
        };
      }

      return {
        light: `
              transparent ${start}%, 
              transparent ${end}%
            `,
        dark: `
              transparent ${start}%, 
              transparent ${end}%
            `,
      };
    });
    const lightGradient = colors.map((color) => color.light).join(', ');
    const darkGradient = colors.map((color) => color.dark).join(', ');
    return {
      light: lightGradient,
      dark: darkGradient,
    };
  }, [mediaAccentColors]);

  const toastRef = useRef<ToastHandle | null>(null);
  useEffect(() => {
    return () => {
      toastRef.current?.hideToast?.();
    };
  }, []);

  useLayoutEffect(() => {
    const currentColor = mediaAccentColors[currentIndex];
    let $meta: HTMLMetaElement | null | undefined;
    let metaColor: string | undefined;
    if (currentColor) {
      const theme = store.local.get('theme') as 'light' | 'dark' | null;
      if (theme) {
        const mediaColor = `rgb(${currentColor[theme].join(',')})`;
        console.log({ mediaColor });
        $meta = document.querySelector<HTMLMetaElement>(
          `meta[name="theme-color"][data-theme-setting="manual"]`,
        );
        if ($meta) {
          metaColor = $meta.content;
          $meta.content = mediaColor;
        }
        document.documentElement.style.setProperty(
          '--meta-theme-color',
          mediaColor,
        );
      } else {
        const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
          .matches
          ? 'dark'
          : 'light';
        const mediaColor = `rgb(${currentColor[colorScheme].join(',')})`;
        console.log({ mediaColor });
        $meta = document.querySelector<HTMLMetaElement>(
          `meta[name="theme-color"][media*="${colorScheme}"]`,
        );
        if ($meta) {
          metaColor = $meta.content;
          $meta.content = mediaColor;
        }
        document.documentElement.style.setProperty(
          '--meta-theme-color',
          mediaColor,
        );
      }
    }
    return () => {
      // Reset meta color
      if ($meta && metaColor) {
        $meta.content = metaColor;
      }
      document.documentElement.style.removeProperty('--meta-theme-color');
    };
  }, [currentIndex, mediaAccentColors]);

  return (
    <div
      className={`media-modal-container media-modal-count-${mediaAttachments?.length}`}
    >
      {/* TODO(oxlint:jsx-a11y/no-noninteractive-tabindex): the carousel is a
          horizontal scroll surface that needs focus for keyboard scrolling and
          backdrop dismissal. */}
      <section
        ref={carouselRef}
        aria-label="Media carousel"
        tabIndex={0}
        data-swipe-threshold="44"
        className="carousel"
        onClick={(e) => {
          const target = e.target;
          if (!(target instanceof HTMLElement)) return;
          if (
            target.classList.contains('carousel-item') ||
            target.classList.contains('media') ||
            target.classList.contains('media-zoom')
          ) {
            onClose(e, currentIndex, mediaAttachments, carouselRef);
          }
        }}
        onKeyDown={(e) => {
          // Backdrop dismissal via Enter/Space when the focus lies on the
          // carousel surface itself (not media controls). Mirrors the
          // backdrop click handler.
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          onClose(e, currentIndex, mediaAttachments, carouselRef);
        }}
        style={
          mediaAttachments.length > 1
            ? {
                backgroundAttachment: 'local',
                '--accent-gradient-light': mediaAccentGradients?.light,
                '--accent-gradient-dark': mediaAccentGradients?.dark,
                //     backgroundImage: `linear-gradient(
                // to ${isRTL() ? 'left' : 'right'}, ${mediaAccentGradient})`,
              }
            : {}
        }
      >
        {mediaAttachments?.map((media: MediaAttachment, i: number) => {
          const accentColor =
            mediaAttachments.length === 1 ? mediaAccentColors[i] : null;
          return (
            <div
              className="carousel-item"
              role="group"
              style={
                accentColor
                  ? {
                      '--accent-color': `rgb(${accentColor.default.join(',')})`,
                      '--accent-light-color': `rgb(${accentColor.light?.join(
                        ',',
                      )})`,
                      '--accent-dark-color': `rgb(${accentColor.dark?.join(
                        ',',
                      )})`,
                      '--accent-alpha-color': `rgba(${accentColor.default.join(
                        ',',
                      )}, 0.4)`,
                    }
                  : {}
              }
              tabIndex={0}
              key={media.id}
              ref={i === currentIndex ? carouselFocusItem : null}
              onClick={(e) => {
                // console.log(e);
                // if (e.target !== e.currentTarget) {
                //   setShowControls(!showControls);
                // }
                const target = e.target;
                if (
                  target instanceof HTMLElement &&
                  !target.classList.contains('media')
                ) {
                  setShowControls(!showControls);
                }
              }}
              onKeyDown={(e) => {
                // Toggle overlay controls via Enter/Space when focus is on
                // the carousel-item itself, mirroring the click handler.
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.target !== e.currentTarget) return;
                const target = e.target;
                if (
                  target instanceof HTMLElement &&
                  !target.classList.contains('media')
                ) {
                  e.preventDefault();
                  setShowControls(!showControls);
                }
              }}
            >
              {!!media.description && (
                <button
                  type="button"
                  className="media-alt"
                  hidden={!showControls}
                  onClick={() => {
                    states.showMediaAlt = {
                      alt: media.description,
                      lang,
                    };
                  }}
                >
                  <span className="alt-badge">ALT</span>
                  <span className="media-alt-desc" lang={lang} dir="auto">
                    {media.description}
                  </span>
                </button>
              )}
              <Media media={media} showOriginal lang={lang} />
            </div>
          );
        })}
      </section>
      <div className="carousel-top-controls" hidden={!showControls}>
        <span>
          <button
            type="button"
            className="carousel-button"
            onClick={(e) => {
              onClose(e, currentIndex, mediaAttachments, carouselRef);
            }}
          >
            <Icon icon="x" alt={t`Close`} />
          </button>
        </span>
        {mediaAttachments?.length > 1 ? (
          <span className="carousel-dots">
            {mediaAttachments?.map((media: MediaAttachment, i: number) => (
              <button
                key={media.id}
                type="button"
                disabled={i === currentIndex}
                className={`carousel-dot ${i === currentIndex ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const carousel = carouselRef.current;
                  if (!carousel) return;
                  const left = carousel.clientWidth * i * (isRTL() ? -1 : 1);
                  carousel.focus();
                  carousel.scrollTo({ left, behavior: 'smooth' });
                }}
              >
                <Icon icon="round" size="s" alt="⸱" />
              </button>
            ))}
          </span>
        ) : (
          <span />
        )}
        <span>
          <Menu2
            overflow="auto"
            align="end"
            position="anchor"
            gap={4}
            menuClassName="glass-menu"
            menuButton={
              <button type="button" className="carousel-button">
                <Icon icon="more2" alt={t`More`} />
              </button>
            }
          >
            <MenuLink
              href={
                mediaAttachments[currentIndex]?.remoteUrl ||
                mediaAttachments[currentIndex]?.url ||
                undefined
              }
              className="carousel-button"
              target="_blank"
              title={t`Open original media in new window`}
            >
              <Icon icon="popout" />
              <span>
                <Trans>Open original media</Trans>
              </span>
            </MenuLink>
            {import.meta.env.DEV && // Only dev for now
              states.settings.mediaAltGenerator &&
              !!IMG_ALT_API_URL &&
              !!mediaAttachments[currentIndex]?.url &&
              !mediaAttachments[currentIndex]?.description &&
              mediaAttachments[currentIndex]?.type === 'image' && (
                <>
                  <MenuDivider />
                  <MenuItem
                    disabled={uiState === 'loading'}
                    onClick={() => {
                      const currentUrl = mediaAttachments[currentIndex]?.url;
                      if (typeof currentUrl !== 'string') return;
                      setUIState('loading');
                      toastRef.current = showToast({
                        text: t`Attempting to describe image. Please wait…`,
                        duration: -1,
                      });
                      void (async function () {
                        try {
                          const response: unknown = await fetch(
                            `${IMG_ALT_API_URL}?image=${encodeURIComponent(
                              currentUrl,
                            )}`,
                          ).then((r) => r.json());
                          const description =
                            response &&
                            typeof response === 'object' &&
                            'description' in response &&
                            typeof response.description === 'string'
                              ? response.description
                              : '';
                          states.showMediaAlt = {
                            alt: description,
                          };
                        } catch (e) {
                          console.error(e);
                          showToast(t`Failed to describe image`);
                        } finally {
                          setUIState('default');
                          toastRef.current?.hideToast?.();
                        }
                      })();
                    }}
                  >
                    <Icon icon="sparkles2" />
                    <span>
                      <Trans>Describe image…</Trans>
                    </span>
                  </MenuItem>
                </>
              )}
          </Menu2>{' '}
          {!!statusID && (
            <Link
              to={`${instance ? `/${instance}` : ''}/s/${statusID}${
                window.matchMedia('(min-width: calc(40em + 350px))').matches
                  ? `?media=${currentIndex + 1}`
                  : ''
              }`}
              className="button carousel-button media-post-link"
              // onClick={() => {
              //   // if small screen (not media query min-width 40em + 350px), run onClose
              //   if (
              //     !window.matchMedia('(min-width: calc(40em + 350px))').matches
              //   ) {
              //     onClose();
              //   }
              // }}
            >
              <span className="button-label">
                <Trans>View post</Trans>{' '}
              </span>
              &raquo;
            </Link>
          )}
        </span>
      </div>
      {mediaAttachments?.length > 1 && (
        <div className="carousel-controls" hidden={!showControls}>
          <button
            type="button"
            className="carousel-button"
            hidden={currentIndex === 0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const carousel = carouselRef.current;
              if (!carousel) return;
              carousel.focus();
              carousel.scrollTo({
                left:
                  carousel.clientWidth *
                  (currentIndex - 1) *
                  (isRTL() ? -1 : 1),
                behavior: 'smooth',
              });
            }}
          >
            <Icon icon="arrow-left" alt={t`Previous`} />
          </button>
          <button
            type="button"
            className="carousel-button"
            hidden={currentIndex === mediaAttachments.length - 1}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const carousel = carouselRef.current;
              if (!carousel) return;
              carousel.focus();
              carousel.scrollTo({
                left:
                  carousel.clientWidth *
                  (currentIndex + 1) *
                  (isRTL() ? -1 : 1),
                behavior: 'smooth',
              });
            }}
          >
            <Icon icon="arrow-right" alt={t`Next`} />
          </button>
        </div>
      )}
    </div>
  );
}

export default MediaModal;

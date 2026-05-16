import { Trans, useLingui } from '@lingui/react/macro';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import poweredByGiphyURL from '../assets/powered-by-giphy.svg';

import Icon from './icon';
import Loader from './loader';

const { PHANPY_GIPHY_API_KEY: GIPHY_API_KEY } = import.meta.env;

const GIFS_PER_PAGE = 20;

interface GiphyImage {
  url: string;
  webp?: string;
  mp4?: string;
  width: number | string;
  height: number | string;
}

interface GiphyImages {
  fixed_height_small?: GiphyImage;
  fixed_height_downsampled?: GiphyImage;
  fixed_height: GiphyImage;
  original: GiphyImage;
}

interface GiphyGif {
  id: string;
  images: GiphyImages;
  title?: string;
  alt_text?: string;
}

interface GiphyPagination {
  offset: number;
  count: number;
  total_count: number;
}

interface GiphyResponse {
  data: GiphyGif[];
  pagination?: GiphyPagination;
}

export interface GIFSelectPayload {
  url: string;
  type: 'video/mp4' | 'image/gif';
  alt_text: string | undefined;
}

export interface GIFPickerModalProps {
  onClose?: (e?: unknown) => void;
  onSelect?: (payload: GIFSelectPayload) => void;
}

function GIFPickerModal({
  onClose = () => {},
  onSelect = () => {},
}: GIFPickerModalProps) {
  const { i18n, t } = useLingui();
  const [uiState, setUIState] = useState<
    'default' | 'loading' | 'results' | 'error'
  >('default');
  const [results, setResults] = useState<GiphyResponse | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const currentOffset = useRef(0);
  const scrollableRef = useRef<HTMLElement>(null);

  function fetchGIFs({ offset }: { offset: number }) {
    console.log('fetchGIFs', { offset });
    if (!qRef.current?.value) return;
    setUIState('loading');
    scrollableRef.current?.scrollTo?.({
      top: 0,
      left: 0,
      behavior: 'smooth',
    });
    void (async () => {
      try {
        const query = {
          api_key: GIPHY_API_KEY ?? '',
          q: qRef.current?.value ?? '',
          rating: 'g',
          limit: String(GIFS_PER_PAGE),
          bundle: 'messaging_non_clips',
          offset: String(offset),
          lang: i18n.locale || 'en',
        };
        const response: GiphyResponse = await fetch(
          'https://api.giphy.com/v1/gifs/search?' +
            new URLSearchParams(query).toString(),
          {
            referrerPolicy: 'no-referrer',
          },
        ).then((r) => r.json());
        currentOffset.current = response.pagination?.offset || 0;
        setResults(response);
        setUIState('results');
      } catch (e) {
        setUIState('error');
        console.error(e);
      }
    })();
  }

  useEffect(() => {
    qRef.current?.focus();
  }, []);

  const debouncedOnInput = useDebouncedCallback(() => {
    fetchGIFs({ offset: 0 });
  }, 1000);

  return (
    <div id="gif-picker-sheet" className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            fetchGIFs({ offset: 0 });
          }}
        >
          <input
            ref={qRef}
            type="search"
            name="q"
            placeholder={t`Search GIFs`}
            required
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            dir="auto"
            enterKeyHint="search"
            onInput={debouncedOnInput}
          />
          <input
            type="image"
            className="powered-button"
            src={poweredByGiphyURL}
            width="86"
            height="30"
            alt={t`Powered by GIPHY`}
          />
        </form>
      </header>
      <main
        ref={scrollableRef}
        className={uiState === 'loading' ? 'loading' : ''}
      >
        {uiState === 'default' && (
          <div className="ui-state">
            <p className="insignificant">
              <Trans>Type to search GIFs</Trans>
            </p>
          </div>
        )}
        {uiState === 'loading' && !results?.data?.length && (
          <div className="ui-state">
            <Loader abrupt />
          </div>
        )}
        {results?.data?.length ? (
          <>
            <ul>
              {results.data.map((gif) => {
                const { id, images, title, alt_text } = gif;
                const {
                  fixed_height_small,
                  fixed_height_downsampled,
                  fixed_height,
                  original,
                } = images;
                const theImage = fixed_height_small?.url
                  ? fixed_height_small
                  : fixed_height_downsampled?.url
                    ? fixed_height_downsampled
                    : fixed_height;
                let { url, webp, width, height } = theImage;
                if (+height > 100) {
                  width = (+width / +height) * 100;
                  height = 100;
                }
                const urlObj = URL.parse(url);
                if (!urlObj) return null;
                const strippedURL = urlObj.origin + urlObj.pathname;
                let strippedWebP: string | undefined;
                if (webp) {
                  const webpObj = URL.parse(webp);
                  strippedWebP = webpObj
                    ? webpObj.origin + webpObj.pathname
                    : undefined;
                }
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => {
                        const { mp4, url: originalUrl } = original;
                        const theURL = mp4 || originalUrl;
                        const originalUrlObj = URL.parse(theURL);
                        if (!originalUrlObj) return;
                        const originalStrippedURL =
                          originalUrlObj.origin + originalUrlObj.pathname;
                        onClose();
                        onSelect({
                          url: originalStrippedURL,
                          type: mp4 ? 'video/mp4' : 'image/gif',
                          alt_text: alt_text || title,
                        });
                      }}
                    >
                      <figure
                        style={
                          {
                            '--figure-width': width + 'px',
                            // width: width + 'px'
                          } as CSSProperties
                        }
                      >
                        <picture>
                          {strippedWebP && (
                            <source srcSet={strippedWebP} type="image/webp" />
                          )}
                          <img
                            src={strippedURL}
                            width={width}
                            height={height}
                            loading="lazy"
                            decoding="async"
                            alt={alt_text}
                            referrerPolicy="no-referrer"
                            onLoad={(e) => {
                              e.currentTarget.style.backgroundColor =
                                'transparent';
                            }}
                          />
                        </picture>
                        <figcaption>{alt_text || title}</figcaption>
                      </figure>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="pagination">
              {(results.pagination?.offset ?? 0) > 0 && (
                <button
                  type="button"
                  className="light small"
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    fetchGIFs({
                      offset: (results.pagination?.offset ?? 0) - GIFS_PER_PAGE,
                    });
                  }}
                >
                  <Icon icon="chevron-left" />
                  <span>
                    <Trans>Previous</Trans>
                  </span>
                </button>
              )}
              <span />
              {(results.pagination?.offset ?? 0) +
                (results.pagination?.count ?? 0) <
                (results.pagination?.total_count ?? 0) && (
                <button
                  type="button"
                  className="light small"
                  disabled={uiState === 'loading'}
                  onClick={() => {
                    fetchGIFs({
                      offset: (results.pagination?.offset ?? 0) + GIFS_PER_PAGE,
                    });
                  }}
                >
                  <span>
                    <Trans>Next</Trans>
                  </span>{' '}
                  <Icon icon="chevron-right" />
                </button>
              )}
            </p>
          </>
        ) : (
          uiState === 'results' && (
            <div className="ui-state">
              <p>No results</p>
            </div>
          )
        )}
        {uiState === 'error' && (
          <div className="ui-state">
            <p>
              <Trans>Error loading GIFs</Trans>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default GIFPickerModal;

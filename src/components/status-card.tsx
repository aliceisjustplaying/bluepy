import '@justinribeiro/lite-youtube';

import { decodeBlurHash, getBlurHashAverageColor } from 'fast-blurhash';
import type { HTMLAttributes, MouseEvent } from 'react';
import { useCallback, useState } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'lite-youtube': HTMLAttributes<HTMLElement> & {
        videoid?: string;
        playlistid?: string;
        videotitle?: string;
        videostartat?: string;
        params?: string;
        nocookie?: boolean;
        autoPause?: boolean;
        autoLoad?: boolean;
      };
    }
  }
}

import getDomain from '../utils/get-domain';
import { canReadCardInline } from '../utils/standard-site';
import states from '../utils/states';

import Byline from './byline';
import Icon from './icon';
import RelativeTime from './relative-time';

interface CardAuthor {
  account?: {
    id?: string;
  } & Record<string, unknown>;
  [key: string]: unknown;
}

interface CardData {
  blurhash?: string;
  title?: string;
  description?: string;
  html?: string;
  providerName?: string;
  providerUrl?: string;
  authorName?: string;
  authorUrl?: string;
  width?: number;
  height?: number;
  image?: string;
  imageDescription?: string;
  url?: string;
  type?: string;
  embedUrl?: string;
  language?: string;
  publishedAt?: string;
  authors?: CardAuthor[];
  [key: string]: unknown;
}

interface StatusCardProps {
  card: CardData;
  selfAuthor?: boolean;
}

// "Post": Quote post + card link preview combo
// Assume all links from these domains are "posts"
// Mastodon links are "posts" too but they are converted to real quote posts and there's too many domains to check
// This is just "Progressive Enhancement"
function isCardPost(domain: string | undefined): boolean {
  if (!domain) return false;
  return [
    'x.com',
    'twitter.com',
    'threads.net',
    'bsky.app',
    'bsky.brid.gy',
    'fed.brid.gy',
  ].includes(domain);
}

function StatusCard({ card, selfAuthor }: StatusCardProps) {
  const {
    blurhash,
    title,
    description,
    html,
    providerName,
    authorName,
    width,
    height,
    image,
    imageDescription,
    url,
    type,
    embedUrl,
    language,
    publishedAt,
    authors,
  } = card;

  /* type
  link = Link OEmbed
  photo = Photo OEmbed
  video = Video OEmbed
  rich = iframe OEmbed. Not currently accepted, so won't show up in practice.
  */

  const hasText = title || providerName || authorName;
  const isLandscape =
    typeof width === 'number' && typeof height === 'number' && height
      ? width / height >= 1.2
      : false;
  const size = isLandscape ? 'large' : '';

  const hasIframeHTML = !!html && /<iframe/i.test(html);
  const canReadInline = canReadCardInline(card);
  const handleClick = useCallback(
    (e: MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      if (hasIframeHTML) {
        e.preventDefault();
        states.showEmbedModal = {
          html,
          url: url || embedUrl,
          width,
          height,
        };
      } else if (canReadInline) {
        e.preventDefault();
        states.showEmbedModal = {
          iframeUrl: url,
          url,
          title: title || url,
        };
      }
    },
    [canReadInline, hasIframeHTML, html, embedUrl, url, width, height, title],
  );

  const [blurhashImage, setBlurhashImage] = useState<string | null>(null);

  if (hasText && (image || (type === 'photo' && blurhash))) {
    const domain = getDomain(url ?? '');
    const rgbAverageColor =
      image && blurhash ? getBlurHashAverageColor(blurhash) : null;
    if (!image && blurhash) {
      const w = 44;
      const h = 44;
      const blurhashPixels = decodeBlurHash(blurhash, w, h);
      const canvas: OffscreenCanvas | HTMLCanvasElement = window.OffscreenCanvas
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const imageData = ctx.createImageData(w, h);
        imageData.data.set(blurhashPixels);
        ctx.putImageData(imageData, 0, 0);
      }
      try {
        if (window.OffscreenCanvas) {
          void (async () => {
            const blob = await (canvas as OffscreenCanvas).convertToBlob();
            setBlurhashImage(URL.createObjectURL(blob));
          })();
        } else {
          setBlurhashImage((canvas as HTMLCanvasElement).toDataURL());
        }
      } catch (e) {
        // Silently fail
        console.error(e);
      }
    }

    const isPost = isCardPost(domain);

    return (
      <Byline hidden={!!selfAuthor} authors={authors}>
        <a
          href={url}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className={`card link ${isPost ? 'card-post' : ''} ${
            blurhashImage ? '' : size
          } ${hasIframeHTML || canReadInline ? 'can-show-embed' : ''}`}
          style={{
            '--average-color': rgbAverageColor
              ? `rgb(${rgbAverageColor.join(',')})`
              : undefined,
          }}
          onClick={handleClick}
        >
          <div className="card-image">
            <img
              src={image || blurhashImage || undefined}
              width={width}
              height={height}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              alt={imageDescription || ''}
              onError={(e) => {
                try {
                  const target = e.target as HTMLImageElement | null;
                  if (target) target.style.display = 'none';
                } catch {}
              }}
              style={{
                '--anim-duration':
                  width && height
                    ? `${Math.min(
                        Math.max(Math.max(width, height) / 100, 5),
                        120,
                      )}s`
                    : undefined,
              }}
            />
          </div>
          <div className="meta-container" lang={language}>
            <p className="meta domain">
              <span className="domain">{domain}</span>{' '}
              {!!publishedAt && <>&middot; </>}
              {!!publishedAt && (
                <>
                  <RelativeTime datetime={publishedAt} format="micro" />
                </>
              )}
            </p>
            <p className="title" dir="auto" title={title}>
              {title}
            </p>
            <p className="meta" dir="auto" title={description}>
              {description ||
                (!!publishedAt && (
                  <RelativeTime datetime={publishedAt} format="micro" />
                ))}
            </p>
          </div>
        </a>
      </Byline>
    );
  } else if (type === 'photo') {
    return (
      <a
        href={url}
        target="_blank"
        rel="nofollow noopener noreferrer"
        className="card photo"
        onClick={handleClick}
      >
        <img
          src={embedUrl}
          width={width}
          height={height}
          alt={title || description}
          loading="lazy"
          style={{
            height: 'auto',
            aspectRatio: `${width}/${height}`,
          }}
        />
      </a>
    );
  } else {
    if (type === 'video') {
      if (providerName && /youtube/i.test(providerName)) {
        // Get ID from e.g. https://www.youtube.com/watch?v=[VIDEO_ID]
        const videoID = url ? url.match(/watch\?v=([^&]+)/)?.[1] : undefined;
        if (videoID) {
          return (
            <div
              className="card video"
              role="button"
              tabIndex={0}
              onClick={handleClick}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleClick(e);
              }}
            >
              <lite-youtube videoid={videoID} nocookie autoPause></lite-youtube>
            </div>
          );
        }
      }
      // return (
      //   <div
      //     className="card video"
      //     style={{
      //       aspectRatio: `${width}/${height}`,
      //     }}
      //     dangerouslySetInnerHTML={{ __html: html }}
      //   />
      // );
    }
    if (hasText && !image) {
      const domain = getDomain(url ?? '');
      const isPost = isCardPost(domain);
      return (
        <a
          href={url}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className={`card link ${isPost ? 'card-post' : ''} no-image ${
            hasIframeHTML || canReadInline ? 'can-show-embed' : ''
          }`}
          lang={language}
          dir="auto"
          onClick={handleClick}
        >
          <div className="meta-container">
            <p className="meta domain">
              <span className="domain">
                <Icon icon="link" size="s" /> <span>{domain}</span>
              </span>{' '}
              {!!publishedAt && <>&middot; </>}
              {!!publishedAt && (
                <>
                  <RelativeTime datetime={publishedAt} format="micro" />
                </>
              )}
            </p>
            <p className="title" title={title}>
              {title}
            </p>
            <p
              className="meta"
              title={description || providerName || authorName}
            >
              {description || providerName || authorName}
            </p>
          </div>
        </a>
      );
    }
  }
  return null;
}

export default StatusCard;

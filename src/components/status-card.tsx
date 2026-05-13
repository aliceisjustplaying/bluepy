import '@justinribeiro/lite-youtube';

import { decodeBlurHash, getBlurHashAverageColor } from 'fast-blurhash';
import type { JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'lite-youtube': JSX.HTMLAttributes<HTMLElement> & {
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
import isMastodonLinkMaybe from '../utils/is-mastodon-link-maybe';
import { canReadCardInline } from '../utils/standard-site';
import states from '../utils/states';
import unfurlMastodonLink from '../utils/unfurl-link';

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
  type?: 'link' | 'photo' | 'video' | 'rich' | string;
  embedUrl?: string;
  language?: string;
  publishedAt?: string;
  authors?: CardAuthor[];
  [key: string]: unknown;
}

interface StatusCardProps {
  card: CardData;
  selfReferential?: boolean;
  selfAuthor?: boolean;
  instance?: string;
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

function StatusCard({
  card,
  selfReferential,
  selfAuthor,
  instance,
}: StatusCardProps) {
  const snapStates = useSnapshot(states);
  const {
    blurhash,
    title,
    description,
    html,
    providerName,
    providerUrl,
    authorName,
    authorUrl,
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

  const [cardStatusURL, setCardStatusURL] = useState<string | null>(null);
  // const [cardStatusID, setCardStatusID] = useState(null);
  useEffect(() => {
    if (
      !hasText ||
      !image ||
      selfReferential ||
      !url ||
      !instance ||
      !isMastodonLinkMaybe(url)
    ) {
      return;
    }

    const abortController = new AbortController();
    unfurlMastodonLink(instance, url, abortController.signal).then((result) => {
      if (!result) return;
      const { url: resultUrl } = result;
      if (!resultUrl) return;
      setCardStatusURL('#' + resultUrl);

      // NOTE: This is for quote post
      // (async () => {
      //   const { masto } = api({ instance });
      //   const status = await masto.v1.statuses.$select(id).fetch();
      //   saveStatus(status, instance);
      //   setCardStatusID(id);
      // })();
    });

    return () => {
      abortController.abort();
    };
  }, [hasText, image, selfReferential]);

  // if (cardStatusID) {
  //   return (
  //     <Status statusID={cardStatusID} instance={instance} size="s" readOnly />
  //   );
  // }

  const unfurledLinks = snapStates.unfurledLinks as Record<string, unknown>;
  if (url && unfurledLinks[url]) return null;

  const hasIframeHTML = !!html && /<iframe/i.test(html);
  const canReadInline = canReadCardInline(card);
  const handleClick = useCallback(
    (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
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
    [canReadInline, hasIframeHTML],
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
      const ctx = canvas.getContext('2d') as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const imageData = ctx.createImageData(w, h);
        imageData.data.set(blurhashPixels);
        ctx.putImageData(imageData, 0, 0);
      }
      try {
        if (window.OffscreenCanvas) {
          (canvas as OffscreenCanvas).convertToBlob().then((blob) => {
            setBlurhashImage(URL.createObjectURL(blob));
          });
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
          href={cardStatusURL || url}
          target={cardStatusURL ? undefined : '_blank'}
          rel="nofollow noopener"
          class={`card link ${isPost ? 'card-post' : ''} ${
            blurhashImage ? '' : size
          } ${hasIframeHTML || canReadInline ? 'can-show-embed' : ''}`}
          style={{
            '--average-color':
              rgbAverageColor && `rgb(${rgbAverageColor.join(',')})`,
          }}
          onClick={handleClick}
        >
          <div class="card-image">
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
          <div class="meta-container" lang={language}>
            <p class="meta domain">
              <span class="domain">{domain}</span>{' '}
              {!!publishedAt && <>&middot; </>}
              {!!publishedAt && (
                <>
                  <RelativeTime datetime={publishedAt} format="micro" />
                </>
              )}
            </p>
            <p class="title" dir="auto" title={title}>
              {title}
            </p>
            <p class="meta" dir="auto" title={description}>
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
        rel="nofollow noopener"
        class="card photo"
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
            <a class="card video" onClick={handleClick}>
              <lite-youtube videoid={videoID} nocookie autoPause></lite-youtube>
            </a>
          );
        }
      }
      // return (
      //   <div
      //     class="card video"
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
          href={cardStatusURL || url}
          target={cardStatusURL ? undefined : '_blank'}
          rel="nofollow noopener"
          class={`card link ${isPost ? 'card-post' : ''} no-image ${
            hasIframeHTML || canReadInline ? 'can-show-embed' : ''
          }`}
          lang={language}
          dir="auto"
          onClick={handleClick}
        >
          <div class="meta-container">
            <p class="meta domain">
              <span class="domain">
                <Icon icon="link" size="s" /> <span>{domain}</span>
              </span>{' '}
              {!!publishedAt && <>&middot; </>}
              {!!publishedAt && (
                <>
                  <RelativeTime datetime={publishedAt} format="micro" />
                </>
              )}
            </p>
            <p class="title" title={title}>
              {title}
            </p>
            <p class="meta" title={description || providerName || authorName}>
              {description || providerName || authorName}
            </p>
          </div>
        </a>
      );
    }
  }
}

export default StatusCard;

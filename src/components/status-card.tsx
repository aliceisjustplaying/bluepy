import '@justinribeiro/lite-youtube';

import { decodeBlurHash, getBlurHashAverageColor } from 'fast-blurhash';
import type { CSSProperties, HTMLAttributes, MouseEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useSnapshot } from 'valtio';

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
  type?: string;
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

interface StatusCardRenderProps {
  blurhash?: string;
  title?: string;
  description?: string;
  providerName?: string;
  authorName?: string;
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
  cardStatusURL: string | null;
  canReadInline: boolean;
  hasIframeHTML: boolean;
  openEmbeddableCard: (
    e: MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
  ) => void;
  selfAuthor?: boolean;
  size: string;
}

interface StatusCardStyle extends CSSProperties {
  '--average-color'?: string;
}

interface StatusCardImageStyle extends CSSProperties {
  '--anim-duration'?: string;
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

function createBlurhashImage(
  blurhash: string,
  setBlurhashImage: (url: string) => void,
) {
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
    if ('convertToBlob' in canvas) {
      void (async () => {
        const blob = await canvas.convertToBlob();
        setBlurhashImage(URL.createObjectURL(blob));
      })();
    } else if (canvas instanceof HTMLCanvasElement) {
      setBlurhashImage(canvas.toDataURL());
    }
  } catch (e) {
    // Silently fail
    console.error(e);
  }
}

function StatusCardImagePreview({
  authors,
  blurhash,
  canReadInline,
  cardStatusURL,
  description,
  hasIframeHTML,
  height,
  image,
  imageDescription,
  language,
  openEmbeddableCard,
  publishedAt,
  selfAuthor,
  size,
  title,
  url,
  width,
}: StatusCardRenderProps) {
  const [blurhashImage, setBlurhashImage] = useState<string | null>(null);
  const domain = getDomain(url ?? '');
  const rgbAverageColor =
    image && blurhash ? getBlurHashAverageColor(blurhash) : null;
  if (!image && blurhash) {
    createBlurhashImage(blurhash, setBlurhashImage);
  }
  const isPost = isCardPost(domain);

  return (
    <Byline hidden={!!selfAuthor} authors={authors}>
      <a
        href={cardStatusURL || url}
        target={cardStatusURL ? undefined : '_blank'}
        rel="nofollow noopener"
        className={`card link ${isPost ? 'card-post' : ''} ${
          blurhashImage ? '' : size
        } ${hasIframeHTML || canReadInline ? 'can-show-embed' : ''}`}
        style={
          {
            '--average-color': rgbAverageColor
              ? `rgb(${rgbAverageColor.join(',')})`
              : undefined,
          } as StatusCardStyle
        }
        onClick={openEmbeddableCard}
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
                e.currentTarget.style.display = 'none';
              } catch {}
            }}
            style={
              {
                '--anim-duration':
                  width && height
                    ? `${Math.min(
                        Math.max(Math.max(width, height) / 100, 5),
                        120,
                      )}s`
                    : undefined,
              } as StatusCardImageStyle
            }
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
}

function StatusCardPhoto({
  description,
  embedUrl,
  height,
  openEmbeddableCard,
  title,
  url,
  width,
}: StatusCardRenderProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="card photo"
      onClick={openEmbeddableCard}
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
}

function StatusCardVideo({
  openEmbeddableCard,
  providerName,
  url,
}: StatusCardRenderProps) {
  if (!providerName || !/youtube/i.test(providerName)) return null;
  // Get ID from e.g. https://www.youtube.com/watch?v=[VIDEO_ID]
  const videoID = url ? url.match(/watch\?v=([^&]+)/)?.[1] : undefined;
  if (!videoID) return null;
  return (
    <button type="button" className="card video" onClick={openEmbeddableCard}>
      <lite-youtube videoid={videoID} nocookie autoPause></lite-youtube>
    </button>
  );
}

function StatusCardText({
  authorName,
  canReadInline,
  cardStatusURL,
  description,
  hasIframeHTML,
  language,
  openEmbeddableCard,
  providerName,
  publishedAt,
  title,
  url,
}: StatusCardRenderProps) {
  const domain = getDomain(url ?? '');
  const isPost = isCardPost(domain);
  return (
    <a
      href={cardStatusURL || url}
      target={cardStatusURL ? undefined : '_blank'}
      rel="nofollow noopener"
      className={`card link ${isPost ? 'card-post' : ''} no-image ${
        hasIframeHTML || canReadInline ? 'can-show-embed' : ''
      }`}
      lang={language}
      dir="auto"
      onClick={openEmbeddableCard}
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
        <p className="meta" title={description || providerName || authorName}>
          {description || providerName || authorName}
        </p>
      </div>
    </a>
  );
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
      return undefined;
    }

    const abortController = new AbortController();
    void (async () => {
      const result = await unfurlMastodonLink(
        instance,
        url,
        abortController.signal,
      );
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
    })();

    return () => {
      abortController.abort();
    };
  }, [hasText, image, selfReferential, url, instance]);

  // if (cardStatusID) {
  //   return (
  //     <Status statusID={cardStatusID} instance={instance} size="s" readOnly />
  //   );
  // }

  const hasIframeHTML = !!html && /<iframe/i.test(html);
  const canReadInline = canReadCardInline(card);
  const openEmbeddableCard = useCallback(
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

  const unfurledLinks = snapStates.unfurledLinks as Record<string, unknown>;
  if (url && unfurledLinks[url]) return null;

  const renderProps: StatusCardRenderProps = {
    blurhash,
    title,
    description,
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
    cardStatusURL,
    canReadInline,
    hasIframeHTML,
    openEmbeddableCard,
    selfAuthor,
    size,
  };

  if (hasText && (image || (type === 'photo' && blurhash))) {
    return <StatusCardImagePreview {...renderProps} />;
  } else if (type === 'photo') {
    return <StatusCardPhoto {...renderProps} />;
  } else {
    if (type === 'video') {
      const videoID = url ? url.match(/watch\?v=([^&]+)/)?.[1] : undefined;
      if (providerName && /youtube/i.test(providerName) && videoID) {
        return <StatusCardVideo {...renderProps} />;
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
      return <StatusCardText {...renderProps} />;
    }
  }
  return null;
}

export default StatusCard;

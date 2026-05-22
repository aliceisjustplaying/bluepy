import { Trans, useLingui } from '@lingui/react/macro';
import prettify from 'html-prettify';

import emojifyText from '../utils/emojify-text';
import showToast from '../utils/show-toast';
import states, { statusKey } from '../utils/states';

import Icon from './icon';

interface EmojiLike {
  shortcode: string;
  url: string;
  staticUrl?: string;
}

interface MediaAttachment {
  id: string;
  type: string;
  description?: string | null;
  meta?: {
    original?: { width?: number; height?: number };
    small?: { width?: number; height?: number };
  };
  previewRemoteUrl?: string | null;
  previewUrl?: string | null;
  remoteUrl?: string | null;
  url?: string | null;
}

interface PostLike {
  account: {
    url?: string;
    displayName?: string;
    acct?: string;
    username?: string;
    emojis?: EmojiLike[];
    bot?: boolean;
    group?: boolean;
  };
  id: string;
  spoilerText?: string;
  language?: string;
  editedAt?: string | null;
  createdAt?: string;
  content?: string;
  mediaAttachments?: MediaAttachment[];
  url?: string;
  emojis?: EmojiLike[];
}

interface QuoteRef {
  id: string;
  instance?: string;
  url?: string;
}

interface PostEmbedModalProps {
  post: PostLike;
  instance?: string;
  onClose?: () => void;
}

function generateHTMLCode(
  post: PostLike,
  instance: string | undefined,
  level = 0,
): string {
  const {
    account: { displayName, acct, emojis: accountEmojis },
    id,
    spoilerText,
    language,
    createdAt,
    content,
    mediaAttachments,
    url,
    emojis,
  } = post;

  const sKey = statusKey(id, instance);
  const quotes = (sKey ? states.statusQuotes[sKey] : undefined) || [];
  const uniqueQuotes = (quotes as QuoteRef[]).filter(
    (q: QuoteRef, i: number, arr: QuoteRef[]) =>
      arr.findIndex((q2: QuoteRef) => q2.url === q.url) === i,
  );
  const quoteStatusesHTML =
    uniqueQuotes.length && level <= 2
      ? uniqueQuotes
          .map((quote: QuoteRef) => {
            const { id: quoteId, instance: quoteInstance } = quote;
            const quoteKey = statusKey(quoteId, quoteInstance);
            const s = quoteKey ? states.statuses[quoteKey] : undefined;
            if (s) {
              return generateHTMLCode(s as PostLike, quoteInstance, ++level);
            }
            return '';
          })
          .join('')
      : '';

  const createdAtDate = new Date(createdAt as string);
  // const editedAtDate = editedAt && new Date(editedAt);

  const contentHTML =
    emojifyText(content as string, emojis) +
    '\n' +
    quoteStatusesHTML +
    '\n' +
    ((mediaAttachments?.length ?? 0) > 0
      ? '\n' +
        (mediaAttachments ?? [])
          .map((media: MediaAttachment) => {
            const {
              description,
              meta,
              previewRemoteUrl,
              previewUrl,
              remoteUrl,
              url: mediaUrl,
              type,
            } = media;
            const { original = {}, small } = meta || {};
            const width = small?.width || original?.width;
            const height = small?.height || original?.height;

            // Prefer remote over original
            const sourceMediaURL = remoteUrl || mediaUrl;
            const previewMediaURL = previewRemoteUrl || previewUrl;
            const mediaURL = previewMediaURL || sourceMediaURL;

            const sourceMediaURLObj = sourceMediaURL
              ? URL.parse(sourceMediaURL)
              : null;
            const isVideoMaybe =
              type === 'unknown' &&
              sourceMediaURLObj &&
              /\.(mp4|m4r|m4v|mov|webm)$/i.test(sourceMediaURLObj.pathname);
            const isAudioMaybe =
              type === 'unknown' &&
              sourceMediaURLObj &&
              /\.(mp3|ogg|wav|m4a|m4p|m4b)$/i.test(sourceMediaURLObj.pathname);
            const isImage =
              type === 'image' ||
              (type === 'unknown' &&
                previewMediaURL &&
                !isVideoMaybe &&
                !isAudioMaybe);
            const isVideo = type === 'gifv' || type === 'video' || isVideoMaybe;
            const isAudio = type === 'audio' || isAudioMaybe;

            let mediaHTML = '';
            if (isImage) {
              mediaHTML = `<img src="${mediaURL}" width="${width}" height="${height}" alt="${description}" loading="lazy" />`;
            } else if (isVideo) {
              mediaHTML = `
                <video src="${sourceMediaURL}" width="${width}" height="${height}" controls preload="auto" poster="${previewMediaURL}" loading="lazy"></video>
                ${description ? `<figcaption>${description}</figcaption>` : ''}
              `;
            } else if (isAudio) {
              mediaHTML = `
                <audio src="${sourceMediaURL}" controls preload="auto"></audio>
                ${description ? `<figcaption>${description}</figcaption>` : ''}
              `;
            } else {
              mediaHTML = `
                <a href="${sourceMediaURL}">📄 ${
                  description || sourceMediaURL
                }</a>
              `;
            }

            return `<figure>${mediaHTML}</figure>`;
          })
          .join('\n')
      : '');

  const htmlCode = `
    <blockquote lang="${language}" cite="${url}" data-source="fediverse">
      ${
        spoilerText
          ? `
            <details>
              <summary>${spoilerText}</summary>
              ${contentHTML}
            </details>
          `
          : contentHTML
      }
      <footer>
        — ${emojifyText(
          displayName as string,
          accountEmojis,
        )} (@${acct}) ${createdAt ? `<a href="${url}"><time datetime="${createdAtDate.toISOString()}">${createdAtDate.toLocaleString()}</time></a>` : ''}
      </footer>
    </blockquote>
  `;

  return prettify(htmlCode);
}

function PostEmbedModal({ post, instance, onClose }: PostEmbedModalProps) {
  const { t } = useLingui();
  const {
    account: { emojis: accountEmojis },
    mediaAttachments,
    emojis,
  } = post;

  const htmlCode = generateHTMLCode(post, instance);
  return (
    <div id="embed-post" className="sheet">
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Embed post</Trans>
        </h2>
      </header>
      <main tabIndex={-1}>
        <h3>
          <Trans>HTML Code</Trans>
        </h3>
        <textarea
          className="embed-code"
          readOnly
          onClick={(e: React.MouseEvent<HTMLTextAreaElement>) => {
            e.currentTarget.select();
          }}
          dir="auto"
        >
          {htmlCode}
        </textarea>
        <button
          type="button"
          onClick={() => {
            try {
              void navigator.clipboard.writeText(htmlCode);
              showToast(t`HTML code copied`);
            } catch (e) {
              console.error(e);
              showToast(t`Unable to copy HTML code`);
            }
          }}
        >
          <Icon icon="clipboard" />{' '}
          <span>
            <Trans>Copy</Trans>
          </span>
        </button>
        {!!mediaAttachments?.length && (
          <section>
            <p>
              <Trans>Media attachments:</Trans>
            </p>
            <ol className="links-list">
              {mediaAttachments.map((media: MediaAttachment) => {
                return (
                  <li key={media.id}>
                    <a
                      href={media.remoteUrl || media.url || undefined}
                      target="_blank"
                      download
                    >
                      {media.remoteUrl || media.url}
                    </a>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
        {!!accountEmojis?.length && (
          <section>
            <p>
              <Trans>Account Emojis:</Trans>
            </p>
            <ul>
              {accountEmojis.map((emoji: EmojiLike) => {
                return (
                  <li key={emoji.shortcode}>
                    <picture>
                      <source
                        srcSet={emoji.staticUrl}
                        media="(prefers-reduced-motion: reduce)"
                      ></source>
                      <img
                        className="shortcode-emoji emoji"
                        src={emoji.url}
                        alt={`:${emoji.shortcode}:`}
                        width="16"
                        height="16"
                        loading="lazy"
                        decoding="async"
                      />
                    </picture>{' '}
                    <code>:{emoji.shortcode}:</code> (
                    <a href={emoji.url} target="_blank" download>
                      URL
                    </a>
                    )
                    {emoji.staticUrl ? (
                      <>
                        {' '}
                        (
                        <a href={emoji.staticUrl} target="_blank" download>
                          <Trans>static URL</Trans>
                        </a>
                        )
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {!!emojis?.length && (
          <section>
            <p>
              <Trans>Emojis:</Trans>
            </p>
            <ul>
              {emojis.map((emoji: EmojiLike) => {
                return (
                  <li key={emoji.shortcode}>
                    <picture>
                      <source
                        srcSet={emoji.staticUrl}
                        media="(prefers-reduced-motion: reduce)"
                      ></source>
                      <img
                        className="shortcode-emoji emoji"
                        src={emoji.url}
                        alt={`:${emoji.shortcode}:`}
                        width="16"
                        height="16"
                        loading="lazy"
                        decoding="async"
                      />
                    </picture>{' '}
                    <code>:{emoji.shortcode}:</code> (
                    <a href={emoji.url} target="_blank" download>
                      URL
                    </a>
                    )
                    {emoji.staticUrl ? (
                      <>
                        {' '}
                        (
                        <a href={emoji.staticUrl} target="_blank" download>
                          <Trans>static URL</Trans>
                        </a>
                        )
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <section>
          <small>
            <p>
              <Trans>Notes:</Trans>
            </p>
            <ul>
              <li>
                <Trans>
                  This is static, unstyled and scriptless. You may need to apply
                  your own styles and edit as needed.
                </Trans>
              </li>
              <li>
                <Trans>
                  Media attachments can be images, videos, audios or any file
                  types.
                </Trans>
              </li>
              <li>
                <Trans>Post could be edited or deleted later.</Trans>
              </li>
            </ul>
          </small>
        </section>
        <h3>
          <Trans>Preview</Trans>
        </h3>
        <output
          className="embed-preview"
          dangerouslySetInnerHTML={{ __html: htmlCode }}
          dir="auto"
        />
        <p>
          <small>
            <Trans>Note: This preview is lightly styled.</Trans>
          </small>
        </p>
      </main>
    </div>
  );
}

export default PostEmbedModal;

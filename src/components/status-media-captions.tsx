import type { mastodon } from 'masto';
import { useMemo } from 'preact/hooks';

import states from '../utils/states';

import { isMediaCaptionLong } from './media';

interface StatusMediaCaptionsArgs {
  mediaAttachments: mastodon.v1.MediaAttachment[];
  isSizeLarge: boolean;
  language?: string | null;
}

export default function useStatusMediaCaptions({
  mediaAttachments,
  isSizeLarge,
  language,
}: StatusMediaCaptionsArgs) {
  const displayedMediaAttachments = mediaAttachments.slice(
    0,
    isSizeLarge ? undefined : 4,
  );
  const showMultipleMediaCaptions =
    mediaAttachments.length > 1 &&
    displayedMediaAttachments.some(
      (media) => !!media.description && !isMediaCaptionLong(media.description),
    );
  const captionChildren = useMemo(() => {
    if (!showMultipleMediaCaptions) return null;
    interface CaptionAttachment {
      media: mastodon.v1.MediaAttachment;
      indices: number[];
    }
    const attachments: CaptionAttachment[] = [];
    displayedMediaAttachments.forEach(
      (media: mastodon.v1.MediaAttachment, i: number) => {
        if (!media.description) return;
        const index = attachments.findIndex(
          (attachment) => attachment.media.description === media.description,
        );
        if (index === -1) {
          attachments.push({
            media,
            indices: [i],
          });
        } else {
          attachments[index].indices.push(i);
        }
      },
    );
    return attachments.map(({ media, indices }) => {
      const handleAltClick = () => {
        states.showMediaAlt = {
          alt: media.description,
          lang: language ?? undefined,
        };
      };
      return (
        <button
          type="button"
          key={media.id}
          data-caption-index={indices.map((i: number) => i + 1).join(' ')}
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            handleAltClick();
          }}
          title={media.description ?? undefined}
        >
          <sup>{indices.map((i: number) => i + 1).join(' ')}</sup>{' '}
          {media.description}
        </button>
      );
    });
  }, [showMultipleMediaCaptions, displayedMediaAttachments, language]);

  return {
    displayedMediaAttachments,
    showMultipleMediaCaptions,
    captionChildren,
  };
}

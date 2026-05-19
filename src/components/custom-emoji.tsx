import type { SyntheticEvent } from 'react';

interface CustomEmojiProps {
  staticUrl?: string;
  alt?: string;
  url?: string;
}

export default function CustomEmoji({ staticUrl, alt, url }: CustomEmojiProps) {
  return (
    <picture>
      {staticUrl && (
        <source srcSet={staticUrl} media="(prefers-reduced-motion: reduce)" />
      )}
      <img
        key={alt || url}
        src={url}
        alt={alt}
        className="shortcode-emoji emoji"
        width="16"
        height="16"
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onLoad={(e: SyntheticEvent<HTMLImageElement>) => {
          try {
            const target = e.currentTarget;
            target.dataset.isLarger = String(
              target.naturalWidth > target.width * 2 ||
                target.naturalHeight > target.height * 2,
            );
          } catch {}
        }}
      />
    </picture>
  );
}

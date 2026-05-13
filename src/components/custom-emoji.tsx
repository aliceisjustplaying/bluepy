import type { TargetedEvent } from 'preact';

interface CustomEmojiProps {
  staticUrl?: string;
  alt?: string;
  url?: string;
}

export default function CustomEmoji({ staticUrl, alt, url }: CustomEmojiProps) {
  return (
    <picture>
      {staticUrl && (
        <source srcset={staticUrl} media="(prefers-reduced-motion: reduce)" />
      )}
      <img
        key={alt || url}
        src={url}
        alt={alt}
        class="shortcode-emoji emoji"
        width="16"
        height="16"
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onLoad={(e: TargetedEvent<HTMLImageElement>) => {
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

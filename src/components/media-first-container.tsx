import { useEffect, useRef, useState } from 'preact/hooks';

import isRTL from '../utils/is-rtl';

import Icon from './icon';
import Media from './media';

interface MediaAttachment {
  id: string;
  [key: string]: unknown;
}

interface MediaFirstContainerProps {
  mediaAttachments: MediaAttachment[];
  language?: string;
  postID: string;
  instance: string;
}

function MediaFirstContainer(props: MediaFirstContainerProps) {
  const { mediaAttachments, language, postID, instance } = props;
  const moreThanOne = mediaAttachments.length > 1;

  const carouselRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return undefined;
    const handleScroll = () => {
      const { clientWidth, scrollLeft } = carousel;
      const index = Math.round(Math.abs(scrollLeft) / clientWidth);
      setCurrentIndex(index);
    };
    carousel.addEventListener('scroll', handleScroll, {
      passive: true,
    });
    return () => {
      carousel.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <>
      <div class="media-first-container">
        <div class="media-first-carousel" ref={carouselRef}>
          {mediaAttachments.map((media, i) => (
            <div class="media-first-item" key={media.id}>
              <Media
                media={media}
                lang={language}
                to={`/${instance}/s/${postID}?media=${i + 1}`}
              />
            </div>
          ))}
        </div>
        {moreThanOne && (
          <div class="media-carousel-controls">
            <div class="carousel-indexer">
              {currentIndex + 1}/{mediaAttachments.length}
            </div>
            <div class="media-carousel-button">
              <button
                type="button"
                class="carousel-button"
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
                <Icon icon="arrow-left" />
              </button>
            </div>
            <div class="media-carousel-button">
              <button
                type="button"
                class="carousel-button"
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
                <Icon icon="arrow-right" />
              </button>
            </div>
          </div>
        )}
      </div>
      {moreThanOne && (
        <div
          class="media-carousel-dots"
          style={{
            '--dots-count': mediaAttachments.length,
          }}
        >
          {mediaAttachments.map((media, i) => (
            <span
              key={media.id}
              class={`carousel-dot ${i === currentIndex ? 'active' : ''}`}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default MediaFirstContainer;

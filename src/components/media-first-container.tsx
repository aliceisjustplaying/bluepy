import { useEffect, useRef, useState } from 'react';

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
      <div className="media-first-container">
        <div className="media-first-carousel" ref={carouselRef}>
          {mediaAttachments.map((media, i) => (
            <div className="media-first-item" key={media.id}>
              <Media
                media={media}
                lang={language}
                to={`/${instance}/s/${postID}?media=${i + 1}`}
              />
            </div>
          ))}
        </div>
        {moreThanOne && (
          <div className="media-carousel-controls">
            <div className="carousel-indexer">
              {currentIndex + 1}/{mediaAttachments.length}
            </div>
            <div className="media-carousel-button">
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
                <Icon icon="arrow-left" />
              </button>
            </div>
            <div className="media-carousel-button">
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
                <Icon icon="arrow-right" />
              </button>
            </div>
          </div>
        )}
      </div>
      {moreThanOne && (
        <div
          className="media-carousel-dots"
          style={{
            '--dots-count': mediaAttachments.length,
          }}
        >
          {mediaAttachments.map((media, i) => (
            <span
              key={media.id}
              className={`carousel-dot ${i === currentIndex ? 'active' : ''}`}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default MediaFirstContainer;

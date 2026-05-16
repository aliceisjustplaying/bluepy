/*
  Rendered but hidden. Only show when visible
*/
import type { ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useOnInView } from 'react-intersection-observer';

// The sticky header, usually at the top
const TOP = 48;

const shazamIDs: Record<string, boolean> = {};

interface LazyShazamProps {
  id?: string;
  children?: ReactNode;
}

export default function LazyShazam({ id, children }: LazyShazamProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleStart, setVisibleStart] = useState(!!(id && shazamIDs[id]));

  const onInView = useCallback(
    (inView: boolean) => {
      if (inView && containerRef.current) {
        containerRef.current.hidden = false;
        if (id) shazamIDs[id] = true;
      }
    },
    [id],
  );

  const ref = useOnInView<HTMLDivElement>(onInView, {
    rootMargin: `-${TOP}px 0px 0px 0px`,
    trackVisibility: true,
    delay: 1000,
    triggerOnce: true,
    skip: visibleStart,
  });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.bottom > TOP) {
      if (rect.top < window.innerHeight) {
        containerRef.current.hidden = false;
      } else {
        setVisibleStart(true);
      }
      if (id) shazamIDs[id] = true;
    }
  }, [id]);

  if (visibleStart) return children;

  return (
    <div ref={containerRef} className="shazam-container no-animation" hidden>
      <div ref={ref} className="shazam-container-inner">
        {children}
      </div>
    </div>
  );
}

import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

interface IntersectionViewProps {
  children: ComponentChildren;
  root?: Element | Document | null;
  fallback?: ComponentChildren;
}

const IntersectionView = ({
  children,
  root = null,
  fallback = null,
}: IntersectionViewProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);
  useLayoutEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setShow(true);
          observer.unobserve(ref.current!);
        }
      },
      {
        root,
        rootMargin: `${screen.height}px`,
      },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      if (ref.current) observer.unobserve(ref.current);
    };
  }, []);

  return show ? children : <div ref={ref}>{fallback}</div>;
};

export default IntersectionView;

import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

interface IntersectionViewProps {
  children: ReactNode;
  root?: Element | Document | null;
  fallback?: ReactNode;
}

const IntersectionView = ({
  children,
  root = null,
  fallback = null,
}: IntersectionViewProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setShow(true);
          if (node) observer.unobserve(node);
        }
      },
      {
        root,
        rootMargin: `${screen.height}px`,
      },
    );
    if (node) observer.observe(node);
    return () => {
      if (node) observer.unobserve(node);
    };
  }, [root]);

  return show ? children : <div ref={ref}>{fallback}</div>;
};

export default IntersectionView;

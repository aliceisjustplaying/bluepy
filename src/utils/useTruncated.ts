import { useRef } from 'react';

import useThrottledResizeObserver from './useThrottledResizeObserver';

interface UseTruncatedOpts {
  className?: string;
  onTruncated?: (truncated: boolean) => void;
}

export default function useTruncated<T extends HTMLElement = HTMLElement>({
  className = 'truncated',
  onTruncated,
}: UseTruncatedOpts = {}) {
  const ref = useRef<T>(null);
  const prevTruncatedRef = useRef<boolean | undefined>(undefined);
  const onResize = ({
    height,
  }: {
    width: number | undefined;
    height: number | undefined;
  }) => {
    if (ref.current) {
      const { scrollHeight } = ref.current;
      let truncated = height !== undefined && scrollHeight > height;
      if (truncated) {
        const { height: _height, maxHeight } = getComputedStyle(ref.current);
        const computedHeight = parseInt(maxHeight || _height, 10);
        truncated = scrollHeight > computedHeight;
      }
      ref.current.classList.toggle(className, truncated);
      if (
        prevTruncatedRef.current !== truncated &&
        typeof onTruncated === 'function'
      ) {
        prevTruncatedRef.current = truncated;
        onTruncated(truncated);
      }
    }
  };
  useThrottledResizeObserver<T>({
    ref,
    box: 'border-box',
    onResize,
  });
  return ref;
}

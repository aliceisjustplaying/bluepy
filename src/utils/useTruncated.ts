import { useRef } from 'preact/hooks';

import useThrottledResizeObserver from './useThrottledResizeObserver';

interface UseTruncatedOpts {
  className?: string;
  onTruncated?: (truncated: boolean) => void;
}

export default function useTruncated({
  className = 'truncated',
  onTruncated,
}: UseTruncatedOpts = {}) {
  const ref = useRef<HTMLElement>(null);
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
  useThrottledResizeObserver<HTMLElement>({
    ref,
    box: 'border-box',
    onResize,
  });
  return ref;
}

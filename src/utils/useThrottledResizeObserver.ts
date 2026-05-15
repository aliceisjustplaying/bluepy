import type { RefObject } from 'preact';
import { useThrottledCallback } from 'use-debounce';
import useResizeObserver, { type ResizeHandler } from 'use-resize-observer';

interface ThrottledResizeObserverOpts<T extends Element> {
  ref?: RefObject<T> | T | null;
  onResize: ResizeHandler;
  box?: 'border-box' | 'content-box' | 'device-pixel-content-box';
  round?: (n: number) => number;
}

export default function useThrottledResizeObserver<T extends Element>(
  opts: ThrottledResizeObserverOpts<T>,
) {
  const onResize = useThrottledCallback(opts.onResize, 300);
  return useResizeObserver<T>({
    ...opts,
    onResize,
  });
}

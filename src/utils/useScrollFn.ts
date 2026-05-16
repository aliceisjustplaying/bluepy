import type { RefObject } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useThrottledCallback } from 'use-debounce';

type ScrollDirection = 'end' | 'start' | null;
type ScrollAxis = 'vertical' | 'horizontal';

interface ScrollFnState {
  scrollDirection: ScrollDirection;
  reachStart: boolean;
  reachEnd: boolean;
  nearReachStart: boolean;
  nearReachEnd: boolean;
}

type ScrollFnCallback = (state: ScrollFnState) => void;

interface UseScrollFnOpts {
  scrollableRef: RefObject<HTMLElement>;
  distanceFromStart?: number;
  distanceFromEnd?: number;
  scrollThresholdStart?: number;
  scrollThresholdEnd?: number;
  direction?: ScrollAxis;
  distanceFromStartPx?: number;
  distanceFromEndPx?: number;
  init?: unknown;
}

export default function useScrollFn(
  {
    scrollableRef,
    distanceFromStart = 1, // ratio of clientHeight/clientWidth
    distanceFromEnd = 1, // ratio of clientHeight/clientWidth
    scrollThresholdStart = 10,
    scrollThresholdEnd = 10,
    direction = 'vertical',
    distanceFromStartPx: _distanceFromStartPx,
    distanceFromEndPx: _distanceFromEndPx,
    init,
  }: UseScrollFnOpts,
  callback?: ScrollFnCallback,
): { resetScrollDirection: () => void } | undefined {
  const isVertical = direction === 'vertical';
  const previousScrollStart = useRef<number | null>(null);
  const scrollDirection = useRef<ScrollDirection>(null);

  const onScroll = useThrottledCallback(
    () => {
      if (!callback) return;
      let reachStart = false;
      let reachEnd = false;
      let nearReachStart = false;
      let nearReachEnd = false;

      const scrollableElement = scrollableRef.current!;
      const {
        scrollTop,
        scrollLeft,
        scrollHeight,
        scrollWidth,
        clientHeight,
        clientWidth,
      } = scrollableElement;
      const scrollStart = isVertical ? scrollTop : scrollLeft;
      const scrollDimension = isVertical ? scrollHeight : scrollWidth;
      const clientDimension = isVertical ? clientHeight : clientWidth;
      const scrollDelta = scrollStart - (previousScrollStart.current ?? 0);
      const isScrollingForward = scrollDelta > 0;
      const threshold = isScrollingForward
        ? scrollThresholdEnd
        : scrollThresholdStart;
      const distanceFromStartPx =
        _distanceFromStartPx ||
        Math.min(
          clientDimension * distanceFromStart,
          scrollDimension,
          scrollStart,
        );
      const distanceFromEndPx =
        _distanceFromEndPx ||
        Math.min(
          clientDimension * distanceFromEnd,
          scrollDimension,
          scrollDimension - scrollStart - clientDimension,
        );

      if (Math.abs(scrollDelta) >= threshold) {
        scrollDirection.current = isScrollingForward ? 'end' : 'start';
        previousScrollStart.current = scrollStart;
      }

      reachStart = scrollStart <= 0;
      reachEnd = scrollStart + clientDimension >= scrollDimension;
      nearReachStart = scrollStart <= distanceFromStartPx;
      nearReachEnd =
        scrollStart + clientDimension >= scrollDimension - distanceFromEndPx;

      callback({
        scrollDirection: scrollDirection.current,
        reachStart,
        reachEnd,
        nearReachStart,
        nearReachEnd,
      });
    },
    500,
    {
      leading: false,
    },
  );

  const hasCallback = !!callback;
  useLayoutEffect(() => {
    if (!hasCallback) return undefined;
    const scrollableElement = scrollableRef.current;
    if (scrollableElement) {
      previousScrollStart.current =
        scrollableElement[isVertical ? 'scrollTop' : 'scrollLeft'];
      scrollableElement.addEventListener('scroll', onScroll as EventListener, {
        passive: true,
      });
    }
    return () => {
      if (scrollableElement) {
        scrollableElement.removeEventListener(
          'scroll',
          onScroll as EventListener,
        );
      }
    };
  }, [hasCallback, scrollableRef, isVertical, onScroll]);

  useEffect(() => {
    if (!hasCallback) return;
    if (init && scrollableRef.current) {
      queueMicrotask(() => {
        scrollableRef.current!.dispatchEvent(new Event('scroll'));
      });
    }
  }, [init, hasCallback, scrollableRef]);

  if (!callback) return undefined;

  return {
    resetScrollDirection: () => {
      scrollDirection.current = null;
    },
  };
}

import { useEffect, useRef } from 'react';

type IntervalCallback = () => void;
type IntervalDelay = number | null | false;

function useInterval(
  fn: IntervalCallback,
  delay: IntervalDelay,
  deps?: ReadonlyArray<unknown>,
  immediate?: boolean,
): void {
  const savedCallback = useRef<IntervalCallback>(fn);
  useEffect(() => {
    savedCallback.current = fn;
  }, [fn, deps]);

  // Track latest `delay` in a ref so the immediate-fire effect reads the
  // current value without re-subscribing to it. This preserves the original
  // semantic: immediate only fires on `immediate` toggle, never on delay
  // changes.
  const delayRef = useRef<IntervalDelay>(delay);
  useEffect(() => {
    delayRef.current = delay;
  }, [delay]);

  useEffect(() => {
    const currentDelay = delayRef.current;
    if (!immediate || currentDelay === null || currentDelay === false) return;
    savedCallback.current();
  }, [immediate]);

  useEffect(() => {
    if (delay === null || delay === false) return undefined;
    const tick = () => {
      savedCallback.current();
    };
    const id = setInterval(tick, delay);
    return () => {
      clearInterval(id);
    };
  }, [delay]);
}

export default useInterval;

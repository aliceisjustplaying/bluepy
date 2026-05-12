import { useEffect, useRef } from 'preact/hooks';

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

  useEffect(() => {
    if (!immediate || delay === null || delay === false) return;
    savedCallback.current();
  }, [immediate]);

  useEffect(() => {
    if (delay === null || delay === false) return;
    const tick = () => savedCallback.current();
    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay]);
}

export default useInterval;

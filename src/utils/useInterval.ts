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
    // TODO(oxlint:react-hooks/exhaustive-deps) intentionally fires only on
    // immediate toggle; including delay would refire on every interval change.
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

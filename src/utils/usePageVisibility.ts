import { useEffect, useRef } from 'react';

type VisibilityCallback = (visible: boolean) => void;

export default function usePageVisibility(
  fn: VisibilityCallback = () => {},
  deps: ReadonlyArray<unknown> = [],
) {
  const savedCallback = useRef<VisibilityCallback>(fn);
  useEffect(() => {
    savedCallback.current = fn;
  }, [fn, deps]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const hidden = document.hidden || document.visibilityState === 'hidden';
      console.log('👀 Page visibility changed', hidden ? 'hidden' : 'visible');
      savedCallback.current(!hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
}

import { useEffect, useRef } from 'react';

type CloseWatcherCtor = new () => {
  addEventListener(type: 'close', listener: (event: Event) => void): void;
  destroy(): void;
};

declare global {
  interface Window {
    CloseWatcher?: CloseWatcherCtor;
  }
}

const CloseWatcher = window.CloseWatcher;

// NOTE: The order of initialized close watchers is important
// Last one will intercept first if there are multiple/nested close watchers
// So if this hook reruns, the previous close watcher will be destroyed, the
// new one will be created and the order will change.
//
// The CloseWatcher is created when `fn` is callable and torn down when it
// becomes null/undefined (or on unmount). Within a single "active" span we
// forward the latest `fn` through a ref so re-renders that produce a fresh
// inline callback do not destroy and rebuild the underlying watcher
// (which would silently re-shuffle nested watcher ordering on each render).
// The `deps` parameter is retained for source-compatibility with existing
// call sites; explicit re-attachment is no longer required to avoid stale
// closures because the listener always reads the current `fn` via the ref.
function useCloseWatcher(
  fn: ((event?: Event) => void) | null | undefined,
  _deps: readonly unknown[] = [],
): void {
  const fnRef = useRef<typeof fn>(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  // Track whether `fn` is currently callable. Toggling activation tears the
  // watcher down or recreates it, preserving the original "fn becomes null
  // -> watcher destroyed" semantic.
  const active = typeof fn === 'function';

  useEffect(() => {
    if (!active || !CloseWatcher) return undefined;
    console.log('useCloseWatcher');
    const watcher = new CloseWatcher();
    watcher.addEventListener('close', (event) => {
      fnRef.current?.(event);
    });
    return () => {
      watcher.destroy();
    };
  }, [active]);
}

export default CloseWatcher
  ? useCloseWatcher
  : ((() => {}) as typeof useCloseWatcher);

import { useEffect } from 'preact/hooks';

type CloseWatcherCtor = new () => {
  addEventListener(type: 'close', listener: (event: Event) => void): void;
  destroy(): void;
};

const CloseWatcher = (window as unknown as { CloseWatcher?: CloseWatcherCtor })
  .CloseWatcher;

// NOTE: The order of initialized close watchers is important
// Last one will intercept first if there are multiple/nested close watchers
// So if this hook reruns, the previous close watcher will be destroyed, the new one will be created and the order will change
function useCloseWatcher(
  fn: ((event: Event) => void) | null | undefined,
  deps: readonly unknown[] = [],
): void {
  useEffect(() => {
    if (!fn || typeof fn !== 'function') return undefined;
    console.log('useCloseWatcher');
    const watcher = new (CloseWatcher as CloseWatcherCtor)();
    watcher.addEventListener('close', fn);
    return () => {
      watcher.destroy();
    };
    // TODO(oxlint:react-hooks/exhaustive-deps): deps is a parameter array, not
    // an array literal; this is the hook's documented API for caller-supplied
    // dependencies. Cannot statically verify, by design.
  }, deps);
}

export default CloseWatcher
  ? useCloseWatcher
  : ((() => {}) as typeof useCloseWatcher);

import { getAtprotoPostPathFromStatusRoute } from './atproto-route';

function normalizeAppPath(path: string): string {
  if (!path) return '/';
  if (path.startsWith('#')) return normalizeAppPath(path.replace(/^#/, ''));
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    if (url.origin !== location.origin) return path;
    return normalizeAppPath(`${url.pathname}${url.search}${url.hash}`);
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function canonicalizeAppPath(path: string): string {
  const normalized = normalizeAppPath(path);
  return getAtprotoPostPathFromStatusRoute(normalized) || normalized;
}

function currentAppPath(): string {
  return `${location.pathname}${location.search}`;
}

function isModifiedClick(e: React.MouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1;
}

function navigatePath(
  path: string,
  { replace = false }: { replace?: boolean } = {},
): void {
  const next = canonicalizeAppPath(path);
  if (/^https?:\/\//i.test(next)) {
    location.href = next;
    return;
  }
  if (next === currentAppPath()) return;
  if (replace) {
    history.replaceState(history.state, '', next);
  } else {
    history.pushState(history.state, '', next);
  }
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}

function migrateLegacyHashRoute(): void {
  const hash = location.hash.replace(/^#/, '');
  if (!hash.startsWith('/')) return;
  if (location.pathname !== '/' && location.pathname !== '') return;
  const next = canonicalizeAppPath(hash);
  history.replaceState(history.state, '', next);
}

export {
  canonicalizeAppPath,
  currentAppPath,
  isModifiedClick,
  migrateLegacyHashRoute,
  navigatePath,
  normalizeAppPath,
};

import {
  decodeAtprotoRecordPath,
  getAtprotoPathFromLegacyRoute,
} from './atproto-route';

function normalizeAppPath(path: string): string {
  if (!path) return '/';
  if (path.startsWith('#')) return normalizeAppPath(path.replace(/^#/, ''));
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    if (url.origin !== location.origin) return path;
    return normalizeAppPath(`${url.pathname}${url.search}${url.hash}`);
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return decodeAtprotoRecordPath(normalized);
}

function canonicalizeAppPath(path: string): string {
  const normalized = normalizeAppPath(path);
  return getAtprotoPathFromLegacyRoute(normalized) || normalized;
}

function currentAppPath(): string {
  return `${location.pathname}${location.search}`;
}

function getPrevLocationSnapshot(): { pathname: string; search: string } {
  const currentURL = new URL(currentAppPath(), location.origin);
  return {
    pathname: currentURL.pathname,
    search: currentURL.search,
  };
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

function migrateLegacyCanonicalRoute(): void {
  const current = currentAppPath();
  const next = canonicalizeAppPath(current);
  if (next === current) return;
  history.replaceState(history.state, '', `${next}${location.hash}`);
}

export {
  canonicalizeAppPath,
  currentAppPath,
  getPrevLocationSnapshot,
  isModifiedClick,
  migrateLegacyCanonicalRoute,
  migrateLegacyHashRoute,
  navigatePath,
};

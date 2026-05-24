import { isStatusPath } from './atproto-route';
import { canonicalizeAppPath, currentAppPath } from './router';

const STACK_KEY = 'bluepy:post-deck-back-stack';
const CLOSE_KEY = 'bluepy:post-deck-close-link';

function safeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return canonicalizeAppPath(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

function readPostDeckBackStack(): string[] {
  try {
    const value: unknown = JSON.parse(
      window.sessionStorage.getItem(STACK_KEY) || '[]',
    );
    if (!Array.isArray(value)) return [];
    return value
      .map(safeInternalPath)
      .filter((path): path is string => !!path && isStatusPath(path));
  } catch {
    return [];
  }
}

function writePostDeckBackStack(stack: string[]): void {
  window.sessionStorage.setItem(STACK_KEY, JSON.stringify(stack));
}

export function pushPostDeckBackEntry(path = currentAppPath()): void {
  const entry = safeInternalPath(path);
  if (!entry || !isStatusPath(entry)) return;
  const stack = readPostDeckBackStack().filter((item) => item !== entry);
  stack.push(entry);
  writePostDeckBackStack(stack);
}

export function peekPostDeckBackEntry(): string | null {
  return readPostDeckBackStack().at(-1) ?? null;
}

export function popPostDeckBackEntry(): string | null {
  const stack = readPostDeckBackStack();
  const entry = stack.pop() ?? null;
  writePostDeckBackStack(stack);
  return entry;
}

export function clearPostDeckBackStack(): void {
  window.sessionStorage.removeItem(STACK_KEY);
  window.sessionStorage.removeItem(CLOSE_KEY);
}

export function setPostDeckCloseLink(path: string): void {
  const closeLink = safeInternalPath(path);
  if (!closeLink || isStatusPath(closeLink)) return;
  window.sessionStorage.setItem(CLOSE_KEY, closeLink);
}

export function getPostDeckCloseLink(): string | null {
  return safeInternalPath(window.sessionStorage.getItem(CLOSE_KEY));
}

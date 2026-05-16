const CANONICAL_ORIGIN = 'https://bluepy.social';
const LEGACY_ORIGIN = 'https://bluepy.mosphere.at';
const MIGRATION_KEY = 'bluepy-origin-migration-v1';
const MIGRATION_TIMEOUT = 2000;

interface MigrationPayload {
  readonly type?: unknown;
  readonly version?: unknown;
  readonly target?: unknown;
  readonly localStorage?: unknown;
  readonly sessionStorage?: unknown;
}

function dumpStorage(storage: Storage): Array<[string, string | null]> {
  const entries: Array<[string, string | null]> = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key) entries.push([key, storage.getItem(key)]);
  }
  return entries;
}

function importPairs(storage: Storage, pairs: unknown): void {
  if (!Array.isArray(pairs)) return;
  for (const [key, value] of pairs as Array<[unknown, unknown]>) {
    if (typeof key !== 'string' || typeof value !== 'string') continue;
    if (storage.getItem(key) === null) storage.setItem(key, value);
  }
}

function importMigrationPayload(payload: unknown): boolean {
  const p = payload as MigrationPayload | null | undefined;
  if (
    p?.type !== 'bluepy:storage-export' ||
    p.version !== 1 ||
    p.target !== CANONICAL_ORIGIN
  ) {
    return false;
  }
  importPairs(localStorage, p.localStorage);
  importPairs(sessionStorage, p.sessionStorage);
  localStorage.setItem(MIGRATION_KEY, 'imported');
  return true;
}

function importWindowNameMigration(): boolean {
  if (!window.name) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(window.name);
  } catch {
    return false;
  }
  const referrerOrigin = document.referrer
    ? new URL(document.referrer).origin
    : null;
  if (referrerOrigin !== LEGACY_ORIGIN) return false;
  window.name = '';
  return importMigrationPayload(payload);
}

export function redirectLegacyOrigin() {
  if (window.location.origin !== LEGACY_ORIGIN) return false;
  const nextURL = new URL(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
    CANONICAL_ORIGIN,
  );
  window.name = JSON.stringify({
    type: 'bluepy:storage-export',
    version: 1,
    target: CANONICAL_ORIGIN,
    localStorage: dumpStorage(localStorage),
    sessionStorage: dumpStorage(sessionStorage),
  });
  window.location.replace(nextURL.href);
  return true;
}

export async function importLegacyOriginStorage(): Promise<boolean> {
  if (window.location.origin !== CANONICAL_ORIGIN) return false;
  try {
    if (importWindowNameMigration()) return true;
  } catch (error) {
    console.warn('Failed to import legacy Bluepy storage', error);
  }
  if (localStorage.getItem(MIGRATION_KEY)) return false;
  if (localStorage.getItem('accounts')) {
    localStorage.setItem(MIGRATION_KEY, 'skipped-existing-accounts');
    return false;
  }

  const iframe = document.createElement('iframe');
  let onMessage: ((event: MessageEvent) => void) | undefined;
  try {
    const messagePromise = new Promise<boolean>((resolve) => {
      onMessage = (event: MessageEvent): void => {
        if (event.origin !== LEGACY_ORIGIN) return;
        try {
          if (importMigrationPayload(event.data)) resolve(true);
        } catch (error) {
          console.warn('Failed to import legacy Bluepy storage', error);
          localStorage.setItem(MIGRATION_KEY, 'failed');
          resolve(false);
        }
      };
      window.addEventListener('message', onMessage);
    });

    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        try {
          localStorage.setItem(MIGRATION_KEY, 'timeout');
        } catch {
          /* ignore */
        }
        resolve(false);
      }, MIGRATION_TIMEOUT);
    });

    iframe.hidden = true;
    iframe.src = `${LEGACY_ORIGIN}/migrate-storage.html?target=${encodeURIComponent(
      CANONICAL_ORIGIN,
    )}`;
    document.body.append(iframe);
    return await Promise.race([messagePromise, timeoutPromise]);
  } finally {
    if (onMessage) window.removeEventListener('message', onMessage);
    iframe.remove();
  }
}

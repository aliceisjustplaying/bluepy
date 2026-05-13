import { deepEqual } from 'fast-equals';
import { proxy, subscribe } from 'valtio';
import { subscribeKey } from 'valtio/utils';

import { api } from './api';
import isMastodonLinkMaybe from './is-mastodon-link-maybe';
import pmem from './pmem';
import rateLimit from './ratelimit';
import { shouldFetchThreadParent } from './reply-context';
import store from './store';
import unfurlMastodonLinkRaw from './unfurl-link';

// Intentionally loose typings — this hub is mutated by 60+ consumers and 139
// direct writes. Narrower Status / Account shapes belong in later waves; doing
// it here would force breaking churn on every caller. See CLAUDE.md OODA loop.

type Status = Record<string, unknown> & {
  id?: string;
  url?: string;
  uri?: string;
  content?: string;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  account?: { id?: string } & Record<string, unknown>;
  reblog?: Status | null;
  quote?: Status | null;
  // Native Mastodon quote shape: { state, quotedStatus }
  state?: unknown;
  quotedStatus?: Status | null;
  _pinned?: unknown;
};

type Account = Record<string, unknown>;

interface PrevLocation {
  pathname?: string;
  [key: string]: unknown;
}

interface ReloadGenericAccounts {
  id: string | null;
  counter: number;
}

interface StatesSettings {
  autoRefresh: boolean;
  shortcutsViewMode: string | null;
  shortcutsColumnsMode: boolean;
  boostsCarousel: boolean;
  contentTranslation: boolean;
  contentTranslationTargetLanguage: string | null;
  contentTranslationHideLanguages: string[];
  contentTranslationAutoInline: boolean;
  shortcutSettingsCloudImportExport: boolean;
  mediaAltGenerator: boolean;
  composerGIFPicker: boolean;
  cloakMode: boolean;
  noAnimations: boolean;
  // Future settings keys land here without touching this hub.
  [key: string]: unknown;
}

// Top-level shape of the states proxy. Values are intentionally loose
// (`unknown`, `Record<string, unknown>`, plain arrays) so consumer mutations
// don't fight the types. The proxy itself remains writable — do NOT wrap in
// Readonly<...>.
interface StateProxy {
  appVersion: Record<string, unknown>;
  prevLocation: PrevLocation | null;
  currentLocation: string | null;
  statuses: Record<string, Status>;
  statusThreadNumber: Record<string, number>;
  home: unknown[];
  homeNew: unknown[];
  homeLast: unknown;
  homeLastFetchTime: number | null;
  notifications: unknown[];
  notificationsLast: unknown;
  notificationsNew: unknown[];
  notificationsShowNew: boolean;
  notificationsLastFetchTime: number | null;
  reloadStatusPage: number;
  reloadGenericAccounts: ReloadGenericAccounts;
  reloadScheduledPosts: number;
  spoilers: Record<string, unknown>;
  spoilersMedia: Record<string, unknown>;
  revealedQuotes: Record<string, unknown>;
  scrollPositions: Record<string, unknown>;
  unfurledLinks: Record<string, unknown>;
  statusQuotes: Record<string, unknown[]>;
  statusFollowedTags: Record<string, unknown>;
  statusReply: Record<string, unknown>;
  accounts: Record<string, Account>;
  routeNotification: unknown;
  composerState: Record<string, unknown>;
  // Modals. All `show*` keys can hold a boolean (closed/open) or a payload
  // object describing what to render — `compose-button` even assigns
  // `opts || true`. Keep them as `unknown` so consumers can read/write either
  // shape; narrowing happens at consumer sites.
  showCompose: unknown;
  showSettings: unknown;
  showAccount: unknown;
  showAccounts: unknown;
  showDrafts: unknown;
  showMediaModal: unknown;
  showShortcutsSettings: unknown;
  showKeyboardShortcutsHelp: unknown;
  showGenericAccounts: unknown;
  showMediaAlt: unknown;
  showEmbedModal: unknown;
  showReportModal: unknown;
  showQrCodeModal: unknown;
  showQrScannerModal: unknown;
  showImportExportAccounts: unknown;
  showSearchCommand: unknown;
  // showOpenLink is assigned by consumers (handle-content-links.js,
  // modals.jsx) but is not initialised in the proxy literal. Declared on the
  // interface for type-level visibility; the index signature would cover it
  // either way.
  showOpenLink?: unknown;
  // Shortcuts
  shortcuts: unknown[];
  // Settings
  settings: StatesSettings;
  // Allow ad-hoc keys added by consumers without breaking this hub. The
  // existing JS proxy is open; mirroring that here avoids forcing every
  // future consumer-side addition through this file.
  [key: string]: unknown;
}

// `unfurl-link.js` is still untyped (peer module — converted in a later wave).
// Shim its default export here; the next wave that types unfurl-link removes
// this cast.
const unfurlMastodonLink = unfurlMastodonLinkRaw as unknown as (
  instance: string | undefined,
  url: string,
) => Promise<(Status & { id?: string }) | null | undefined>;

// Restore prevLocation from sessionStorage for page reload persistence
function restorePrevLocation(): PrevLocation | null {
  const saved = store.session.getJSON<PrevLocation>('prevLocation');
  if (saved && saved.pathname) {
    return saved;
  }
  return null;
}

const states = proxy<StateProxy>({
  appVersion: {},
  // history: [],
  prevLocation: restorePrevLocation(),
  currentLocation: null,
  statuses: {},
  statusThreadNumber: {},
  home: [],
  // specialHome: [],
  homeNew: [],
  homeLast: null, // Last item in 'home' list
  homeLastFetchTime: null,
  notifications: [],
  notificationsLast: null, // Last read notification
  notificationsNew: [],
  notificationsShowNew: false,
  notificationsLastFetchTime: null,
  reloadStatusPage: 0,
  reloadGenericAccounts: {
    id: null,
    counter: 0,
  },
  reloadScheduledPosts: 0,
  spoilers: {},
  spoilersMedia: {},
  revealedQuotes: {},
  scrollPositions: {},
  unfurledLinks: {},
  statusQuotes: {},
  statusFollowedTags: {},
  statusReply: {},
  accounts: {},
  routeNotification: null,
  composerState: {},
  // Modals
  showCompose: false,
  showSettings: false,
  showAccount: false,
  showAccounts: false,
  showDrafts: false,
  showMediaModal: false,
  showShortcutsSettings: false,
  showKeyboardShortcutsHelp: false,
  showGenericAccounts: false,
  showMediaAlt: false,
  showEmbedModal: false,
  showReportModal: false,
  showQrCodeModal: false,
  showQrScannerModal: false,
  showImportExportAccounts: false,
  showSearchCommand: false,
  // Shortcuts
  shortcuts: [],
  // Settings
  settings: {
    autoRefresh: false,
    shortcutsViewMode: null,
    shortcutsColumnsMode: false,
    boostsCarousel: true,
    contentTranslation: true,
    contentTranslationTargetLanguage: null,
    contentTranslationHideLanguages: [],
    contentTranslationAutoInline: false,
    shortcutSettingsCloudImportExport: false,
    mediaAltGenerator: false,
    composerGIFPicker: false,
    cloakMode: false,
    noAnimations: false,
  },
});

export default states;

export function initStates(): void {
  // init all account based states
  // all keys that uses store.account.get() should be initialized here
  states.notificationsLast = store.account.get('notificationsLast') || null;
  states.shortcuts =
    (store.account.get('shortcuts') as unknown[] | null | undefined) ?? [];
  states.settings.autoRefresh =
    (store.account.get('settings-autoRefresh') as boolean | null | undefined) ??
    false;
  const shortcutsViewMode = store.account.get('settings-shortcutsViewMode') as
    | string
    | null
    | undefined;
  states.settings.shortcutsViewMode =
    shortcutsViewMode === 'multi-column' ? null : (shortcutsViewMode ?? null);
  states.settings.shortcutsColumnsMode = false;
  states.settings.boostsCarousel =
    (store.account.get('settings-boostsCarousel') as
      | boolean
      | null
      | undefined) ?? true;
  states.settings.contentTranslation =
    (store.account.get('settings-contentTranslation') as
      | boolean
      | null
      | undefined) ?? true;
  states.settings.contentTranslationTargetLanguage =
    (store.account.get('settings-contentTranslationTargetLanguage') as
      | string
      | null
      | undefined) || null;
  states.settings.contentTranslationHideLanguages =
    (store.account.get('settings-contentTranslationHideLanguages') as
      | string[]
      | null
      | undefined) || [];
  states.settings.contentTranslationAutoInline =
    (store.account.get('settings-contentTranslationAutoInline') as
      | boolean
      | null
      | undefined) ?? false;
  states.settings.shortcutSettingsCloudImportExport =
    (store.account.get('settings-shortcutSettingsCloudImportExport') as
      | boolean
      | null
      | undefined) ?? false;
  states.settings.mediaAltGenerator =
    (store.account.get('settings-mediaAltGenerator') as
      | boolean
      | null
      | undefined) ?? false;
  states.settings.composerGIFPicker =
    (store.account.get('settings-composerGIFPicker') as
      | boolean
      | null
      | undefined) ?? false;
  states.settings.cloakMode =
    (store.account.get('settings-cloakMode') as
      | boolean
      | null
      | undefined) ?? false;
  states.settings.noAnimations =
    (store.account.get('settings-noAnimations') as
      | boolean
      | null
      | undefined) ?? false;
  // Apply persisted body classes on init (subscribe handlers only fire on change)
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle(
      'no-animations',
      states.settings.noAnimations,
    );
  }
}

subscribeKey(states, 'notificationsLast', (v) => {
  console.log('CHANGE', v);
  store.account.set('notificationsLast', states.notificationsLast);
});
subscribe(states, (changes) => {
  console.debug('STATES change', changes);
  for (const [, path, value] of changes) {
    if (path.join('.') === 'settings.autoRefresh') {
      store.account.set('settings-autoRefresh', !!value);
    }
    if (path.join('.') === 'settings.boostsCarousel') {
      store.account.set('settings-boostsCarousel', !!value);
    }
    if (path.join('.') === 'settings.shortcutsViewMode') {
      store.account.set(
        'settings-shortcutsViewMode',
        value === 'multi-column' ? null : value,
      );
    }
    if (path.join('.') === 'settings.contentTranslation') {
      store.account.set('settings-contentTranslation', !!value);
    }
    if (path.join('.') === 'settings.contentTranslationAutoInline') {
      store.account.set('settings-contentTranslationAutoInline', !!value);
    }
    if (path.join('.') === 'settings.shortcutSettingsCloudImportExport') {
      store.account.set('settings-shortcutSettingsCloudImportExport', !!value);
    }
    if (path.join('.') === 'settings.contentTranslationTargetLanguage') {
      console.log('SET', value);
      store.account.set('settings-contentTranslationTargetLanguage', value);
    }
    if (/^settings\.contentTranslationHideLanguages/i.test(path.join('.'))) {
      store.account.set(
        'settings-contentTranslationHideLanguages',
        states.settings.contentTranslationHideLanguages,
      );
    }
    if (path.join('.') === 'settings.mediaAltGenerator') {
      store.account.set('settings-mediaAltGenerator', !!value);
    }
    if (path.join('.') === 'settings.composerGIFPicker') {
      store.account.set('settings-composerGIFPicker', !!value);
    }
    if (path?.[0] === 'shortcuts') {
      store.account.set('shortcuts', states.shortcuts);
    }
    if (path.join('.') === 'settings.cloakMode') {
      store.account.set('settings-cloakMode', !!value);
    }
    if (path.join('.') === 'settings.noAnimations') {
      store.account.set('settings-noAnimations', !!value);
    }
  }
});

export function hideAllModals(): void {
  states.showCompose = false;
  states.showSettings = false;
  states.showAccount = false;
  states.showAccounts = false;
  states.showDrafts = false;
  states.showMediaModal = false;
  states.showShortcutsSettings = false;
  states.showKeyboardShortcutsHelp = false;
  states.showGenericAccounts = false;
  states.showMediaAlt = false;
  states.showEmbedModal = false;
  states.showReportModal = false;
  states.showQrCodeModal = false;
  states.showQrScannerModal = false;
  states.showImportExportAccounts = false;
}

export function statusKey(
  id: string | null | undefined,
  instance?: string | null,
): string | undefined {
  if (!id) return;
  return instance ? `${instance}/${id}` : id;
}

export function getStatus(
  statusID: string | null | undefined,
  instance?: string | null,
): Status | undefined {
  if (instance) {
    const key = statusKey(statusID, instance);
    if (!key) return undefined;
    return states.statuses[key];
  }
  if (!statusID) return undefined;
  return states.statuses[statusID];
}

function saveStatusInternal(
  status: Status,
  instance: string | null | undefined,
  oldStatus: Status | undefined,
): void {
  let key = statusKey(status.id, instance);
  if (!key) return;
  if (oldStatus?._pinned) status._pinned = oldStatus._pinned;
  // if (oldStatus?._filtered) status._filtered = oldStatus._filtered;
  states.statuses[key] = status;
  if (status.reblog?.id) {
    const srKey = statusKey(status.reblog.id, instance);
    if (srKey) {
      states.statuses[srKey] = status.reblog;
      // Re-assign key to the actual status
      key = srKey;
    }
  }
  const theQuote = status.reblog?.quote || status.quote;
  if (theQuote?.id) {
    const { id } = theQuote;
    const sKey = statusKey(id, instance);
    if (sKey) {
      states.statuses[sKey] = theQuote;
      const selfURL = `/${instance}/s/${id}`;
      states.statusQuotes[key] = [
        {
          id,
          instance,
          url: selfURL,
          native: true,
        },
      ];
    }
  }
  // Mastodon native quotes
  if (theQuote?.state) {
    const { quotedStatus, state } = theQuote;
    if (quotedStatus?.id) {
      const { id, account } = quotedStatus;
      const selfURL = `/${instance}/s/${id}`;
      const sKey = statusKey(id, instance);
      if (sKey) {
        states.statuses[sKey] = quotedStatus;
        states.statusQuotes[key] = [
          {
            id,
            instance,
            url: selfURL,
            state,
            account,
            native: true,
          },
        ];
      }
    } else {
      // Possibly "revoked"
      states.statusQuotes[key] = [
        {
          // There's not much info here
          state,
          native: true,
        },
      ];
    }
  }
}

interface PendingStatusSave {
  status: Status;
  instance: string | null | undefined;
  oldStatus: Status | undefined;
}

const pendingStatusSaves: PendingStatusSave[] = [];
let saveStatusFlushScheduled = false;

function flushPendingStatusSaves(): void {
  saveStatusFlushScheduled = false;
  const saves = pendingStatusSaves.splice(0);
  for (const { status, instance, oldStatus } of saves) {
    saveStatusInternal(status, instance, oldStatus);
  }
}

function queueSaveStatus(
  status: Status,
  instance: string | null | undefined,
  oldStatus: Status | undefined,
): void {
  pendingStatusSaves.push({ status, instance, oldStatus });
  if (saveStatusFlushScheduled) return;
  saveStatusFlushScheduled = true;
  queueMicrotask(flushPendingStatusSaves);
}

interface SaveStatusOpts {
  override?: boolean;
  skipThreading?: boolean;
  skipUnfurling?: boolean;
  sync?: boolean;
}

export function saveStatus(
  status: Status | null | undefined,
  instance?: string | SaveStatusOpts | null,
  opts?: SaveStatusOpts,
): void {
  let resolvedInstance: string | null | undefined;
  let resolvedOpts: SaveStatusOpts | undefined = opts;
  if (typeof instance === 'object' && instance !== null) {
    resolvedOpts = instance;
    resolvedInstance = null;
  } else {
    resolvedInstance = instance as string | null | undefined;
  }
  const {
    override = true,
    skipThreading = false,
    skipUnfurling = false,
    sync = false,
  } = resolvedOpts || {};
  if (!status) return;
  const oldStatus = getStatus(status.id, resolvedInstance);
  if (!override && oldStatus) return;
  if (deepEqual(status, oldStatus)) return;

  if (sync) {
    saveStatusInternal(status, resolvedInstance, oldStatus);
  } else {
    queueSaveStatus(status, resolvedInstance, oldStatus);
  }

  // THREAD TRAVERSER
  if (!skipThreading) {
    setTimeout(() => {
      threadifyStatus(status.reblog || status, resolvedInstance);
    }, 100);
  }

  // UNFURLER
  if (!skipUnfurling) {
    setTimeout(() => {
      unfurlStatus(status.reblog || status, resolvedInstance);
    }, 100);
  }
}

function _threadifyStatus(
  status: Status,
  propInstance?: string | null,
): Promise<void> | void {
  const { masto, instance } = api({ instance: propInstance ?? undefined });
  // Return all statuses in the thread, via inReplyToId, if inReplyToAccountId === account.id
  let fetchIndex = 0;
  async function traverse(status: Status, index = 0): Promise<Status[]> {
    if (!shouldFetchThreadParent({ status, instance })) {
      return [status];
    }
    const { inReplyToId } = status;
    const key = statusKey(inReplyToId, instance);
    let prevStatus: Status | undefined = key
      ? states.statuses[key]
      : undefined;
    if (!prevStatus) {
      if (fetchIndex++ > 3) throw 'Too many fetches for thread'; // Some people revive old threads
      await new Promise<void>((r) => setTimeout(r, 500 * fetchIndex)); // Be nice to rate limits
      // prevStatus = await masto.v1.statuses.$.select(inReplyToId).fetch();
      prevStatus = (await fetchStatus(inReplyToId as string, masto)) as Status;
      saveStatus(prevStatus, instance, { skipThreading: true });
    }
    // Prepend so that first status in thread will be index 0
    return [...(await traverse(prevStatus, ++index)), status];
  }
  return traverse(status)
    .then((statuses) => {
      if (statuses.length > 1) {
        console.debug('THREAD', statuses);
        statuses.forEach((status, index) => {
          const key = statusKey(status.id, instance);
          if (key) {
            states.statusThreadNumber[key] = index + 1;
          }
        });
      }
    })
    .catch((e: unknown) => {
      console.error(e, status);
    });
}
export const threadifyStatus = rateLimit(
  _threadifyStatus as (this: unknown, ...args: unknown[]) => void,
  100,
) as (status: Status, propInstance?: string | null) => void;

const fauxDiv = document.createElement('div');
export function unfurlStatus(
  status: Status | null | undefined,
  instance?: string | null,
): void {
  const { instance: currentInstance } = api();
  const content = status?.content;
  if (!content) return;
  const hasLink = /<a/i.test(content);
  if (hasLink) {
    const sKey = statusKey(status?.id, instance);
    fauxDiv.innerHTML = content;
    const links = fauxDiv.querySelectorAll<HTMLAnchorElement>(
      'a[href]:not(.u-url):not(.mention):not(.hashtag)',
    );
    [...links]
      .filter((a) => {
        const url = a.href;
        const isPostItself = url === status?.url || url === status?.uri;
        return !isPostItself && isMastodonLinkMaybe(url);
      })
      .forEach((a, i) => {
        unfurlMastodonLink(currentInstance, a.href).then((result) => {
          if (!result) return;
          if (!sKey) return;
          if (result?.id === status?.id) {
            // Unfurled post is the post itself???
            // Scenario:
            // 1. Post with [URL]
            // 2. Unfurl [URL], API returns the same post that contains [URL]
            // 3. 💥 Recursive quote posts 💥
            // Note: Mastodon search doesn't return posts that contains [URL], it's actually used to *resolve* the URL
            // But some non-Mastodon servers, their search API will eventually search posts that contains [URL] and return them
            return;
          }
          if (!Array.isArray(states.statusQuotes[sKey])) {
            states.statusQuotes[sKey] = [];
          }
          if (!states.statusQuotes[sKey][i]) {
            states.statusQuotes[sKey].splice(i, 0, result);
          }
        });
      });
  }
}

interface StatusesEndpoint {
  $select(id: string): { fetch(): Promise<Status> };
}

const fetchStatus = pmem(
  (statusID: string, masto: ReturnType<typeof api>['masto']) => {
    const statuses = masto.v1.statuses as StatusesEndpoint;
    return statuses.$select(statusID).fetch();
  },
);

import { deepEqual } from 'fast-equals';
import type { mastodon } from 'masto';
import { proxy, subscribe } from 'valtio';
import { subscribeKey } from 'valtio/utils';

import { api } from './api';
import {
  DEFAULT_MUTED_POST_VISIBILITY,
  getMutedPostVisibility,
  type MutedPostVisibility,
} from './muted-post-visibility';
import pmem from './pmem';
import rateLimit from './ratelimit';
import { shouldFetchThreadParent } from './reply-context';
import {
  persistShortcutsColumnsMode,
  persistShortcutsViewMode,
  restoreShortcutsColumnsMode,
  restoreShortcutsViewMode,
} from './settings-storage';
import {
  DEFAULT_SHARE_LINK_TARGET,
  getShareLinkTarget,
  type ShareLinkTarget,
} from './share-link-target';
import store from './store';

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
type SaveStatusStatus = Status | mastodon.v1.Status;

type Account = Record<string, unknown> | mastodon.v1.Account;

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
  mediaAltGenerator: boolean;
  composerGIFPicker: boolean;
  cloakMode: boolean;
  noAnimations: boolean;
  mutedPostVisibility: MutedPostVisibility;
  shareLinkTarget: ShareLinkTarget;
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
  spoilers: Record<string, unknown>;
  spoilersMedia: Record<string, unknown>;
  revealedQuotes: Record<string, unknown>;
  revealedMutedPosts: Record<string, boolean>;
  scrollPositions: Record<string, unknown>;
  statusQuotes: Record<string, unknown[]>;
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
  showFeedbackModal: unknown;
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
  spoilers: {},
  spoilersMedia: {},
  revealedQuotes: {},
  revealedMutedPosts: {},
  scrollPositions: {},
  statusQuotes: {},
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
  showFeedbackModal: false,
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
    mediaAltGenerator: false,
    composerGIFPicker: false,
    cloakMode: false,
    noAnimations: false,
    mutedPostVisibility: DEFAULT_MUTED_POST_VISIBILITY,
    shareLinkTarget: DEFAULT_SHARE_LINK_TARGET,
  },
});

export default states;

export function initStates(): void {
  // init all account based states
  // all keys that uses store.account.get() should be initialized here
  states.notificationsLast = store.account.get('notificationsLast') || null;
  states.shortcuts = store.account.get<unknown[]>('shortcuts') ?? [];
  states.settings.autoRefresh =
    store.account.get<boolean>('settings-autoRefresh') ?? false;
  const shortcutsViewMode = store.account.get<string>(
    'settings-shortcutsViewMode',
  );
  const shortcutsColumnsMode = restoreShortcutsColumnsMode(
    store.account.get<boolean>('settings-shortcutsColumnsMode'),
  );
  const restoredShortcutsViewMode = restoreShortcutsViewMode(
    shortcutsViewMode,
    shortcutsColumnsMode,
  );
  states.settings.shortcutsViewMode = restoredShortcutsViewMode;
  if (!shortcutsViewMode && restoredShortcutsViewMode) {
    store.account.set(
      'settings-shortcutsViewMode',
      persistShortcutsViewMode(restoredShortcutsViewMode),
    );
  }
  states.settings.shortcutsColumnsMode = shortcutsColumnsMode;
  states.settings.boostsCarousel =
    store.account.get<boolean>('settings-boostsCarousel') ?? true;
  states.settings.contentTranslation =
    store.account.get<boolean>('settings-contentTranslation') ?? true;
  states.settings.contentTranslationTargetLanguage =
    store.account.get<string>('settings-contentTranslationTargetLanguage') ||
    null;
  states.settings.contentTranslationHideLanguages =
    store.account.get<string[]>('settings-contentTranslationHideLanguages') ||
    [];
  states.settings.contentTranslationAutoInline =
    store.account.get<boolean>('settings-contentTranslationAutoInline') ??
    false;
  states.settings.mediaAltGenerator =
    store.account.get<boolean>('settings-mediaAltGenerator') ?? false;
  states.settings.composerGIFPicker =
    store.account.get<boolean>('settings-composerGIFPicker') ?? false;
  states.settings.cloakMode =
    store.account.get<boolean>('settings-cloakMode') ?? false;
  states.settings.noAnimations =
    store.account.get<boolean>('settings-noAnimations') ?? false;
  states.settings.mutedPostVisibility = getMutedPostVisibility({
    mutedPostVisibility: store.account.get<MutedPostVisibility>(
      'settings-mutedPostVisibility',
    ),
  });
  states.settings.shareLinkTarget = getShareLinkTarget(
    store.account.get<ShareLinkTarget>('settings-shareLinkTarget'),
  );
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
        persistShortcutsViewMode(value),
      );
    }
    if (path.join('.') === 'settings.shortcutsColumnsMode') {
      store.account.set(
        'settings-shortcutsColumnsMode',
        persistShortcutsColumnsMode(value),
      );
    }
    if (path.join('.') === 'settings.contentTranslation') {
      store.account.set('settings-contentTranslation', !!value);
    }
    if (path.join('.') === 'settings.contentTranslationAutoInline') {
      store.account.set('settings-contentTranslationAutoInline', !!value);
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
    if (path.join('.') === 'settings.mutedPostVisibility') {
      store.account.set(
        'settings-mutedPostVisibility',
        getMutedPostVisibility({ mutedPostVisibility: value }),
      );
    }
    if (path.join('.') === 'settings.shareLinkTarget') {
      store.account.set('settings-shareLinkTarget', getShareLinkTarget(value));
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
  states.showFeedbackModal = false;
  states.showReportModal = false;
  states.showQrCodeModal = false;
  states.showQrScannerModal = false;
  states.showImportExportAccounts = false;
}

export function statusKey(
  id: string | null | undefined,
  instance?: string | null,
): string | undefined {
  if (!id) return undefined;
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
  sync?: boolean;
}

export function saveStatus(
  status: SaveStatusStatus | null | undefined,
  instance?: string | SaveStatusOpts | null,
  opts?: SaveStatusOpts,
): void {
  let resolvedInstance: string | null | undefined;
  let resolvedOpts: SaveStatusOpts | undefined = opts;
  if (typeof instance === 'object' && instance !== null) {
    resolvedOpts = instance;
    resolvedInstance = null;
  } else {
    resolvedInstance = instance;
  }
  const {
    override = true,
    skipThreading = false,
    sync = false,
  } = resolvedOpts || {};
  if (!status) return;
  const statusForStorage = status as Status;
  const oldStatus = getStatus(statusForStorage.id, resolvedInstance);
  if (!override && oldStatus) return;
  if (deepEqual(statusForStorage, oldStatus)) return;

  if (sync) {
    saveStatusInternal(statusForStorage, resolvedInstance, oldStatus);
  } else {
    queueSaveStatus(statusForStorage, resolvedInstance, oldStatus);
  }

  // THREAD TRAVERSER
  if (!skipThreading) {
    setTimeout(() => {
      threadifyStatus(
        statusForStorage.reblog || statusForStorage,
        resolvedInstance,
      );
    }, 100);
  }
}

function threadifyStatusInternal(
  rootStatus: Status,
  propInstance?: string | null,
): Promise<void> | void {
  const { masto, instance } = api({ instance: propInstance ?? undefined });
  // Return all statuses in the thread, via inReplyToId, if inReplyToAccountId === account.id
  let fetchIndex = 0;
  async function traverse(currentStatus: Status, index = 0): Promise<Status[]> {
    if (!shouldFetchThreadParent({ status: currentStatus, instance })) {
      return [currentStatus];
    }
    const { inReplyToId } = currentStatus;
    const key = statusKey(inReplyToId, instance);
    let prevStatus: Status | undefined = key ? states.statuses[key] : undefined;
    if (!prevStatus) {
      if (fetchIndex++ > 3) throw new Error('Too many fetches for thread'); // Some people revive old threads
      await new Promise<void>((r) => {
        setTimeout(r, 500 * fetchIndex);
      }); // Be nice to rate limits
      // prevStatus = await masto.v1.statuses.$.select(inReplyToId).fetch();
      prevStatus = await fetchStatus(inReplyToId as string, masto);
      saveStatus(prevStatus, instance, { skipThreading: true });
    }
    // Prepend so that first status in thread will be index 0
    return [...(await traverse(prevStatus, ++index)), currentStatus];
  }
  return traverse(rootStatus)
    .then((statuses) => {
      if (statuses.length > 1) {
        console.debug('THREAD', statuses);
        statuses.forEach((threadStatus, index) => {
          const key = statusKey(threadStatus.id, instance);
          if (key) {
            states.statusThreadNumber[key] = index + 1;
          }
        });
      }
      return undefined;
    })
    .catch((e: unknown) => {
      console.error(e, rootStatus);
    });
}
export const threadifyStatus = rateLimit(
  threadifyStatusInternal as (this: unknown, ...args: unknown[]) => void,
  100,
) as (status: Status, propInstance?: string | null) => void;

interface StatusesEndpoint {
  $select(id: string): { fetch(): Promise<Status> };
}

const fetchStatus = pmem(
  (statusID: string, masto: ReturnType<typeof api>['masto']) => {
    const statuses = masto.v1.statuses as StatusesEndpoint;
    return statuses.$select(statusID).fetch();
  },
);

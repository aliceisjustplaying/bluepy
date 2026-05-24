import { subscribe } from 'valtio';

import states, { hideAllModals as hideAllModalsLegacy } from '../utils/states';

import {
  hideAllModals as hideAllModalsStore,
  useModalsStore,
  type ModalsState,
} from './modals';
import { useRevealsStore } from './reveals';
import { useSessionsStore } from './sessions';
import {
  bootstrapUiPreferencesForDid,
  useUiPreferencesStore,
  type UiPreferences,
} from './ui-preferences';

type ModalValtioKey =
  | 'showCompose'
  | 'showSettings'
  | 'showAccount'
  | 'showAccounts'
  | 'showDrafts'
  | 'showMediaModal'
  | 'showShortcutsSettings'
  | 'showKeyboardShortcutsHelp'
  | 'showGenericAccounts'
  | 'showMediaAlt'
  | 'showEmbedModal'
  | 'showFeedbackModal'
  | 'showReportModal'
  | 'showQrCodeModal'
  | 'showQrScannerModal'
  | 'showImportExportAccounts'
  | 'showSearchCommand'
  | 'showOpenLink';

function changedRecordEntry(
  path: (string | number | symbol)[] | string,
  value: unknown,
): [string, unknown][] {
  if (Array.isArray(path) && path.length > 1 && typeof path[1] === 'string') {
    return [[path[1], value]];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>);
  }
  return [];
}

const modalBridge: Record<
  ModalValtioKey,
  keyof Pick<
    ModalsState,
    | 'compose'
    | 'settings'
    | 'accounts'
    | 'account'
    | 'drafts'
    | 'mediaModal'
    | 'shortcutsSettings'
    | 'keyboardShortcutsHelp'
    | 'genericAccounts'
    | 'mediaAlt'
    | 'embedModal'
    | 'feedbackModal'
    | 'reportModal'
    | 'qrCodeModal'
    | 'qrScannerModal'
    | 'importExportAccounts'
    | 'searchCommand'
    | 'openLink'
  >
> = {
  showCompose: 'compose',
  showSettings: 'settings',
  showAccount: 'account',
  showAccounts: 'accounts',
  showDrafts: 'drafts',
  showMediaModal: 'mediaModal',
  showShortcutsSettings: 'shortcutsSettings',
  showKeyboardShortcutsHelp: 'keyboardShortcutsHelp',
  showGenericAccounts: 'genericAccounts',
  showMediaAlt: 'mediaAlt',
  showEmbedModal: 'embedModal',
  showFeedbackModal: 'feedbackModal',
  showReportModal: 'reportModal',
  showQrCodeModal: 'qrCodeModal',
  showQrScannerModal: 'qrScannerModal',
  showImportExportAccounts: 'importExportAccounts',
  showSearchCommand: 'searchCommand',
  showOpenLink: 'openLink',
};

export function uiPreferencesPatchFromValtioChange(
  path: string | readonly (string | symbol)[],
  value: unknown,
): Partial<UiPreferences> {
  return Array.isArray(path) && typeof path[1] === 'string'
    ? ({ [path[1]]: value } as Partial<UiPreferences>)
    : (value as Partial<UiPreferences>);
}

function setModalSlice(
  slice: (typeof modalBridge)[ModalValtioKey],
  value: unknown,
): void {
  const store = useModalsStore.getState();
  switch (slice) {
    case 'compose':
      store.setCompose(value as ModalsState['compose']);
      break;
    case 'settings':
      store.setSettings(Boolean(value));
      break;
    case 'accounts':
      store.setAccounts(Boolean(value));
      break;
    case 'account':
      store.setAccount(value as ModalsState['account']);
      break;
    case 'drafts':
      store.setDrafts(Boolean(value));
      break;
    case 'mediaModal':
      store.setMediaModal(value as ModalsState['mediaModal']);
      break;
    case 'shortcutsSettings':
      store.setShortcutsSettings(Boolean(value));
      break;
    case 'keyboardShortcutsHelp':
      store.setKeyboardShortcutsHelp(Boolean(value));
      break;
    case 'genericAccounts':
      store.setGenericAccounts(value as ModalsState['genericAccounts']);
      break;
    case 'mediaAlt':
      store.setMediaAlt(value as ModalsState['mediaAlt']);
      break;
    case 'embedModal':
      store.setEmbedModal(value as ModalsState['embedModal']);
      break;
    case 'feedbackModal':
      store.setFeedbackModal(value as ModalsState['feedbackModal']);
      break;
    case 'reportModal':
      store.setReportModal(value as ModalsState['reportModal']);
      break;
    case 'qrCodeModal':
      store.setQrCodeModal(value as ModalsState['qrCodeModal']);
      break;
    case 'qrScannerModal':
      store.setQrScannerModal(value as ModalsState['qrScannerModal']);
      break;
    case 'importExportAccounts':
      store.setImportExportAccounts(
        value as ModalsState['importExportAccounts'],
      );
      break;
    case 'searchCommand':
      store.setSearchCommand(value as ModalsState['searchCommand']);
      break;
    case 'openLink':
      store.setOpenLink(value as ModalsState['openLink']);
      break;
    default: {
      const impossible: never = slice;
      throw new Error(`Unknown modal slice: ${String(impossible)}`);
    }
  }
}

function syncModalsToValtio(state: ModalsState): void {
  for (const [valtioKey, sliceKey] of Object.entries(modalBridge) as Array<
    [ModalValtioKey, (typeof modalBridge)[ModalValtioKey]]
  >) {
    states[valtioKey] = state[sliceKey];
  }
}

function syncUiPreferencesToValtio(preferences: UiPreferences): void {
  Object.assign(states.settings, preferences);
}

function syncRevealsToValtio(): void {
  const reveals = useRevealsStore.getState();
  states.spoilers = { ...reveals.spoilers };
  states.spoilersMedia = { ...reveals.spoilersMedia };
  states.revealedQuotes = { ...reveals.revealedQuotes };
  states.revealedMutedPosts = { ...reveals.revealedMutedPosts };
}

let bridgeInitialized = false;

export function initLegacyStatesBridge(did?: string | null): void {
  if (bridgeInitialized) return;
  bridgeInitialized = true;
  let activeDid = did ?? null;

  if (activeDid) {
    bootstrapUiPreferencesForDid(
      activeDid,
      states.settings as Partial<UiPreferences>,
    );
  }
  syncModalsToValtio(useModalsStore.getState());
  syncRevealsToValtio();

  useModalsStore.subscribe((state) => {
    syncModalsToValtio(state);
  });

  useSessionsStore.subscribe((state) => {
    if (state.activeDid === activeDid) return;
    activeDid = state.activeDid;
    if (!activeDid) return;
    const preferences = bootstrapUiPreferencesForDid(
      activeDid,
      states.settings as Partial<UiPreferences>,
    );
    syncUiPreferencesToValtio(preferences);
  });

  useUiPreferencesStore.subscribe((state) => {
    if (!activeDid) return;
    syncUiPreferencesToValtio(state.getForDid(activeDid));
  });

  useRevealsStore.subscribe(() => {
    syncRevealsToValtio();
  });

  subscribe(states, (changes) => {
    for (const [, path, value] of changes) {
      const pathKey = Array.isArray(path) ? path[0] : path;
      if (typeof pathKey === 'string' && pathKey in modalBridge) {
        setModalSlice(modalBridge[pathKey as ModalValtioKey], value);
      }
      if (pathKey === 'settings' && activeDid) {
        useUiPreferencesStore
          .getState()
          .setForDid(
            activeDid,
            uiPreferencesPatchFromValtioChange(path, value),
          );
      }
      if (pathKey === 'revealedMutedPosts') {
        for (const [key, revealed] of changedRecordEntry(path, value)) {
          if (revealed) {
            useRevealsStore.getState().revealMutedPost(key);
          }
        }
      }
      if (pathKey === 'spoilers') {
        for (const [key, revealed] of changedRecordEntry(path, value)) {
          if (revealed) {
            useRevealsStore.getState().revealSpoiler(key, false);
          }
        }
      }
      if (pathKey === 'spoilersMedia') {
        for (const [key, revealed] of changedRecordEntry(path, value)) {
          if (revealed) {
            useRevealsStore.getState().revealSpoiler(key, true);
          }
        }
      }
      if (pathKey === 'revealedQuotes') {
        for (const [key, revealed] of changedRecordEntry(path, value)) {
          if (revealed) {
            useRevealsStore.getState().revealQuote(key, revealed);
          }
        }
      }
    }
  });
}

export function hideAllModals(): void {
  hideAllModalsStore();
  hideAllModalsLegacy();
}

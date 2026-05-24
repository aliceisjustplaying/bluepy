import { create } from 'zustand';

export interface ComposeModalPayload {
  replyToStatus?: unknown;
  editStatus?: unknown;
  draftStatus?: unknown;
  quoteStatus?: unknown;
}

export type ComposeModalState = false | true | ComposeModalPayload;

export type AccountModalState =
  | false
  | string
  | {
      account?: unknown;
      instance?: string;
    };

export interface MediaModalPayload {
  mediaAttachments?: unknown;
  statusID?: string;
  instance?: string;
  lang?: string;
  mediaIndex?: number;
}

export interface GenericAccountsModalPayload {
  instance?: string;
  excludeRelationshipAttrs?: readonly string[];
  postID?: string;
  blankCopy?: string;
}

export interface MediaAltModalPayload {
  alt?: string;
  lang?: string;
}

export interface EmbedModalPayload {
  html?: string;
  url?: string;
  iframeUrl?: string;
  title?: string;
  width?: number | string;
  height?: number | string;
}

export interface FeedbackModalPayload {
  defaultMessage?: string;
}

export interface ReportModalPayload {
  account?: unknown;
  post?: unknown;
}

export interface QrCodeModalPayload {
  text: string;
  arena?: string;
  backgroundMask?: string;
  caption?: string;
  onScannerClick?: () => void;
}

export interface QrScannerModalPayload {
  checkValidity?: (text: string) => boolean;
  actionableText?: string;
  onClose?: (arg?: { text: string } | MouseEvent) => void;
}

export interface ImportExportAccountsModalPayload {
  exportDisabled?: boolean;
}

export interface OpenLinkModalPayload {
  url: string;
  linkText?: string;
}

export interface SearchCommandModalPayload {
  query?: string;
}

export interface ModalsState {
  compose: ComposeModalState;
  settings: boolean;
  accounts: boolean;
  account: AccountModalState;
  drafts: boolean;
  mediaModal: false | MediaModalPayload;
  shortcutsSettings: boolean;
  keyboardShortcutsHelp: boolean;
  genericAccounts: false | GenericAccountsModalPayload;
  mediaAlt: false | string | MediaAltModalPayload;
  embedModal: false | EmbedModalPayload;
  feedbackModal: false | FeedbackModalPayload;
  reportModal: false | ReportModalPayload;
  qrCodeModal: false | QrCodeModalPayload;
  qrScannerModal: false | QrScannerModalPayload;
  importExportAccounts: false | true | ImportExportAccountsModalPayload;
  searchCommand: false | SearchCommandModalPayload;
  openLink: false | OpenLinkModalPayload;
  setCompose: (value: ComposeModalState) => void;
  setSettings: (open: boolean) => void;
  setAccounts: (open: boolean) => void;
  setAccount: (value: AccountModalState) => void;
  setDrafts: (open: boolean) => void;
  setMediaModal: (value: false | MediaModalPayload) => void;
  setShortcutsSettings: (open: boolean) => void;
  setKeyboardShortcutsHelp: (open: boolean) => void;
  setGenericAccounts: (value: false | GenericAccountsModalPayload) => void;
  setMediaAlt: (value: false | string | MediaAltModalPayload) => void;
  setEmbedModal: (value: false | EmbedModalPayload) => void;
  setFeedbackModal: (value: false | FeedbackModalPayload) => void;
  setReportModal: (value: false | ReportModalPayload) => void;
  setQrCodeModal: (value: false | QrCodeModalPayload) => void;
  setQrScannerModal: (value: false | QrScannerModalPayload) => void;
  setImportExportAccounts: (
    value: false | true | ImportExportAccountsModalPayload,
  ) => void;
  setSearchCommand: (value: false | SearchCommandModalPayload) => void;
  setOpenLink: (value: false | OpenLinkModalPayload) => void;
  hideAllModals: () => void;
}

const closedModalsState = {
  compose: false,
  settings: false,
  accounts: false,
  account: false,
  drafts: false,
  mediaModal: false,
  shortcutsSettings: false,
  keyboardShortcutsHelp: false,
  genericAccounts: false,
  mediaAlt: false,
  embedModal: false,
  feedbackModal: false,
  reportModal: false,
  qrCodeModal: false,
  qrScannerModal: false,
  importExportAccounts: false,
  searchCommand: false,
  openLink: false,
} as const satisfies Pick<
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
>;

export const useModalsStore = create<ModalsState>()((set) => ({
  ...closedModalsState,
  setCompose: (value) => {
    set({ compose: value });
  },
  setSettings: (open) => {
    set({ settings: open });
  },
  setAccounts: (open) => {
    set({ accounts: open });
  },
  setAccount: (value) => {
    set({ account: value });
  },
  setDrafts: (open) => {
    set({ drafts: open });
  },
  setMediaModal: (value) => {
    set({ mediaModal: value });
  },
  setShortcutsSettings: (open) => {
    set({ shortcutsSettings: open });
  },
  setKeyboardShortcutsHelp: (open) => {
    set({ keyboardShortcutsHelp: open });
  },
  setGenericAccounts: (value) => {
    set({ genericAccounts: value });
  },
  setMediaAlt: (value) => {
    set({ mediaAlt: value });
  },
  setEmbedModal: (value) => {
    set({ embedModal: value });
  },
  setFeedbackModal: (value) => {
    set({ feedbackModal: value });
  },
  setReportModal: (value) => {
    set({ reportModal: value });
  },
  setQrCodeModal: (value) => {
    set({ qrCodeModal: value });
  },
  setQrScannerModal: (value) => {
    set({ qrScannerModal: value });
  },
  setImportExportAccounts: (value) => {
    set({ importExportAccounts: value });
  },
  setSearchCommand: (value) => {
    set({ searchCommand: value });
  },
  setOpenLink: (value) => {
    set({ openLink: value });
  },
  hideAllModals: () => {
    set(closedModalsState);
  },
}));

export function hideAllModals(): void {
  useModalsStore.getState().hideAllModals();
}

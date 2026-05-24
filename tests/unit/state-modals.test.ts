import { describe, expect, test } from 'bun:test';

import { hideAllModals, useModalsStore } from '../../src/state/modals';

describe('useModalsStore', () => {
  test('hideAllModals closes every modal slice', () => {
    useModalsStore.setState({
      compose: { replyToStatus: { id: '1' } },
      settings: true,
      accounts: true,
      account: 'alice.test',
      drafts: true,
      mediaModal: { statusID: 'abc' },
      shortcutsSettings: true,
      keyboardShortcutsHelp: true,
      genericAccounts: { postID: 'abc' },
      mediaAlt: 'alt text',
      embedModal: { url: 'https://example.test' },
      feedbackModal: { defaultMessage: 'hi' },
      reportModal: { post: { uri: 'at://x' } },
      qrCodeModal: { text: 'qr' },
      qrScannerModal: { actionableText: 'scan' },
      importExportAccounts: true,
      searchCommand: { query: 'from:me ' },
      openLink: { url: 'https://example.test' },
    });

    hideAllModals();

    const state = useModalsStore.getState();
    expect(state.compose).toBe(false);
    expect(state.settings).toBe(false);
    expect(state.accounts).toBe(false);
    expect(state.account).toBe(false);
    expect(state.drafts).toBe(false);
    expect(state.mediaModal).toBe(false);
    expect(state.shortcutsSettings).toBe(false);
    expect(state.keyboardShortcutsHelp).toBe(false);
    expect(state.genericAccounts).toBe(false);
    expect(state.mediaAlt).toBe(false);
    expect(state.embedModal).toBe(false);
    expect(state.feedbackModal).toBe(false);
    expect(state.reportModal).toBe(false);
    expect(state.qrCodeModal).toBe(false);
    expect(state.qrScannerModal).toBe(false);
    expect(state.importExportAccounts).toBe(false);
    expect(state.searchCommand).toBe(false);
    expect(state.openLink).toBe(false);
  });
});

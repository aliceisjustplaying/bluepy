import { describe, expect, test } from 'bun:test';

import {
  bootstrapUiPreferencesForDid,
  DEFAULT_UI_PREFERENCES,
  useUiPreferencesStore,
} from '../../src/state/ui-preferences';

describe('useUiPreferencesStore', () => {
  test('keeps preferences isolated per DID', () => {
    useUiPreferencesStore.setState({ byDid: {} });

    useUiPreferencesStore.getState().setForDid('did:plc:alice', {
      autoRefresh: true,
    });
    useUiPreferencesStore.getState().setForDid('did:plc:bob', {
      cloakMode: true,
    });

    expect(useUiPreferencesStore.getState().getForDid('did:plc:alice')).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      autoRefresh: true,
    });
    expect(useUiPreferencesStore.getState().getForDid('did:plc:bob')).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      cloakMode: true,
    });
  });

  test('bootstrapUiPreferencesForDid imports legacy values once', () => {
    useUiPreferencesStore.setState({ byDid: {} });

    const imported = bootstrapUiPreferencesForDid('did:plc:legacy', {
      autoRefresh: true,
      shortcutsColumnsMode: true,
      mutedPostVisibility: 'collapse',
    });

    expect(imported.autoRefresh).toBe(true);
    expect(imported.shortcutsViewMode).toBe('multi-column');
    expect(imported.mutedPostVisibility).toBe('collapse');

    const again = bootstrapUiPreferencesForDid('did:plc:legacy', {
      autoRefresh: false,
    });
    expect(again.autoRefresh).toBe(true);
  });
});

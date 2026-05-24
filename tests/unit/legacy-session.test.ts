import { describe, expect, test } from 'bun:test';

import { syncSessionsStoreFromLegacyAccount } from '../../src/data/legacy-session';
import { useSessionsStore } from '../../src/state/sessions';

describe('syncSessionsStoreFromLegacyAccount', () => {
  test('returns null when no legacy account is active', () => {
    useSessionsStore.setState({
      activeDid: null,
      knownDids: [],
      perAccountPrefs: {},
    });
    expect(syncSessionsStoreFromLegacyAccount()).toBeNull();
  });
});

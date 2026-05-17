/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistShortcutsViewMode,
  restoreShortcutsViewMode,
} from '../src/utils/settings-storage';

void test('shortcut view mode persistence keeps multi-column explicit', () => {
  assert.equal(persistShortcutsViewMode('multi-column'), 'multi-column');
  assert.equal(restoreShortcutsViewMode('multi-column'), 'multi-column');
});

void test('shortcut view mode persistence preserves default as null', () => {
  assert.equal(persistShortcutsViewMode(null), null);
  assert.equal(restoreShortcutsViewMode(null), null);
});

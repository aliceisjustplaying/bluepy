/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistShortcutsColumnsMode,
  persistShortcutsViewMode,
  restoreShortcutsColumnsMode,
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

void test('legacy shortcut columns mode restores as multi-column view mode', () => {
  assert.equal(restoreShortcutsViewMode(null, true), 'multi-column');
});

void test('explicit shortcut view mode overrides legacy columns mode', () => {
  assert.equal(restoreShortcutsViewMode('tab-menu-bar', true), 'tab-menu-bar');
});

void test('shortcut columns mode persistence keeps only explicit true', () => {
  assert.equal(persistShortcutsColumnsMode(true), true);
  assert.equal(persistShortcutsColumnsMode(false), false);
  assert.equal(restoreShortcutsColumnsMode(true), true);
  assert.equal(restoreShortcutsColumnsMode(false), false);
  assert.equal(restoreShortcutsColumnsMode(null), false);
});

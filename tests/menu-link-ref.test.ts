/// <reference types="node" />

import assert from 'node:assert/strict';
import { test } from 'bun:test';

import { assignFocusableAnchorRef } from '../src/utils/assign-focusable-anchor-ref';

test('assignFocusableAnchorRef forwards callback refs', () => {
  const node = { focus() {} } as HTMLAnchorElement;
  let assigned: HTMLAnchorElement | null = null;

  assignFocusableAnchorRef((value) => {
    assigned = value as HTMLAnchorElement | null;
  }, node);

  assert.equal(assigned, node);
});

test('assignFocusableAnchorRef forwards object refs', () => {
  const node = { focus() {} } as HTMLAnchorElement;
  const ref: { current: unknown } = { current: null };

  assignFocusableAnchorRef(ref, node);

  assert.equal(ref.current, node);
});

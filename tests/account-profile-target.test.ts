/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { getAccountProfileTarget } from '../src/utils/account-profile-target';

void test('account profile target keeps ATProto handle separate from instance', () => {
  assert.deepEqual(
    getAccountProfileTarget({
      info: {
        id: 'did:plc:alice',
        username: 'alice.mosphere.at',
        acct: 'alice.mosphere.at',
      },
      instanceURL: 'bsky.social',
    }),
    {
      account: 'alice.mosphere.at',
      instance: 'bsky.social',
    },
  );
});

void test('account profile target falls back to account id', () => {
  assert.deepEqual(
    getAccountProfileTarget({
      info: {
        id: 'did:plc:alice',
      },
      instanceURL: 'bsky.social',
    }),
    {
      account: 'did:plc:alice',
      instance: 'bsky.social',
    },
  );
});

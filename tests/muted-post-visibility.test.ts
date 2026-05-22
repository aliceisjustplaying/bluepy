import assert from 'node:assert/strict';
import { test } from 'bun:test';

import {
  DEFAULT_MUTED_POST_VISIBILITY,
  getMutedPostVisibility,
  hasMutedAuthor,
  isMutedPostVisibility,
  shouldCollapseMutedStatus,
  shouldHideMutedStatus,
} from '../src/utils/muted-post-visibility';

const mutedStatus = {
  id: 'post',
  account: { id: 'did:plc:author' },
  _atproto: { mutedAuthor: true },
};

test('muted post visibility validates persisted values', () => {
  assert.equal(getMutedPostVisibility({ mutedPostVisibility: 'hide' }), 'hide');
  assert.equal(
    getMutedPostVisibility({ mutedPostVisibility: 'collapse' }),
    'collapse',
  );
  assert.equal(getMutedPostVisibility({ mutedPostVisibility: 'show' }), 'show');
  assert.equal(
    getMutedPostVisibility({ mutedPostVisibility: 'invalid' }),
    DEFAULT_MUTED_POST_VISIBILITY,
  );
  assert.equal(isMutedPostVisibility('collapse'), true);
  assert.equal(isMutedPostVisibility('invalid'), false);
});

test('muted author detection applies to reposts but not third-party quotes', () => {
  assert.equal(hasMutedAuthor(mutedStatus), true);
  assert.equal(hasMutedAuthor({ reblog: mutedStatus }), true);
  assert.equal(hasMutedAuthor({ quote: { quotedStatus: mutedStatus } }), false);
  assert.equal(
    hasMutedAuthor({
      quote: {
        quotedStatus: {
          reblog: mutedStatus,
        },
      },
    }),
    false,
  );
  assert.equal(hasMutedAuthor({ _atproto: { mutedAuthor: false } }), false);
  assert.equal(hasMutedAuthor({ _atproto: { mutedAuthor: 'true' } }), false);
  assert.equal(hasMutedAuthor({ _atproto: { mutedAuthor: 1 } }), false);
});

test('hide mode drops muted statuses except direct context and current account', () => {
  assert.equal(
    shouldHideMutedStatus({
      status: mutedStatus,
      currentAccountID: null,
      visibility: 'hide',
    }),
    true,
  );
  assert.equal(
    shouldHideMutedStatus({
      status: mutedStatus,
      currentAccountID: null,
      visibility: 'hide',
      directContext: true,
    }),
    false,
  );
  assert.equal(
    shouldHideMutedStatus({
      status: mutedStatus,
      currentAccountID: 'did:plc:author',
      visibility: 'hide',
    }),
    false,
  );
  assert.equal(
    shouldHideMutedStatus({
      status: {
        account: { id: 'did:plc:other' },
        quote: { quotedStatus: mutedStatus },
      },
      currentAccountID: 'did:plc:current',
      visibility: 'hide',
    }),
    false,
  );
});

test('collapse mode keeps muted statuses renderable behind a reveal row', () => {
  assert.equal(
    shouldCollapseMutedStatus({
      status: mutedStatus,
      currentAccountID: null,
      visibility: 'collapse',
    }),
    true,
  );
  assert.equal(
    shouldCollapseMutedStatus({
      status: mutedStatus,
      currentAccountID: null,
      visibility: 'show',
    }),
    false,
  );
  assert.equal(
    shouldCollapseMutedStatus({
      status: mutedStatus,
      currentAccountID: null,
      visibility: 'hide',
      directContext: true,
    }),
    true,
  );
});

import assert from 'node:assert/strict';
import { test } from 'bun:test';

import type { InterpretedLabelValueDefinition } from '@atproto/api';

import {
  dedupeAtprotoLabels,
  describeAtprotoLabel,
  getAtprotoLabelClassName,
  getAtprotoLabelDefinitions,
  getAtprotoLabelerInfoFromSourceProfile,
  getAtprotoLabelerInfoFromView,
  getAtprotoLabelerInfoMap,
  getDisplayAtprotoLabels,
  normalizeAtprotoLabelerDids,
  normalizeAtprotoLabels,
  type AtprotoLabel,
} from '../src/utils/atproto-labels';

const customLabelDef: InterpretedLabelValueDefinition = {
  identifier: 'bot',
  definedBy: 'did:plc:custom',
  configurable: true,
  defaultSetting: 'warn',
  severity: 'inform',
  blurs: 'none',
  flags: [],
  behaviors: {},
  locales: [
    {
      lang: 'en',
      name: 'Custom bot',
      description: 'Custom bot label from a labeler.',
    },
    {
      lang: 'fr',
      name: 'Robot personnalisé',
      description: 'Libellé personnalisé.',
    },
  ],
};

function label(overrides: Partial<AtprotoLabel> = {}): AtprotoLabel {
  return {
    src: 'did:plc:custom',
    uri: 'at://did:plc:subject/app.bsky.actor.profile/self',
    val: 'bot',
    cts: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

test('normalizeAtprotoLabels drops invalid and negated labels', () => {
  assert.deepEqual(
    normalizeAtprotoLabels([
      label(),
      label({ neg: true }),
      { src: 'did:plc:custom', val: 'bot' },
      null,
    ]),
    [label()],
  );
});

test('dedupeAtprotoLabels keeps one label per source and value', () => {
  assert.deepEqual(
    dedupeAtprotoLabels([
      label({ cts: 'first' }),
      label({ cts: 'second' }),
      label({ src: 'did:plc:other', cts: 'third' }),
    ]),
    [label({ cts: 'second' }), label({ src: 'did:plc:other', cts: 'third' })],
  );
});

test('getDisplayAtprotoLabels drops system moderation labels', () => {
  assert.deepEqual(
    getDisplayAtprotoLabels([
      label({ val: '!hide' }),
      label({ val: '!warn' }),
      label({ val: 'bot' }),
    ]),
    [label({ val: 'bot' })],
  );
});

test('custom label definitions win over global strings', () => {
  assert.equal(
    describeAtprotoLabel(
      label(),
      { 'did:plc:custom': [customLabelDef] },
      'en-US',
      {
        bot: {
          name: 'Automated',
          description: 'Global bot label.',
        },
      },
    ).name,
    'Custom bot',
  );
});

test('custom labels without locale strings fall back to global strings', () => {
  assert.equal(
    describeAtprotoLabel(
      label(),
      { 'did:plc:custom': [{ ...customLabelDef, locales: [] }] },
      'en',
      {
        bot: {
          name: 'Automated',
          description: 'Global bot label.',
        },
      },
    ).name,
    'Automated',
  );
});

test('locale fallback tries language before first locale', () => {
  assert.equal(
    describeAtprotoLabel(
      label(),
      { 'did:plc:custom': [customLabelDef] },
      'fr-CA',
    ).name,
    'Robot personnalisé',
  );
});

test('unknown labels get humanized fallback text', () => {
  assert.equal(
    describeAtprotoLabel(label({ val: 'bridged-from-bridgy-fed-web' })).name,
    'Bridged From Bridgy Fed Web',
  );
  assert.equal(
    describeAtprotoLabel(label({ val: 'bridged-from-bridgy-fed-web' }))
      .severity,
    'none',
  );
});

test('label value lookups ignore prototype-chain keys', () => {
  const info = describeAtprotoLabel(label({ val: 'toString' }));
  assert.equal(info.name, 'ToString');
  assert.equal(info.description, 'toString');
  assert.equal(info.severity, 'none');
});

test('known global labels use supplied global strings', () => {
  const info = describeAtprotoLabel(
    label({ src: 'did:plc:bsky', val: 'sexual' }),
    {},
    'en',
    {
      sexual: {
        name: 'Sexually Suggestive',
        description: 'Does not include nudity.',
      },
    },
  );
  assert.equal(info.name, 'Sexually Suggestive');
  assert.equal(info.description, 'Does not include nudity.');
  assert.equal(info.severity, 'none');
});

test('global label strings without atproto definitions are neutral', () => {
  const info = describeAtprotoLabel(
    label({ src: 'did:plc:bsky', val: 'gore' }),
    {},
    'en',
    {
      gore: {
        name: 'Graphic Media',
        description: 'Explicit or potentially disturbing media.',
      },
    },
  );
  assert.equal(info.name, 'Graphic Media');
  assert.equal(info.severity, 'none');
});

test('custom label severity is clamped for CSS class names', () => {
  const info = describeAtprotoLabel(
    label(),
    {
      'did:plc:custom': [
        {
          ...customLabelDef,
          severity: 'extra-class',
        },
      ],
    },
    'en',
  );
  assert.equal(info.severity, 'none');
});

test('getAtprotoLabelClassName uses normalized severities', () => {
  assert.equal(
    getAtprotoLabelClassName(
      describeAtprotoLabel(label(), {
        'did:plc:custom': [customLabelDef],
      }).severity,
    ),
    'atproto-label atproto-label-inform',
  );
  assert.equal(
    getAtprotoLabelClassName(
      describeAtprotoLabel(label(), {
        'did:plc:custom': [
          {
            ...customLabelDef,
            severity: 'extra-class',
          },
        ],
      }).severity,
    ),
    'atproto-label atproto-label-none',
  );
});

test('getAtprotoLabelDefinitions drops malformed cached entries', () => {
  assert.deepEqual(
    getAtprotoLabelDefinitions({
      atprotoLabelDefs: {
        'did:plc:custom': [customLabelDef, { identifier: 'bad' }],
        'did:plc:malformed-locale': [
          {
            ...customLabelDef,
            locales: [{ lang: 'en' }],
          },
        ],
        'did:plc:broken': null,
      },
    }),
    {
      'did:plc:custom': [customLabelDef],
    },
  );
});

test('getAtprotoLabelerInfoMap drops malformed cached entries', () => {
  assert.deepEqual(
    getAtprotoLabelerInfoMap({
      atprotoLabelers: {
        'did:plc:custom': {
          did: 'did:plc:custom',
          handle: 'labels.example.com',
          displayName: 'Custom Labels',
          avatar: 'https://example.com/avatar.jpg',
        },
        'did:plc:mismatch': {
          did: 'did:plc:other',
          avatar: 'https://example.com/other.jpg',
        },
        'did:plc:broken': {
          did: 'did:plc:broken',
          avatar: 123,
        },
      },
    }),
    {
      'did:plc:custom': {
        did: 'did:plc:custom',
        handle: 'labels.example.com',
        displayName: 'Custom Labels',
        avatar: 'https://example.com/avatar.jpg',
      },
    },
  );
});

test('getAtprotoLabelerInfoFromSourceProfile derives DID and avatar', () => {
  assert.deepEqual(
    getAtprotoLabelerInfoFromSourceProfile({
      id: 'did:plc:source',
      uri: 'did:plc:ignored',
      acct: 'labels.example.com',
      username: 'ignored.example.com',
      displayName: 'Source Labels',
      avatar: 'https://example.com/avatar.jpg',
      avatarStatic: 'https://example.com/avatar-static.jpg',
    }),
    {
      did: 'did:plc:source',
      handle: 'labels.example.com',
      displayName: 'Source Labels',
      avatar: 'https://example.com/avatar-static.jpg',
    },
  );
  assert.deepEqual(
    getAtprotoLabelerInfoFromSourceProfile({
      uri: 'did:plc:from-uri',
      username: 'uri.example.com',
      avatar: 'https://example.com/uri.jpg',
    }),
    {
      did: 'did:plc:from-uri',
      handle: 'uri.example.com',
      displayName: undefined,
      avatar: 'https://example.com/uri.jpg',
    },
  );
  assert.equal(
    getAtprotoLabelerInfoFromSourceProfile({
      id: 'not-a-did',
      uri: 'https://example.com',
    }),
    undefined,
  );
});

test('getAtprotoLabelerInfoFromView reads creator labeler profile', () => {
  assert.deepEqual(
    getAtprotoLabelerInfoFromView({
      creator: {
        did: 'did:plc:view',
        handle: 'view.example.com',
        displayName: 'View Labels',
        avatar: 'https://example.com/view.jpg',
      },
    }),
    {
      did: 'did:plc:view',
      handle: 'view.example.com',
      displayName: 'View Labels',
      avatar: 'https://example.com/view.jpg',
    },
  );
  assert.equal(getAtprotoLabelerInfoFromView({ creator: {} }), undefined);
});

test('normalizeAtprotoLabelerDids handles cached strings and pref objects', () => {
  assert.deepEqual(
    normalizeAtprotoLabelerDids(
      [
        'did:plc:stored',
        { did: 'did:plc:pref' },
        { did: 'did:plc:app' },
        { did: 123 },
        null,
      ],
      ['did:plc:app'],
    ),
    ['did:plc:stored', 'did:plc:pref'],
  );
});

test('normalizeAtprotoLabelerDids deduplicates DIDs', () => {
  assert.deepEqual(
    normalizeAtprotoLabelerDids([
      'did:plc:a',
      'did:plc:a',
      { did: 'did:plc:b' },
      'did:plc:b',
    ]),
    ['did:plc:a', 'did:plc:b'],
  );
});

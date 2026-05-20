/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';
import type { InterpretedLabelValueDefinition } from '@atproto/api';

import {
  dedupeAtprotoLabels,
  describeAtprotoLabel,
  getAtprotoLabelDefinitions,
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

void test('normalizeAtprotoLabels drops invalid and negated labels', () => {
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

void test('dedupeAtprotoLabels keeps one label per source and value', () => {
  assert.deepEqual(
    dedupeAtprotoLabels([
      label({ cts: 'first' }),
      label({ cts: 'second' }),
      label({ src: 'did:plc:other', cts: 'third' }),
    ]),
    [label({ cts: 'second' }), label({ src: 'did:plc:other', cts: 'third' })],
  );
});

void test('getDisplayAtprotoLabels drops system moderation labels', () => {
  assert.deepEqual(
    getDisplayAtprotoLabels([
      label({ val: '!hide' }),
      label({ val: '!warn' }),
      label({ val: 'bot' }),
    ]),
    [label({ val: 'bot' })],
  );
});

void test('custom label definitions win over global strings', () => {
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

void test('locale fallback tries language before first locale', () => {
  assert.equal(
    describeAtprotoLabel(label(), { 'did:plc:custom': [customLabelDef] }, 'fr-CA')
      .name,
    'Robot personnalisé',
  );
});

void test('unknown labels get humanized fallback text', () => {
  assert.equal(
    describeAtprotoLabel(label({ val: 'bridged-from-bridgy-fed-web' })).name,
    'Bridged From Bridgy Fed Web',
  );
  assert.equal(
    describeAtprotoLabel(label({ val: 'bridged-from-bridgy-fed-web' })).severity,
    'none',
  );
});

void test('label value lookups ignore prototype-chain keys', () => {
  const info = describeAtprotoLabel(label({ val: 'toString' }));
  assert.equal(info.name, 'ToString');
  assert.equal(info.description, 'toString');
  assert.equal(info.severity, 'none');
});

void test('known global labels use supplied global strings', () => {
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

void test('global label strings without atproto definitions are neutral', () => {
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

void test('custom label severity is clamped for CSS class names', () => {
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

void test('getAtprotoLabelDefinitions drops malformed cached entries', () => {
  assert.deepEqual(
    getAtprotoLabelDefinitions({
      atprotoLabelDefs: {
        'did:plc:custom': [customLabelDef, { identifier: 'bad' }],
        'did:plc:broken': null,
      },
    }),
    {
      'did:plc:custom': [customLabelDef],
    },
  );
});

void test('normalizeAtprotoLabelerDids handles cached strings and pref objects', () => {
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

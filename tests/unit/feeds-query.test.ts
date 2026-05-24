import { describe, expect, test } from 'bun:test';

import {
  buildAccountMonthSearchQuery,
  timelineFeedQueryOptions,
} from '../../src/data/feeds';
import { keys, type ViewerScope } from '../../src/data/keys';

const scope: ViewerScope = [
  'did:plc:viewer',
  'did:web:app|https://app.example',
  'abc123',
];

describe('timelineFeedQueryOptions', () => {
  test('stays disabled with a sentinel key when logged out', () => {
    const opts = timelineFeedQueryOptions(null, scope);
    expect(opts.enabled).toBe(false);
    expect(opts.queryKey).toEqual(['timeline', 'disabled']);
  });

  test('uses the scoped timeline key when logged in', () => {
    const opts = timelineFeedQueryOptions('did:plc:viewer', scope);
    expect(opts.enabled).toBe(true);
    expect(opts.queryKey).toEqual(keys.timeline(scope));
  });
});

describe('buildAccountMonthSearchQuery', () => {
  test('uses the first day of the selected month as the lower bound', () => {
    expect(buildAccountMonthSearchQuery('alice.test', '2024-03')).toEqual({
      query: 'from:alice.test',
      options: {
        since: '2024-03-01',
        until: '2024-04-01',
      },
    });
  });
});

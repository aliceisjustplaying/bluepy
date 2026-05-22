import assert from 'node:assert/strict';
import { test } from 'bun:test';

import { catchupPageHasItemsInRange } from '../src/utils/catchup-fetch';

test('catchupPageHasItemsInRange only stops on pages fully before cutoff', () => {
  const cutoff = Date.parse('2026-05-19T12:00:00.000Z');

  assert.equal(
    catchupPageHasItemsInRange(
      [
        { createdAt: '2026-05-19T11:59:00.000Z' },
        { createdAt: '2026-05-19T12:00:00.000Z' },
      ],
      cutoff,
    ),
    true,
  );
  assert.equal(
    catchupPageHasItemsInRange(
      [
        { createdAt: '2026-05-19T12:01:00.000Z' },
        { createdAt: '2026-05-19T11:59:00.000Z' },
      ],
      cutoff,
    ),
    true,
  );
  assert.equal(
    catchupPageHasItemsInRange(
      [
        { createdAt: '2026-05-19T11:59:00.000Z' },
        { createdAt: '2026-05-19T11:58:00.000Z' },
      ],
      cutoff,
    ),
    false,
  );
  assert.equal(
    catchupPageHasItemsInRange([{ createdAt: 'not-a-date' }], null),
    true,
  );
  assert.equal(
    catchupPageHasItemsInRange([{ createdAt: 'not-a-date' }], 0),
    true,
  );
});

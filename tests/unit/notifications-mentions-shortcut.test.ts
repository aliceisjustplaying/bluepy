import { describe, expect, test } from 'bun:test';

import { shouldShowMentionsShortcut } from '../../src/utils/notifications-mentions-shortcut';

function notification(
  type: 'mention' | 'favourite',
  index: number,
  notificationsCount = 1,
) {
  return {
    id: String(index),
    type,
    createdAt: `2026-05-24T10:${String(index).padStart(2, '0')}:00.000Z`,
    notificationsCount,
  };
}

describe('shouldShowMentionsShortcut', () => {
  test('shows the shortcut for cached notification state with few mentions', () => {
    expect(
      shouldShowMentionsShortcut([
        notification('mention', 0),
        notification('favourite', 1),
        notification('favourite', 2),
        notification('favourite', 3),
      ]),
    ).toBe(true);
  });

  test('keeps the inline mentions filter when notifications are mostly mentions', () => {
    expect(
      shouldShowMentionsShortcut([
        notification('mention', 0),
        notification('mention', 1),
        notification('favourite', 2),
      ]),
    ).toBe(false);
  });

  test('shows the shortcut for a large grouped notification', () => {
    expect(shouldShowMentionsShortcut([notification('mention', 0, 31)])).toBe(
      true,
    );
  });
});

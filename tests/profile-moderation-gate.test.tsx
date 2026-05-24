import { describe, expect, test } from 'bun:test';

import { profileModerationShowsContent } from '../src/render/profile-moderation-policy';
import type { ProfileModerationDecision } from '../src/render/moderation-decision';

function decision(
  visibility: ProfileModerationDecision['visibility'],
): ProfileModerationDecision {
  return { visibility };
}

describe('profileModerationShowsContent', () => {
  test('shows warn profiles without replacing the account row', () => {
    expect(profileModerationShowsContent(decision('warn'), false)).toBe(true);
  });

  test('covers blur and hide profiles until revealed', () => {
    expect(profileModerationShowsContent(decision('blur'), false)).toBe(false);
    expect(profileModerationShowsContent(decision('hide'), false)).toBe(false);
    expect(profileModerationShowsContent(decision('blur'), true)).toBe(true);
  });
});

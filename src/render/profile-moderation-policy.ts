import type { ProfileModerationDecision } from './moderation-decision';

export function profileModerationShowsContent(
  decision: ProfileModerationDecision | undefined,
  revealed: boolean,
): boolean {
  return (
    !decision ||
    decision.visibility === 'show' ||
    decision.visibility === 'warn' ||
    revealed
  );
}

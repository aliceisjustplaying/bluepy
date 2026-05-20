interface ShouldShowReplyBadgeOptions {
  readonly inReplyToAccount?: unknown;
  readonly inReplyToId?: unknown;
  readonly isReplyParentUnavailable?: unknown;
}

function shouldShowReplyBadge(options: ShouldShowReplyBadgeOptions): boolean {
  const {
    inReplyToId,
    inReplyToAccount,
    isReplyParentUnavailable,
  } = options;

  return (
    Boolean(inReplyToId) &&
    (Boolean(inReplyToAccount) || Boolean(isReplyParentUnavailable))
  );
}

export { shouldShowReplyBadge };

interface ReplyContextStatus {
  readonly account?: {
    readonly id?: string;
  };
  readonly inReplyToAccountId?: string | null;
  readonly inReplyToId?: string | null;
}

interface ThreadParentInput {
  readonly instance: string;
  readonly status?: ReplyContextStatus | null;
}

function shouldFetchReplyContextForInstance(instance: string): boolean {
  return instance !== 'bsky.social';
}

function shouldFetchThreadParent({
  status,
  instance,
}: ThreadParentInput): boolean {
  if (status === undefined || status === null) {
    return false;
  }
  return (
    shouldFetchReplyContextForInstance(instance) &&
    Boolean(status.inReplyToId) &&
    status.inReplyToAccountId === status.account?.id
  );
}

export { shouldFetchReplyContextForInstance, shouldFetchThreadParent };

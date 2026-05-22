import type { AnyStatus } from '../components/status-types';

export type ThreadStatus = Pick<
  AnyStatus,
  'id' | 'inReplyToId' | 'inReplyToAccountId' | 'account'
> & {
  __replies?: ThreadStatus[];
};

function appendReply(parent: ThreadStatus, status: ThreadStatus): void {
  if (!parent.__replies) {
    parent.__replies = [];
  }
  parent.__replies.push(status);
}

export function clearThreadDescendantReplies(
  descendants: ThreadStatus[],
): void {
  for (const descendant of descendants) {
    delete descendant.__replies;
  }
}

export function appendThreadDescendant(
  status: ThreadStatus,
  heroStatus: ThreadStatus,
  descendants: ThreadStatus[],
  topLevelDescendants: ThreadStatus[],
): void {
  const parent = status.inReplyToId
    ? descendants.find((s) => s.id === status.inReplyToId)
    : undefined;
  const parentIsTopLevel =
    !!parent && topLevelDescendants.some((s) => s.id === parent.id);

  if (status.inReplyToAccountId === status.account?.id) {
    topLevelDescendants.push(status);
  } else if (status.inReplyToId === heroStatus.id) {
    topLevelDescendants.push(status);
  } else if (
    !status.inReplyToAccountId &&
    parentIsTopLevel &&
    parent?.account?.id === heroStatus.account?.id &&
    status.account?.id === heroStatus.account?.id
  ) {
    topLevelDescendants.push(status);
  } else if (parent) {
    appendReply(parent, status);
  } else {
    console.warn('No parent found for', status);
  }
}

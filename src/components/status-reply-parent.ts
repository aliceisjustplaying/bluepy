import type { mastodon } from 'masto';

import { shouldShowReplyBadge } from '../utils/reply-badge';

import type { AnyAccount, MastoClientFromApi } from './status-types';

type ReplyToAccount =
  | AnyAccount
  | { url?: string; username?: string; displayName?: string }
  | null
  | undefined;

interface StatusReplyParentArgs {
  instance: string;
  withinContext?: boolean;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  currentAccount?: string | null;
  accountURL?: string;
  username?: string;
  displayName?: string;
  statusID: string;
  spoilerText?: string | null;
  mentions?: mastodon.v1.StatusMention[];
  masto: MastoClientFromApi;
  atproto?: {
    replyParentAccount?: AnyAccount | null;
    replyParentUnavailable?: boolean;
  };
}

export default function useStatusReplyParent({
  inReplyToId,
  inReplyToAccountId,
  currentAccount,
  accountURL,
  username,
  displayName,
  statusID,
  mentions,
  atproto,
}: StatusReplyParentArgs) {
  let inReplyToAccountRef: ReplyToAccount =
    atproto?.replyParentAccount ||
    mentions?.find(
      (mention: mastodon.v1.StatusMention) => mention.id === inReplyToAccountId,
    );
  if (!inReplyToAccountRef && inReplyToAccountId === statusID) {
    inReplyToAccountRef = { url: accountURL, username, displayName };
  }
  const isReplyParentUnavailable =
    !!inReplyToId && !!atproto?.replyParentUnavailable;
  const inReplyToAccount = inReplyToAccountRef;
  const mentionSelf =
    (inReplyToAccountId && inReplyToAccountId === currentAccount) ||
    mentions?.find(
      (mention: mastodon.v1.StatusMention) => mention.id === currentAccount,
    );
  const showReplyBadge = shouldShowReplyBadge({
    inReplyToId,
    inReplyToAccount,
    isReplyParentUnavailable,
  });

  return {
    inReplyToAccount,
    mentionSelf,
    showReplyBadge,
  };
}

import type { mastodon } from 'masto';
import { useEffect, useState } from 'preact/hooks';

import { shouldShowReplyBadge } from '../utils/reply-badge';
import states from '../utils/states';

import { memFetchAccount } from './status-helpers';
import type { AnyAccount, FullMasto, MastoClientFromApi } from './status-types';

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
  masto: FullMasto;
  atproto?: {
    replyParentAccount?: AnyAccount | null;
    replyParentUnavailable?: boolean;
  };
}

export default function useStatusReplyParent({
  instance,
  withinContext,
  inReplyToId,
  inReplyToAccountId,
  currentAccount,
  accountURL,
  username,
  displayName,
  statusID,
  spoilerText,
  mentions,
  masto,
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
  const isAtprotoReplyParentUnavailable =
    instance === 'bsky.social' &&
    !!inReplyToId &&
    !!atproto?.replyParentUnavailable;
  const [inReplyToAccount, setInReplyToAccount] =
    useState<ReplyToAccount>(inReplyToAccountRef);
  useEffect(() => {
    if (instance === 'bsky.social') return undefined;
    if (!withinContext && !inReplyToAccount && inReplyToAccountId) {
      const cachedAccount = states.accounts[inReplyToAccountId] as
        | AnyAccount
        | undefined;
      if (cachedAccount) {
        setInReplyToAccount(cachedAccount);
        return undefined;
      }

      const abortController = new AbortController();
      const mastoClient: unknown = masto;
      memFetchAccount(
        inReplyToAccountId,
        mastoClient as MastoClientFromApi,
        abortController.signal,
      )
        .then((fetchedAccount: unknown) => {
          const acc = fetchedAccount as AnyAccount;
          setInReplyToAccount(acc);
          states.accounts[acc.id] = acc as unknown as Record<string, unknown>;
          return undefined;
        })
        .catch((_e: unknown) => {
          // best-effort fetch; ignore errors
        });

      return () => {
        abortController.abort();
      };
    }
    return undefined;
  }, [
    withinContext,
    inReplyToAccount,
    inReplyToAccountId,
    instance,
    masto,
  ]);
  const mentionSelf =
    (inReplyToAccountId && inReplyToAccountId === currentAccount) ||
    mentions?.find(
      (mention: mastodon.v1.StatusMention) => mention.id === currentAccount,
    );
  const showReplyBadge = shouldShowReplyBadge({
    inReplyToId,
    inReplyToAccount,
    isReplyParentUnavailable: isAtprotoReplyParentUnavailable,
    instance,
    spoilerText,
    mentions,
    inReplyToAccountId,
  });

  return {
    inReplyToAccount,
    mentionSelf,
    showReplyBadge,
  };
}

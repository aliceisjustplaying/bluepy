import { useEffect, useState } from 'react';

import type { AtprotoCompat } from '../types/atproto-compat';
import { shouldShowReplyBadge } from '../utils/reply-badge';
import states from '../utils/states';

import { memFetchAccount } from './status-helpers';
import type { AnyAccount, CompatClientFromApi } from './status-types';

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
  mentions?: AtprotoCompat.v1.StatusMention[];
  compat: CompatClientFromApi;
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
  compat,
  atproto,
}: StatusReplyParentArgs) {
  let inReplyToAccountRef: ReplyToAccount =
    atproto?.replyParentAccount ||
    mentions?.find(
      (mention: AtprotoCompat.v1.StatusMention) =>
        mention.id === inReplyToAccountId,
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
      memFetchAccount(inReplyToAccountId, compat, abortController.signal)
        .then((fetchedAccount: unknown) => {
          const acc = fetchedAccount as AnyAccount;
          setInReplyToAccount(acc);
          states.accounts[acc.id] = { ...acc };
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
  }, [withinContext, inReplyToAccount, inReplyToAccountId, instance, compat]);
  const mentionSelf =
    (inReplyToAccountId && inReplyToAccountId === currentAccount) ||
    mentions?.find(
      (mention: AtprotoCompat.v1.StatusMention) =>
        mention.id === currentAccount,
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

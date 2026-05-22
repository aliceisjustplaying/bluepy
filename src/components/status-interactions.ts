import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useMemo, useRef } from 'react';

import haptics from '../utils/haptics';
import openCompose from '../utils/open-compose';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';

import { REACTIONS_LIMIT } from './status-helpers';
import type { AnyAccount, AnyStatus, StatusContentMasto } from './status-types';

type CachedStatus = (typeof states.statuses)[string];

type ReplyEvent =
  | (MouseEvent & { syntheticEvent?: { shiftKey?: boolean } })
  | (KeyboardEvent & { syntheticEvent?: { shiftKey?: boolean } })
  | { shiftKey?: boolean; syntheticEvent?: { shiftKey?: boolean } }
  | undefined;
type ReactionIterator = AsyncIterator<AnyAccount[], undefined>;
type StatusSelector = ReturnType<
  StatusContentMasto['v1']['statuses']['$select']
>;
type IteratorResult = { value?: AnyAccount[]; done?: boolean };

interface StatusInteractionsArgs {
  statusID?: string | null;
  status: AnyStatus;
  sKey: string;
  id: string;
  instance: string;
  masto: StatusContentMasto;
  sameInstance: boolean;
  authenticated?: boolean;
  isSizeLarge: boolean;
  username?: string;
  acct?: string;
  reblogged?: boolean | null;
  reblogsCount?: number;
  favourited?: boolean | null;
  favouritesCount?: number;
  bookmarked?: boolean | null;
  mediaAttachments: mastodon.v1.MediaAttachment[];
  createdAt: string;
}

export default function useStatusInteractions({
  statusID,
  status,
  sKey,
  id,
  instance,
  masto,
  sameInstance,
  authenticated,
  isSizeLarge,
  username,
  acct,
  reblogged,
  reblogsCount = 0,
  favourited,
  favouritesCount = 0,
  bookmarked,
  mediaAttachments,
  createdAt,
}: StatusInteractionsArgs) {
  const { t } = useLingui();
  const unauthInteractionErrorMessage = t`Sorry, your current PDS can't interact with this post from another PDS.`;
  const mediaNoDesc = useMemo(() => {
    return mediaAttachments.some(
      (attachment: mastodon.v1.MediaAttachment) =>
        !attachment.description?.trim?.(),
    );
  }, [mediaAttachments]);
  const statusMonthsAgo = useMemo(() => {
    return Math.floor(
      (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30),
    );
  }, [createdAt]);

  const replyStatus = (e?: ReplyEvent) => {
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return;
    }
    if (e?.shiftKey || e?.syntheticEvent?.shiftKey) {
      const newWin = openCompose({
        replyToStatus: status,
      });
      if (newWin) return;
    }
    showCompose({
      replyToStatus: status,
    } as Parameters<typeof showCompose>[0]);
  };

  const confirmBoostStatus = async () => {
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return false;
    }
    try {
      states.statuses[sKey] = {
        ...status,
        reblogged: !reblogged,
        reblogsCount: reblogsCount + (reblogged ? -1 : 1),
      } as CachedStatus;
      if (reblogged) {
        const newStatus = await masto.v1.statuses.$select(id).unreblog();
        saveStatus(newStatus, instance);
      } else {
        const newStatus = await masto.v1.statuses.$select(id).reblog();
        saveStatus(newStatus, instance);
      }
      return true;
    } catch (e) {
      console.error(e);
      states.statuses[sKey] = status as CachedStatus;
      return false;
    }
  };

  const favouriteStatus = async () => {
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return false;
    }
    try {
      states.statuses[sKey] = {
        ...status,
        favourited: !favourited,
        favouritesCount: favouritesCount + (favourited ? -1 : 1),
      } as CachedStatus;
      if (favourited) {
        const newStatus = await masto.v1.statuses.$select(id).unfavourite();
        saveStatus(newStatus, instance);
      } else {
        const newStatus = await masto.v1.statuses.$select(id).favourite();
        saveStatus(newStatus, instance);
      }
      return true;
    } catch (e) {
      console.error(e);
      states.statuses[sKey] = status as CachedStatus;
      return false;
    }
  };

  const favouriteStatusNotify = async () => {
    void haptics.trigger('light');
    try {
      const done = await favouriteStatus();
      if (!isSizeLarge && done) {
        showToast(
          favourited
            ? t`Unliked @${username || acct}'s post`
            : t`Liked @${username || acct}'s post`,
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const bookmarkStatus = async (): Promise<boolean> => {
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return false;
    }
    try {
      states.statuses[sKey] = {
        ...status,
        bookmarked: !bookmarked,
      } as CachedStatus;
      if (bookmarked) {
        const newStatus = await masto.v1.statuses.$select(id).unbookmark();
        saveStatus(newStatus, instance);
      } else {
        const newStatus = await masto.v1.statuses.$select(id).bookmark();
        saveStatus(newStatus, instance);
      }
      return true;
    } catch (e) {
      console.error(e);
      states.statuses[sKey] = status as CachedStatus;
      return false;
    }
  };

  const bookmarkStatusNotify = async () => {
    void haptics.trigger('light');
    try {
      const done = await bookmarkStatus();
      if (!isSizeLarge && done) {
        showToast(
          bookmarked
            ? t`Unbookmarked @${username || acct}'s post`
            : t`Bookmarked @${username || acct}'s post`,
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const reblogIterator = useRef<ReactionIterator | null>(null);
  const favouriteIterator = useRef<ReactionIterator | null>(null);
  async function fetchBoostedLikedByAccounts(firstLoad?: boolean) {
    if (firstLoad) {
      const stmtSel: StatusSelector = masto.v1.statuses.$select(
        statusID as string,
      );
      reblogIterator.current = stmtSel.rebloggedBy
        .list({
          limit: REACTIONS_LIMIT,
        })
        .values();
      favouriteIterator.current = stmtSel.favouritedBy
        .list({
          limit: REACTIONS_LIMIT,
        })
        .values();
    }
    if (!reblogIterator.current || !favouriteIterator.current) {
      return { value: [], done: true };
    }
    const [reblogResult, favouriteResult] = await Promise.allSettled([
      reblogIterator.current.next(),
      favouriteIterator.current.next(),
    ]);
    const reblogResults = (
      reblogResult as PromiseFulfilledResult<IteratorResult>
    ).value;
    const favouriteResults = (
      favouriteResult as PromiseFulfilledResult<IteratorResult>
    ).value;
    if (reblogResults.value?.length || favouriteResults.value?.length) {
      const accounts: AnyAccount[] = [];
      if (reblogResults.value?.length) {
        accounts.push(
          ...reblogResults.value.map((a: AnyAccount) => {
            a._types = ['reblog'];
            return a;
          }),
        );
      }
      if (favouriteResults.value?.length) {
        accounts.push(
          ...favouriteResults.value.map((a: AnyAccount) => {
            a._types = ['favourite'];
            return a;
          }),
        );
      }
      return {
        value: accounts,
        done: reblogResults.done && favouriteResults.done,
      };
    }
    return {
      value: [],
      done: true,
    };
  }

  return {
    unauthInteractionErrorMessage,
    mediaNoDesc,
    statusMonthsAgo,
    replyStatus,
    confirmBoostStatus,
    favouriteStatus,
    favouriteStatusNotify,
    bookmarkStatus,
    bookmarkStatusNotify,
    fetchBoostedLikedByAccounts,
  };
}

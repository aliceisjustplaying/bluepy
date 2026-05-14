import { useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useMemo, useRef } from 'preact/hooks';

import haptics from '../utils/haptics';
import openCompose from '../utils/open-compose';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';
import supports from '../utils/supports';

import { REACTIONS_LIMIT } from './status-helpers';
import type { AnyAccount, AnyStatus, FullMasto } from './status-types';

type CachedStatus = (typeof states.statuses)[string];
function toCachedStatus(status: mastodon.v1.Status | AnyStatus): CachedStatus {
  const { account, quote, reblog, url, ...statusFields } = status;
  const cachedStatus: CachedStatus = {
    ...statusFields,
    account: account ? { ...account } : account,
    reblog: reblog ? toCachedStatus(reblog) : reblog,
  };
  return Object.assign(
    cachedStatus,
    quote === undefined ? {} : { quote },
    url === undefined ? {} : { url },
  );
}

type ReplyEvent =
  | (MouseEvent & { syntheticEvent?: { shiftKey?: boolean } })
  | (KeyboardEvent & { syntheticEvent?: { shiftKey?: boolean } })
  | { shiftKey?: boolean; syntheticEvent?: { shiftKey?: boolean } }
  | undefined;
type ReactionIterator = AsyncIterableIterator<AnyAccount[]>;

interface StatusInteractionsArgs {
  statusID?: string | null;
  status: AnyStatus;
  sKey: string;
  id: string;
  instance: string;
  masto: FullMasto;
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
  const unauthInteractionErrorMessage = t`Sorry, your current logged-in server can't interact with this post from another server.`;
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

  const replyStatus = (e?: ReplyEvent, replyMode: string = 'all') => {
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return;
    }
    if (e?.shiftKey || e?.syntheticEvent?.shiftKey) {
      const newWin = openCompose({
        replyToStatus: status,
        replyMode,
      });
      if (newWin) return;
    }
    showCompose({
      replyToStatus: status,
      replyMode,
    } as Parameters<typeof showCompose>[0]);
  };

  const confirmBoostStatus = async () => {
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return false;
    }
    try {
      states.statuses[sKey] = toCachedStatus({
        ...status,
        reblogged: !reblogged,
        reblogsCount: reblogsCount + (reblogged ? -1 : 1),
      });
      if (reblogged) {
        const newStatus = await masto.v1.statuses.$select(id).unreblog();
        saveStatus(toCachedStatus(newStatus), instance);
      } else {
        const newStatus = await masto.v1.statuses.$select(id).reblog();
        saveStatus(toCachedStatus(newStatus), instance);
      }
      return true;
    } catch (e) {
      console.error(e);
      states.statuses[sKey] = toCachedStatus(status);
      return false;
    }
  };

  const favouriteStatus = async () => {
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return false;
    }
    try {
      states.statuses[sKey] = toCachedStatus({
        ...status,
        favourited: !favourited,
        favouritesCount: favouritesCount + (favourited ? -1 : 1),
      });
      if (favourited) {
        const newStatus = await masto.v1.statuses.$select(id).unfavourite();
        saveStatus(toCachedStatus(newStatus), instance);
      } else {
        const newStatus = await masto.v1.statuses.$select(id).favourite();
        saveStatus(toCachedStatus(newStatus), instance);
      }
      return true;
    } catch (e) {
      console.error(e);
      states.statuses[sKey] = toCachedStatus(status);
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
    if (!supports('@mastodon/post-bookmark')) return false;
    if (!sameInstance || !authenticated) {
      alert(unauthInteractionErrorMessage);
      return false;
    }
    try {
      states.statuses[sKey] = toCachedStatus({
        ...status,
        bookmarked: !bookmarked,
      });
      if (bookmarked) {
        const newStatus = await masto.v1.statuses.$select(id).unbookmark();
        saveStatus(toCachedStatus(newStatus), instance);
      } else {
        const newStatus = await masto.v1.statuses.$select(id).bookmark();
        saveStatus(toCachedStatus(newStatus), instance);
      }
      return true;
    } catch (e) {
      console.error(e);
      states.statuses[sKey] = toCachedStatus(status);
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
      const stmtSel = masto.v1.statuses.$select(statusID as string);
      reblogIterator.current = (
        stmtSel.rebloggedBy.list as unknown as (
          opts?: Record<string, unknown>,
        ) => { values: () => ReactionIterator }
      )({
        limit: REACTIONS_LIMIT,
      }).values();
      favouriteIterator.current = (
        stmtSel.favouritedBy.list as unknown as (
          opts?: Record<string, unknown>,
        ) => { values: () => ReactionIterator }
      )({
        limit: REACTIONS_LIMIT,
      }).values();
    }
    type IteratorResult = { value?: AnyAccount[]; done?: boolean };
    const [{ value: reblogResults }, { value: favouriteResults }] =
      (await Promise.allSettled([
        reblogIterator.current!.next(),
        favouriteIterator.current!.next(),
      ])) as unknown as [{ value: IteratorResult }, { value: IteratorResult }];
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

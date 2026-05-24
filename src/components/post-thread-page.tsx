import type { AppBskyFeedDefs } from '@atproto/api';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import { collectThreadUris } from '../data/_internal/thread-uris';
import { usePostRoute, useThread } from '../data/posts';
import {
  clearPostDeckBackStack,
  getPostDeckCloseLink,
  peekPostDeckBackEntry,
  popPostDeckBackEntry,
  setPostDeckCloseLink,
} from '../utils/post-deck-stack';
import { canonicalizeAppPath, navigatePath } from '../utils/router';
import states from '../utils/states';
import useTitle from '../utils/useTitle';

import Icon from './icon';
import LinkComponent from './link';
import Loader from './loader';
import PostByUri from './post-by-uri';

function isModifiedClick(event: ReactMouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export interface PostThreadPageProps {
  uri: string;
  closeLink?: string;
  instance?: string;
}

function isThreadViewPost(
  node: unknown,
): node is AppBskyFeedDefs.ThreadViewPost {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { $type?: string }).$type === 'app.bsky.feed.defs#threadViewPost'
  );
}

function collectAncestors(thread: AppBskyFeedDefs.ThreadViewPost): string[] {
  const ancestors: string[] = [];
  let cursor: unknown = thread.parent;
  while (isThreadViewPost(cursor)) {
    ancestors.unshift(cursor.post.uri);
    cursor = cursor.parent;
  }
  return ancestors;
}

function makeAnchorThread(
  post: AppBskyFeedDefs.PostView | undefined,
): AppBskyFeedDefs.ThreadViewPost | undefined {
  if (!post) return undefined;
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post,
    replies: [],
  };
}

function ThreadReplyList({
  replies,
  instance,
}: {
  replies: AppBskyFeedDefs.ThreadViewPost['replies'];
  instance: string;
}) {
  const threadReplies: AppBskyFeedDefs.ThreadViewPost[] = [];
  for (const reply of replies ?? []) {
    if (isThreadViewPost(reply)) threadReplies.push(reply);
  }
  if (threadReplies.length === 0) return null;
  return (
    <ul className="timeline flat contextual">
      {threadReplies.map((reply) => (
        <li key={reply.post.uri} className="descendant thread">
          <ThreadReplyLink className="status-link" uri={reply.post.uri}>
            <PostByUri
              uri={reply.post.uri}
              instance={instance}
              showActionsBar
              showReplyParent
            />
          </ThreadReplyLink>
          <ThreadReplyList replies={reply.replies} instance={instance} />
        </li>
      ))}
    </ul>
  );
}

function ThreadReplyLink({
  uri,
  className,
  children,
}: {
  uri: string;
  className: string;
  children: ReactNode;
}) {
  const href = canonicalizeAppPath(`/${uri}`);
  const navigate = useCallback(() => {
    states.prevLocation = {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    };
    navigatePath(href);
  }, [href]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (isModifiedClick(event)) return;
      event.preventDefault();
      navigate();
    },
    [navigate],
  );
  return (
    <div className={className} data-href={href}>
      <a
        className="status-link-native"
        href={href}
        aria-hidden="true"
        tabIndex={-1}
        onClick={handleClick}
      />
      {children}
    </div>
  );
}

export default function PostThreadPage({
  uri,
  closeLink = '/',
  instance = 'bsky.social',
}: PostThreadPageProps) {
  const { t } = useLingui();
  const {
    data: thread,
    isLoading,
    isPlaceholderData,
    error,
  } = useThread(uri);
  const { data: anchorPost, isLoading: isAnchorLoading } = usePostRoute(uri);
  const heroRef = useRef<HTMLLIElement | null>(null);
  const hasAlignedHeroRef = useRef(false);
  const backLink = peekPostDeckBackEntry();
  const completeCloseLink = backLink
    ? getPostDeckCloseLink() || closeLink
    : closeLink;
  const displayThread = useMemo(
    () => thread ?? makeAnchorThread(anchorPost),
    [anchorPost, thread],
  );
  const uris = useMemo(
    () => (displayThread ? collectThreadUris(displayThread) : []),
    [displayThread],
  );
  const ancestors = useMemo(
    () => (thread ? collectAncestors(thread) : []),
    [thread],
  );
  const navigateBack = useCallback(() => {
    const backTarget = popPostDeckBackEntry();
    if (backTarget) navigatePath(backTarget);
  }, []);
  const clearBackStack = useCallback(() => {
    clearPostDeckBackStack();
  }, []);

  useLayoutEffect(() => {
    if (!backLink) setPostDeckCloseLink(closeLink);
  }, [backLink, closeLink]);

  useLayoutEffect(() => {
    hasAlignedHeroRef.current = false;
    const hero = heroRef.current;
    const scroller = hero?.closest<HTMLElement>('.status-deck');
    if (scroller) scroller.scrollTop = 0;
  }, [uri]);

  useLayoutEffect(() => {
    if (!thread || isPlaceholderData || hasAlignedHeroRef.current) {
      return undefined;
    }
    hasAlignedHeroRef.current = true;
    const alignHero = () => {
      const hero = heroRef.current;
      const scroller = hero?.closest<HTMLElement>('.status-deck');
      if (!hero || !scroller) return;
      const heroRect = hero.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const header = scroller.querySelector<HTMLElement>(':scope > header');
      const headerBottom =
        header?.getBoundingClientRect().bottom ?? scrollerRect.top;
      const targetTop = Math.max(0, headerBottom - scrollerRect.top);
      scroller.scrollTop += heroRect.top - scrollerRect.top - targetTop;
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(alignHero);
    });
    const settleTimer = window.setTimeout(alignHero, 80);
    return () => {
      window.clearTimeout(settleTimer);
    };
  }, [isPlaceholderData, thread, uri]);

  useTitle(t`Post`, ['/s/:id', '/:instance/s/:id', '/:atUri', '/:scheme://*']);

  return (
    <div
      className={`status-deck deck contained ${
        uris.length > 1 ? 'padded-bottom' : ''
      }`}
    >
      <header>
        <div className="header-grid header-grid-2 post-thread-header">
          <h1>
            {backLink ? (
              <button
                type="button"
                className="plain deck-back"
                onClick={navigateBack}
              >
                <Icon icon="chevron-left" size="xl" alt={t`Back`} />
              </button>
            ) : null}
            <Trans id="post.title">Post</Trans>
          </h1>
          <div className="header-side">
            <LinkComponent
              className="button plain deck-close"
              to={completeCloseLink}
              onClick={clearBackStack}
            >
              <Icon icon="x" size="l" alt={t`Close`} />
            </LinkComponent>
          </div>
        </div>
      </header>
      {error && !displayThread ? (
        <p className="ui-state">{error.message}</p>
      ) : (isLoading || isAnchorLoading) && uris.length === 0 ? (
        <ul className="timeline flat contextual grow loading">
          <li>
            <Loader />
          </li>
        </ul>
      ) : (
        <ul className="timeline flat contextual grow">
          {ancestors.map((postUri) => (
            <li key={postUri} className="ancestor thread">
              <ThreadReplyLink className="status-link" uri={postUri}>
                <PostByUri uri={postUri} instance={instance} showActionsBar />
              </ThreadReplyLink>
            </li>
          ))}
          {displayThread ? (
            <li className="hero" ref={heroRef}>
              <PostByUri
                uri={displayThread.post.uri}
                instance={instance}
                showActionsBar
                size="l"
              />
              {thread ? (
                <ThreadReplyList replies={thread.replies} instance={instance} />
              ) : null}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

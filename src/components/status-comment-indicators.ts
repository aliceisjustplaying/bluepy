import { useMemo } from 'react';

import { QUESTION_REGEX, SHOW_COMMENT_COUNT_LIMIT } from './status-helpers';

interface StatusCommentIndicatorsArgs {
  enableCommentHint?: boolean;
  withinContext?: boolean;
  inReplyToId?: string | null;
  inReplyToAccountId?: string | null;
  statusAccountId?: string | null;
  statusThreadNumber?: unknown;
  visibility?: string;
  repliesCount?: number;
  forceShowCommentCount?: boolean | ((count?: number) => boolean);
  forceShowQuoteCount?: boolean | ((count?: number) => boolean);
  quotesCount?: number;
  card?: unknown;
  sensitive?: boolean;
  spoilerText?: string | null;
  mediaCount: number;
  content: string;
  contentLength: number;
}

export default function useStatusCommentIndicators({
  enableCommentHint,
  withinContext,
  inReplyToId,
  inReplyToAccountId,
  statusAccountId,
  statusThreadNumber,
  visibility,
  repliesCount = 0,
  forceShowCommentCount,
  forceShowQuoteCount,
  quotesCount,
  card,
  sensitive,
  spoilerText,
  mediaCount,
  content,
  contentLength,
}: StatusCommentIndicatorsArgs) {
  const isThread = useMemo(() => {
    return (
      (!!inReplyToId && inReplyToAccountId === statusAccountId) ||
      !!statusThreadNumber
    );
  }, [inReplyToId, inReplyToAccountId, statusAccountId, statusThreadNumber]);

  const showCommentHint = useMemo(() => {
    return (
      enableCommentHint &&
      !isThread &&
      !withinContext &&
      !inReplyToId &&
      (visibility === 'public' || visibility === 'everybody') &&
      repliesCount > 0
    );
  }, [
    enableCommentHint,
    isThread,
    withinContext,
    inReplyToId,
    repliesCount,
    visibility,
  ]);

  const showCommentCount = useMemo(() => {
    if (forceShowCommentCount && repliesCount > 0) return true;
    if (
      card ||
      sensitive ||
      spoilerText ||
      mediaCount > 0 ||
      isThread ||
      withinContext ||
      inReplyToId ||
      repliesCount <= 0
    ) {
      return false;
    }
    const containsQuestion = QUESTION_REGEX.test(content);
    if (!containsQuestion) return false;
    if (contentLength > 0 && contentLength <= SHOW_COMMENT_COUNT_LIMIT) {
      return true;
    }
    return false;
  }, [
    forceShowCommentCount,
    card,
    sensitive,
    spoilerText,
    mediaCount,
    isThread,
    withinContext,
    inReplyToId,
    repliesCount,
    content,
    contentLength,
  ]);

  const showQuoteCount =
    typeof forceShowQuoteCount === 'function'
      ? forceShowQuoteCount(quotesCount)
      : forceShowQuoteCount && (quotesCount || 0) > 0;

  return {
    isThread,
    showCommentHint,
    showCommentCount,
    showQuoteCount,
  };
}

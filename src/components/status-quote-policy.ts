import { useLingui } from '@lingui/react/macro';

import {
  getPostQuoteApprovalPolicy,
  supportsNativeQuote,
} from '../utils/quote-utils';

import {
  quoteApprovalPolicyMessages,
  quoteMessages,
} from './status-helpers';

interface QuoteApprovalShape {
  currentUser?: string;
  automatic?: readonly string[];
  manual?: readonly string[];
}

interface StatusQuotePolicyArgs {
  quoteApproval?: QuoteApprovalShape;
  isPublic: boolean;
  isSelf: boolean | '' | null | undefined;
  visibility?: string;
}

export default function useStatusQuotePolicy({
  quoteApproval,
  isPublic,
  isSelf,
  visibility,
}: StatusQuotePolicyArgs) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  let quoteDisabled = false;
  let quoteText = t`Quote`;
  let quoteMetaText: string | undefined;

  if (supportsNativeQuote()) {
    const isMine = isSelf;
    const isMineAndPrivate = isMine && visibility === 'private';
    const isQuoteAutomaticallyAccepted =
      quoteApproval?.currentUser === 'automatic' &&
      (isPublic || isMineAndPrivate);
    const isQuoteManuallyAccepted =
      quoteApproval?.currentUser === 'manual' && (isPublic || isMineAndPrivate);
    const isQuoteFollowersOnly =
      quoteApproval?.automatic?.[0] === 'followers' ||
      quoteApproval?.manual?.[0] === 'followers';
    if (!isPublic && !isMine) {
      quoteDisabled = true;
      quoteMetaText = _(quoteMessages.quotePrivate);
    } else if (isQuoteAutomaticallyAccepted) {
      // No need to do anything
    } else if (isQuoteManuallyAccepted) {
      quoteText = _(quoteMessages.requestQuote);
      quoteMetaText = _(quoteMessages.quoteManualReview);
    } else {
      quoteDisabled = true;
      quoteMetaText = isQuoteFollowersOnly
        ? _(quoteMessages.quoteFollowersOnly)
        : _(quoteMessages.quoteCannot);
    }
  }

  return {
    quoteDisabled,
    quoteText,
    quoteMetaText,
    canQuote: supportsNativeQuote() && !quoteDisabled,
    postQuoteApprovalPolicy: getPostQuoteApprovalPolicy(
      quoteApproval ? { ...quoteApproval } : quoteApproval,
    ),
    quoteApprovalPolicyMessages,
  };
}

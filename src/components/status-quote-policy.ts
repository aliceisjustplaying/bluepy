import { useLingui } from '@lingui/react/macro';

import {
  getPostQuoteApprovalPolicy,
  supportsNativeQuote,
} from '../utils/quote-utils';

import { quoteApprovalPolicyMessages, quoteMessages } from './status-helpers';

interface QuoteApprovalShape {
  currentUser?: string;
  automatic?: readonly string[];
  manual?: readonly string[];
}

interface StatusQuotePolicyArgs {
  quoteApproval?: QuoteApprovalShape;
}

export default function useStatusQuotePolicy({
  quoteApproval,
}: StatusQuotePolicyArgs) {
  const { t, i18n } = useLingui();
  const _ = i18n._.bind(i18n);

  let quoteDisabled = false;
  let quoteText = t`Quote`;
  let quoteMetaText: string | undefined;

  if (supportsNativeQuote()) {
    const isQuoteAutomaticallyAccepted =
      quoteApproval?.currentUser === 'automatic';
    const isQuoteManuallyAccepted = quoteApproval?.currentUser === 'manual';
    const isQuoteFollowersOnly =
      quoteApproval?.automatic?.[0] === 'followers' ||
      quoteApproval?.manual?.[0] === 'followers';
    if (isQuoteAutomaticallyAccepted) {
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

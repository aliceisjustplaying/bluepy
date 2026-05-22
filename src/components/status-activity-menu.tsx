import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';

import type { AtprotoCompat } from '../types/atproto-compat';
import { supportsNativeQuote } from '../utils/quote-utils';
import states from '../utils/states';

import Icon from './icon';
import type { StatusMenuPartsArgs } from './status-menu-types';

type StatusActivityMenuProps = Pick<
  StatusMenuPartsArgs,
  | 'fetchBoostedLikedByAccounts'
  | 'instance'
  | 'sKey'
  | 'setShowQuotes'
  | 'quote'
  | 'setShowQuoteChain'
>;

export default function StatusActivityMenu({
  fetchBoostedLikedByAccounts,
  instance,
  sKey,
  setShowQuotes,
  quote,
  setShowQuoteChain,
}: StatusActivityMenuProps) {
  const { t } = useLingui();

  return (
    <>
      <MenuItem
        onClick={() => {
          states.showGenericAccounts = {
            heading: t`Reposted/Liked by…`,
            fetchAccounts: fetchBoostedLikedByAccounts,
            instance,
            showReactions: true,
            postID: sKey,
          };
        }}
      >
        <Icon icon="react" />
        <span>
          <Trans>Reposted/Liked by…</Trans>
        </span>
      </MenuItem>
      {supportsNativeQuote() && (
        <MenuItem
          onClick={() => {
            setShowQuotes(true);
          }}
        >
          <Icon icon="quote" />
          <span>
            <Trans>View Quotes</Trans>
          </span>
        </MenuItem>
      )}
      {(quote as AtprotoCompat.v1.Quote | null | undefined)?.quotedStatus
        ?.quote && (
        <MenuItem
          onClick={() => {
            setShowQuoteChain(true);
          }}
        >
          <Icon icon="quote" />
          <span>
            <Trans>Unwrap quote chain</Trans>
          </span>
        </MenuItem>
      )}
    </>
  );
}

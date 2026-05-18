import { useLingui } from '@lingui/react/macro';

import shortenNumber from '../utils/shorten-number';

import Icon from './icon';
import type { StatusMenuPartsArgs } from './status-menu-types';

type StatusReplyMenuArgs = Pick<StatusMenuPartsArgs, 'repliesCount'>;

export default function useStatusReplyMenu({
  repliesCount = 0,
}: StatusReplyMenuArgs) {
  const { t } = useLingui();
  const ReplyMenuContent = () => (
    <>
      <Icon icon="comment" />
      <span>{repliesCount > 0 ? shortenNumber(repliesCount) : t`Reply`}</span>
    </>
  );

  return { ReplyMenuContent };
}

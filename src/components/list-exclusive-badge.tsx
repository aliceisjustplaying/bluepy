import './list-exclusive-badge.css';

import { useLingui } from '@lingui/react/macro';

import Icon from './icon';

interface ListExclusiveBadgeProps {
  insignificant?: boolean;
}

function ListExclusiveBadge({ insignificant }: ListExclusiveBadgeProps) {
  const { t } = useLingui();
  return (
    <Icon
      icon="filter"
      size="xs"
      alt={undefined}
      class={`list-exclusive-badge ${insignificant ? 'insignificant' : ''}`}
      title={t`Posts on this list are hidden from Home/Following`}
    />
  );
}

export default ListExclusiveBadge;

import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';

import NotificationsFeed from '../components/notifications-feed';

function Mentions() {
  const { t } = useLingui();
  const [onlyFollowings, setOnlyFollowings] = useState(false);

  const timelineStart = useMemo(
    () => (
      <div id="followings-option">
        <label>
          <input
            aria-label={t`Only followings`}
            type="checkbox"
            checked={onlyFollowings}
            onChange={(e) => {
              setOnlyFollowings(e.currentTarget.checked);
            }}
          />{' '}
          <Trans>Only followings</Trans>
        </label>
      </div>
    ),
    [onlyFollowings, t],
  );

  return (
    <NotificationsFeed
      title={t`Mentions`}
      path="/mentions"
      id="mentions"
      filter={['mention', 'reply']}
      onlyFollowing={onlyFollowings}
      postOnly
      timelineStart={timelineStart}
      emptyText={t`No one mentioned you :(`}
      errorText={t`Unable to load mentions.`}
    />
  );
}

export default Mentions;

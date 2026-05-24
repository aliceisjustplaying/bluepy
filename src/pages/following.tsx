import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

import TimelineFeed from '../components/timeline-feed';
import states from '../utils/states';
import store from '../utils/store';

interface FollowingProps {
  title?: string;
  path?: string;
  id?: string;
  headerStart?: boolean;
  headerEnd?: ReactNode;
}

function Following({ title, path, id, headerStart, headerEnd }: FollowingProps) {
  const { t } = useLingui();
  useEffect(() => {
    if (path === '/') return;
    const homeTimeline = { type: 'following' };
    store.account.set('homeTimeline', homeTimeline);
    states.homeTimeline = homeTimeline;
  }, [path]);

  return (
    <TimelineFeed
      title={title || t({ id: 'following.title', message: 'Following' })}
      path={path || '/following'}
      id={id || 'following'}
      headerStart={headerStart}
      headerEnd={headerEnd}
    />
  );
}

export default Following;

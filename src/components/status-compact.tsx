import { Trans } from '@lingui/react/macro';
import { use } from 'react';
import { useSnapshot } from 'valtio';

import FilterContext from '../utils/filter-context';
import { isFiltered } from '../utils/filters';
import states, { getStatus, statusKey } from '../utils/states';
import statusPeek from '../utils/status-peek';
import { getCurrentAccID } from '../utils/store-utils';

import Avatar from './avatar';
import LazyRender from './lazy-render';

interface StatusCompactProps {
  sKey: string;
}

interface StatusReplyEntry {
  id?: string;
  instance?: string;
}

function StatusCompact({ sKey }: StatusCompactProps) {
  const snapStates = useSnapshot(states);
  const filterContext = use(FilterContext);
  const statusReply = snapStates.statusReply[sKey] as
    | StatusReplyEntry
    | undefined;
  if (!statusReply) return null;

  const { id, instance } = statusReply;
  const status = getStatus(id, instance);
  if (!status) return null;

  const {
    account: { id: accountId } = {},
    sensitive,
    spoilerText,
    account: { avatar, avatarStatic, bot } = {},
    content,
    language,
    filtered,
  } = status as {
    account?: {
      id?: string;
      avatar?: string;
      avatarStatic?: string;
      bot?: boolean;
    };
    sensitive?: boolean;
    spoilerText?: string;
    visibility?: string;
    content?: string;
    language?: string;
    filtered?: Parameters<typeof isFiltered>[0];
  };
  if (sensitive || spoilerText) return null;
  if (!content) return null;

  const srKey = statusKey(id, instance);
  const statusPeekText = statusPeek(status as Parameters<typeof statusPeek>[0]);

  const currentAccount = getCurrentAccID();
  const isSelf = currentAccount && currentAccount === accountId;

  let filterInfo = isSelf
    ? (false as const)
    : isFiltered(filtered, filterContext as string);

  // This is fine. Images are converted to emojis so they are
  // in a way, already "obscured"
  if (filterInfo && filterInfo.action === 'blur') filterInfo = false;

  if (filterInfo && filterInfo.action === 'hide') return null;

  const filterTitleStr = filterInfo ? filterInfo.titlesStr : '';

  return (
    <LazyRender
      as="article"
      id={srKey}
      className="status compact-reply"
      tabIndex={-1}
      data-state-post-id={srKey}
      renderIfHasChildren={false}
    >
      <Avatar url={avatarStatic || avatar} squircle={bot} />
      <div
        className="content-compact"
        title={statusPeekText}
        lang={language}
        dir="auto"
      >
        {filterInfo ? (
          <b
            className="status-filtered-badge badge-meta"
            title={filterTitleStr}
          >
            <span>
              <Trans>Filtered</Trans>
            </span>
            <span>{filterTitleStr}</span>
          </b>
        ) : (
          <span>{statusPeekText}</span>
        )}
      </div>
    </LazyRender>
  );
}

export default StatusCompact;

import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';

import Icon from './icon';
import NameText, { type NameTextProps } from './name-text';

function BylineNameText(props: {
  account: unknown;
  showAvatar?: boolean;
}) {
  return <NameText {...(props as NameTextProps)} />;
}

interface Author {
  account?: {
    id?: string;
  } & Record<string, unknown>;
}

interface BylineProps {
  authors?: Author[];
  hidden?: boolean;
  children?: ReactNode;
}

function Byline({ authors, hidden, children }: BylineProps) {
  if (hidden) return children;
  if (!authors?.[0]?.account?.id) return children;
  const author = authors[0].account;

  return (
    <div className="card-byline">
      {children}
      <div className="card-byline-author">
        <Icon icon="link" size="s" />{' '}
        <small>
          <Trans comment="More from [Author]">
            More from <BylineNameText account={author} showAvatar />
          </Trans>
        </small>
      </div>
    </div>
  );
}

export default Byline;

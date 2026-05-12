import { Trans } from '@lingui/react/macro';
import type { ComponentChildren, ComponentType } from 'preact';

import IconRaw from './icon';
import NameTextRaw from './name-text';

const Icon = IconRaw as unknown as ComponentType<{
  icon: string;
  size?: string;
}>;
const NameText = NameTextRaw as unknown as ComponentType<{
  account: unknown;
  showAvatar?: boolean;
}>;

interface Author {
  account?: {
    id?: string;
  } & Record<string, unknown>;
}

interface BylineProps {
  authors?: Author[];
  hidden?: boolean;
  children?: ComponentChildren;
}

function Byline({ authors, hidden, children }: BylineProps) {
  if (hidden) return children;
  if (!authors?.[0]?.account?.id) return children;
  const author = authors[0].account;

  return (
    <div class="card-byline">
      {children}
      <div class="card-byline-author">
        <Icon icon="link" size="s" />{' '}
        <small>
          <Trans comment="More from [Author]">
            More from <NameText account={author} showAvatar />
          </Trans>
        </small>
      </div>
    </div>
  );
}

export default Byline;

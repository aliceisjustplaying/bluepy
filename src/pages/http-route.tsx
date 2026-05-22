import { Trans } from '@lingui/react/macro';
import { useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Link from '../components/link';
import Loader from '../components/loader';
import { getAtprotoPathFromBskyAppURL } from '../utils/atproto-route';
import { navigatePath } from '../utils/router';

export default function HttpRoute() {
  const location = useLocation();
  const url = decodeURIComponent(location.pathname.replace(/^\//, ''));
  const [uiState, setUIState] = useState<'loading' | 'error'>('loading');

  useLayoutEffect(() => {
    setUIState('loading');
    const atprotoPath = getAtprotoPathFromBskyAppURL(url);
    if (atprotoPath) {
      navigatePath(atprotoPath);
      return;
    }
    setUIState('error');
  }, [url]);

  return (
    <div className="ui-state" tabIndex={-1}>
      {uiState === 'loading' ? (
        <>
          <Loader abrupt />
          <h2>
            <Trans>Resolving…</Trans>
          </h2>
          <p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </p>
        </>
      ) : (
        <>
          <h2>
            <Trans>Unable to resolve URL</Trans>
          </h2>
          <p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </p>
        </>
      )}
      <hr />
      <p>
        <Link to="/">
          <Trans>Go home</Trans>
        </Link>
      </p>
    </div>
  );
}

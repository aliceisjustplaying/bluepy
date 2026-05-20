import { Trans } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Link from '../components/link';
import Loader from '../components/loader';
import { api, getMastoV2Resource } from '../utils/api';
import { navigatePath } from '../utils/router';

export default function HttpRoute() {
  const location = useLocation();
  const url = location.pathname.replace(/^\//, '');
  const [uiState, setUIState] = useState<'loading' | 'error'>('loading');

  useLayoutEffect(() => {
    let active = true;
    setUIState('loading');
    void (async () => {
      try {
        const { masto: currentMasto, instance: currentInstance } = api();
        const searchResource =
          getMastoV2Resource<mastodon.rest.v2.SearchResource>(
            currentMasto,
            'search',
          );
        const result = await searchResource.list({
          q: url,
          limit: 1,
          resolve: true,
        });
        if (!active) return;
        if (result.statuses?.length) {
          const status = result.statuses[0];
          navigatePath(`/${currentInstance}/s/${status.id}?view=full`);
        } else if (result.accounts?.length) {
          const account = result.accounts[0];
          navigatePath(`/${currentInstance}/a/${account.id}`);
        } else {
          setUIState('error');
        }
      } catch (error) {
        console.error(error);
        if (active) {
          setUIState('error');
        }
      }
    })();
    return () => {
      active = false;
    };
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

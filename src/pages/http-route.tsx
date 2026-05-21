import { Trans } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Link from '../components/link';
import Loader from '../components/loader';
import { api, getMastoV1Resource, getMastoV2Resource } from '../utils/api';
import { getInstanceStatusObject } from '../utils/get-instance-status-url';
import { navigatePath } from '../utils/router';

export default function HttpRoute() {
  const location = useLocation();
  const url = location.pathname.replace(/^\//, '');
  // Memoize so `statusObject` identity is stable per `url` and the
  // useLayoutEffect dep list below can include it without looping.
  const statusObject = useMemo(() => getInstanceStatusObject(url), [url]);
  // const statusURL = getInstanceStatusURL(url);
  const statusURL = statusObject?.instance
    ? `/${statusObject.instance}/s/${statusObject.id}`
    : null;
  const [uiState, setUIState] = useState<'loading' | 'error'>('loading');

  useLayoutEffect(() => {
    setUIState('loading');
    void (async () => {
      // Check if status returns 200
      try {
        const { instance, id } = statusObject;
        if (id) {
          const { masto } = api({ instance });
          const statusesResource =
            getMastoV1Resource<mastodon.rest.v1.StatusesResource>(
              masto,
              'statuses',
            );
          const status = await statusesResource.$select(id).fetch();
          if (status) {
            navigatePath(statusURL + '?view=full');
            return;
          }
        }
      } catch {
        // ignore: fall through to search fallback
      }

      // Fallback to search
      {
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
        if (result.statuses.length) {
          const status = result.statuses[0];
          navigatePath(`/${currentInstance}/s/${status.id}?view=full`);
        } else if (result.accounts.length) {
          const account = result.accounts[0];
          navigatePath(`/${currentInstance}/a/${account.id}`);
        } else if (statusURL) {
          // Fallback to original URL, which will probably show error
          navigatePath(statusURL + '?view=full');
        } else {
          setUIState('error');
        }
      }
    })();
  }, [statusURL, url, statusObject]);

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

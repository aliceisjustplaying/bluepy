import { Trans } from '@lingui/react/macro';
import { useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Link from '../components/link';
import Loader from '../components/loader';
import {
  buildAtprotoProfileURI,
  buildAtprotoRecordPath,
  isAtprotoRecordURI,
} from '../utils/atproto-route';
import {
  getOwnPermalinkRecordURI,
  resolveAtprotoPostURI,
} from '../utils/resolve-atproto-post-link';
import { navigatePath } from '../utils/router';

export default function HttpRoute() {
  const location = useLocation();
  const url = location.pathname.replace(/^\//, '');
  const [uiState, setUIState] = useState<'loading' | 'error'>('loading');

  useLayoutEffect(() => {
    setUIState('loading');
    void (async () => {
      // ATProto-only: route Bluesky post/profile/record links internally and
      // leave anything else as an external link. We never resolve arbitrary
      // URLs through a Mastodon-style search.
      try {
        const postURI = await resolveAtprotoPostURI(url);
        if (postURI) {
          navigatePath(buildAtprotoRecordPath(postURI));
          return;
        }

        // bsky.app/profile/<handleOrDid> (no /post/) → profile
        const profileMatch = url.match(
          /^https?:\/\/bsky\.app\/profile\/([^/?#\s]+)\/?$/i,
        );
        if (profileMatch) {
          const repo = decodeURIComponent(profileMatch[1]);
          navigatePath(buildAtprotoRecordPath(buildAtprotoProfileURI(repo)));
          return;
        }

        // Our own permalinks for profiles/lists/feeds carry the at:// URI in
        // the path (post URIs are already handled by resolveAtprotoPostURI).
        const recordURI = getOwnPermalinkRecordURI(url);
        if (isAtprotoRecordURI(recordURI)) {
          navigatePath(buildAtprotoRecordPath(recordURI));
          return;
        }

        setUIState('error');
      } catch {
        setUIState('error');
      }
    })();
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

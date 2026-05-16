import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { useEffect, useState } from 'react';

import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import NavMenu from '../components/nav-menu';
import { api } from '../utils/api';
import { fetchFollowedTags } from '../utils/followed-tags';
import useTitle from '../utils/useTitle';

function FollowedHashtags() {
  const { t } = useLingui();
  const { instance } = api();
  useTitle(t`Followed Hashtags`, `/fh`);
  const [uiState, setUIState] = useState<'default' | 'loading' | 'error'>(
    'default',
  );

  const [followedHashtags, setFollowedHashtags] = useState<mastodon.v1.Tag[]>(
    [],
  );
  useEffect(() => {
    setUIState('loading');
    void (async () => {
      try {
        const tags = await fetchFollowedTags();
        setFollowedHashtags(tags);
        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  }, []);

  return (
    <div id="followed-hashtags-page" className="deck-container" tabIndex={-1}>
      <div className="timeline-deck deck">
        <header>
          <div className="header-grid">
            <div className="header-side">
              <NavMenu />
              <Link to="/" className="button plain">
                <Icon icon="home" size="l" alt={t`Home`} />
              </Link>
            </div>
            <h1>
              <Trans>Followed Hashtags</Trans>
            </h1>
            <div className="header-side" />
          </div>
        </header>
        <main>
          {followedHashtags.length > 0 ? (
            <>
              <ul className="link-list">
                {followedHashtags.map((tag) => (
                  <li key={tag.name}>
                    <Link
                      to={
                        instance
                          ? `/${instance}/t/${tag.name}`
                          : `/t/${tag.name}`
                      }
                    >
                      <Icon icon="hashtag" alt="#" /> <span>{tag.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {followedHashtags.length > 1 && (
                <footer className="ui-state">
                  <small className="insignificant">
                    <Plural
                      value={followedHashtags.length}
                      one="# hashtag"
                      other="# hashtags"
                    />
                  </small>
                </footer>
              )}
            </>
          ) : uiState === 'loading' ? (
            <p className="ui-state">
              <Loader abrupt />
            </p>
          ) : uiState === 'error' ? (
            <p className="ui-state">
              <Trans>Unable to load followed hashtags.</Trans>
            </p>
          ) : (
            <p className="ui-state">
              <Trans>No hashtags followed yet.</Trans>
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

export default FollowedHashtags;

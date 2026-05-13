import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import type { ComponentChildren, ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import Icon from '../components/icon';
import LinkUntyped from '../components/link';
import Loader from '../components/loader';
import NavMenuUntyped from '../components/nav-menu';
import { api } from '../utils/api';
import { fetchFollowedTags } from '../utils/followed-tags';
import useTitle from '../utils/useTitle';

interface LinkProps {
  to: string;
  class?: string;
  children?: ComponentChildren;
}
const Link = LinkUntyped as unknown as ComponentType<LinkProps>;
const NavMenu = NavMenuUntyped as unknown as ComponentType<
  Record<string, never>
>;

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
    <div id="followed-hashtags-page" class="deck-container" tabIndex={-1}>
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <div class="header-side">
              <NavMenu />
              <Link to="/" class="button plain">
                <Icon icon="home" size="l" alt={t`Home`} />
              </Link>
            </div>
            <h1>
              <Trans>Followed Hashtags</Trans>
            </h1>
            <div class="header-side" />
          </div>
        </header>
        <main>
          {followedHashtags.length > 0 ? (
            <>
              <ul class="link-list">
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
                <footer class="ui-state">
                  <small class="insignificant">
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
            <p class="ui-state">
              <Loader abrupt />
            </p>
          ) : uiState === 'error' ? (
            <p class="ui-state">
              <Trans>Unable to load followed hashtags.</Trans>
            </p>
          ) : (
            <p class="ui-state">
              <Trans>No hashtags followed yet.</Trans>
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

export default FollowedHashtags;

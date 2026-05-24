import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  FocusableItem,
  MenuDivider,
  MenuGroup,
  MenuHeader,
  MenuItem,
} from '@szhsin/react-menu';
import type { SyntheticEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import Icon from '../components/icon';
import Menu2 from '../components/menu2';
import PostUriFeed from '../components/post-uri-feed';
import { SHORTCUTS_LIMIT } from '../components/shortcuts-settings';
import { useActiveDid } from '../contexts/SessionProvider';
import { useHashtagFeed } from '../data/search';
import { navigatePath } from '../utils/router';
import showToast from '../utils/show-toast';
import { sorted } from '../utils/sorted';
import states from '../utils/states';
import useTitle from '../utils/useTitle';

const TOTAL_TAGS_LIMIT = 5;

interface HashtagShortcut {
  type: 'hashtag';
  hashtag: string;
  instance?: string;
  media?: 'on' | undefined;
}

interface HashtagsProps {
  hashtag?: string;
  media?: boolean;
  columnMode?: boolean;
  instance?: string;
  [key: string]: unknown;
}

function Hashtags({ media: mediaView, columnMode, ...props }: HashtagsProps) {
  const { t } = useLingui();
  const activeDid = useActiveDid();
  const routerParams = useParams() as {
    hashtag?: string;
    instance?: string;
  };
  let { hashtag: rawHashtag, ...params } = columnMode ? {} : routerParams;
  if (props.hashtag) rawHashtag = props.hashtag;
  const hashtags = sorted((rawHashtag as string).trim().split(/[\s+]+/));
  const [searchParams, setSearchParams] = useSearchParams();
  const media = mediaView || !!searchParams.get('media');
  const linkParams = media ? '?media=1' : '';
  const instance = props?.instance || params.instance;

  const hashtagTitle = hashtags.map((tag) => `#${tag}`).join(' ');
  const title = instance
    ? media
      ? t`${hashtagTitle} (Media only) on ${instance}`
      : t`${hashtagTitle} on ${instance}`
    : media
      ? t`${hashtagTitle} (Media only)`
      : t`${hashtagTitle}`;
  useTitle(title, `/:instance?/t/:hashtag`);

  const source = useHashtagFeed(hashtags, { onlyMedia: media });
  const reachLimit = hashtags.length >= TOTAL_TAGS_LIMIT;

  return (
    <>
      <PostUriFeed
        key={`${instance || ''}-${hashtagTitle}-${media ? 'media' : 'all'}`}
        source={source}
        title={title}
        titleComponent={
          instance ? (
            <h1 className="header-double-lines">
              <b dir="auto">{hashtagTitle}</b>
              <div>{instance}</div>
            </h1>
          ) : undefined
        }
        id="hashtag"
        emptyText={t`No one has posted anything with this tag yet.`}
        errorText={t`Unable to load posts with this tag`}
        headerEnd={
          <Menu2
            portal
            setDownOverflow
            overflow="auto"
            position="anchor"
            menuButton={
              <button type="button" className="plain">
                <Icon icon="more" size="l" alt={t`More`} />
              </button>
            }
          >
            <MenuHeader className="plain">
              <Trans>Filters</Trans>
            </MenuHeader>
            <MenuItem
              type="checkbox"
              checked={media}
              onClick={() => {
                if (media) {
                  searchParams.delete('media');
                } else {
                  searchParams.set('media', '1');
                }
                setSearchParams(searchParams);
              }}
            >
              <Icon icon="check-circle" alt="☑️" />{' '}
              <span className="menu-grow">
                <Trans>Media only</Trans>
              </span>
            </MenuItem>
            <MenuDivider />
            <FocusableItem className="menu-field" disabled={reachLimit}>
              {({ ref }: { ref: React.Ref<HTMLInputElement> }) => (
                <form
                  onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.item(
                      0,
                    ) as HTMLInputElement | null;
                    const newHashtag = input?.value.trim();
                    if (
                      newHashtag &&
                      !hashtags.some(
                        (h) => h.toLowerCase() === newHashtag.toLowerCase(),
                      )
                    ) {
                      hashtags.push(newHashtag);
                      hashtags.sort();
                      navigatePath(
                        instance
                          ? `/${instance}/t/${hashtags.join('+')}${linkParams}`
                          : `/t/${hashtags.join('+')}${linkParams}`,
                      );
                    }
                  }}
                >
                  <Icon icon="hashtag" />
                  <input
                    ref={ref}
                    type="text"
                    aria-label={t`Add hashtag`}
                    placeholder={
                      reachLimit
                        ? plural(TOTAL_TAGS_LIMIT, {
                            other: 'Max # tags',
                          })
                        : t`Add hashtag`
                    }
                    required
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    pattern="[^#＃][^\s#＃]+[^#＃]"
                    disabled={reachLimit}
                    dir="auto"
                    enterKeyHint="go"
                  />
                </form>
              )}
            </FocusableItem>
            <MenuGroup takeOverflow>
              {hashtags.map((tag, i) => (
                <MenuItem
                  key={tag}
                  disabled={hashtags.length === 1}
                  onClick={() => {
                    hashtags.splice(i, 1);
                    hashtags.sort();
                    navigatePath(
                      instance
                        ? `/${instance}/t/${hashtags.join('+')}${linkParams}`
                        : `/t/${hashtags.join('+')}${linkParams}`,
                    );
                  }}
                >
                  <Icon
                    icon="x"
                    alt={t`Remove hashtag`}
                    className="danger-icon"
                  />
                  <span className="bidi-isolate">
                    <span className="more-insignificant">#</span>
                    {tag}
                  </span>
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuDivider />
            <MenuItem
              disabled={!activeDid}
              onClick={() => {
                if (states.shortcuts.length >= SHORTCUTS_LIMIT) {
                  alert(
                    plural(SHORTCUTS_LIMIT, {
                      one: 'Max # shortcut reached. Unable to add shortcut.',
                      other: 'Max # shortcuts reached. Unable to add shortcut.',
                    }),
                  );
                  return;
                }
                const shortcut: HashtagShortcut = {
                  type: 'hashtag',
                  hashtag: hashtags.join(' '),
                  instance,
                  media: media ? 'on' : undefined,
                };
                const exists = (states.shortcuts as HashtagShortcut[]).some(
                  (s) =>
                    s.type === shortcut.type &&
                    sorted(s.hashtag.split(/[\s+]+/)).join(' ') ===
                      sorted(shortcut.hashtag.split(/[\s+]+/)).join(' ') &&
                    (s.instance ? s.instance === shortcut.instance : true) &&
                    (s.media ? !!s.media === !!shortcut.media : true),
                );
                if (exists) {
                  alert(t`This shortcut already exists`);
                } else {
                  (states.shortcuts as HashtagShortcut[]).push(shortcut);
                  showToast(t`Hashtag shortcut added`);
                }
              }}
            >
              <Icon icon="shortcut" />{' '}
              <span>
                <Trans>Add to Shortcuts</Trans>
              </span>
            </MenuItem>
          </Menu2>
        }
      />
      {!columnMode && !!hashtags?.length && (
        <data
          className="compose-data"
          value={JSON.stringify({
            draftStatus: {
              status: `${hashtags.length > 1 ? '\n\n' : ' '}${hashtagTitle}`,
            },
          })}
        />
      )}
    </>
  );
}

export default Hashtags;

import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  FocusableItem,
  MenuDivider,
  MenuGroup,
  MenuHeader,
  MenuItem,
} from '@szhsin/react-menu';
import type { mastodon } from 'masto';
import type { SyntheticEvent } from 'react';
import { useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import Icon from '../components/icon';
import Menu2 from '../components/menu2';
import { SHORTCUTS_LIMIT } from '../components/shortcuts-settings';
import Timeline from '../components/timeline';
import { api, getMastoV1Resource } from '../utils/api';
import { filteredItems } from '../utils/filters';
import { navigatePath } from '../utils/router';
import showToast from '../utils/show-toast';
import { sorted } from '../utils/sorted';
import states, { saveStatus } from '../utils/states';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

// Limit is 4 per "mode"
// https://github.com/mastodon/mastodon/issues/15194
// Hard-coded https://github.com/mastodon/mastodon/blob/19614ba2477f3d12468f5ec251ce1cc5f8c6210c/app/models/tag_feed.rb#L4
const TAGS_LIMIT_PER_MODE = 4;
const TOTAL_TAGS_LIMIT = TAGS_LIMIT_PER_MODE + 1;

type HashtagStatus = mastodon.v1.Status;

interface SaveStatusPayload extends Record<string, unknown> {
  id?: string;
  account?: Record<string, unknown> & { id?: string };
  reblog?: SaveStatusPayload | null;
  quote?: SaveStatusPayload | null;
  state?: unknown;
  quotedStatus?: SaveStatusPayload | null;
}

function toSaveStatus(
  status: HashtagStatus | null | undefined,
): SaveStatusPayload | null | undefined {
  return status as SaveStatusPayload | null | undefined;
}

interface FetchHashtagsResult {
  done?: boolean;
  value: HashtagStatus[] | undefined;
}

interface HashtagListOptions {
  limit: number;
  any?: string[];
  maxId?: string;
  onlyMedia?: boolean;
  since_id?: string;
}

interface HashtagTimelineEndpoint {
  $select(hashtag: string): {
    list(options: HashtagListOptions): {
      values(): AsyncIterator<HashtagStatus[]>;
    };
  };
}

interface HashtagsProps {
  hashtag?: string;
  media?: boolean;
  columnMode?: boolean;
  instance?: string;
  [key: string]: unknown;
}

interface HashtagShortcut {
  type: 'hashtag';
  hashtag: string;
  instance?: string;
  media?: 'on' | undefined;
}

function Hashtags({ media: mediaView, columnMode, ...props }: HashtagsProps) {
  const { t } = useLingui();
  // const navigate = useNavigate();
  const routerParams = useParams() as {
    hashtag?: string;
    instance?: string;
  };
  let { hashtag: rawHashtag, ...params } = columnMode ? {} : routerParams;
  if (props.hashtag) rawHashtag = props.hashtag;
  const hashtags = sorted((rawHashtag as string).trim().split(/[\s+]+/));
  const hashtag: string = hashtags[0];
  const [searchParams, setSearchParams] = useSearchParams();
  const media = mediaView || !!searchParams.get('media');
  const linkParams = media ? '?media=1' : '';

  const { masto, instance } = api({
    instance: props?.instance || params.instance,
  });
  const { authenticated: currentAuthenticated } = api();
  const hashtagTitle = hashtags.map((tag) => `#${tag}`).join(' ');
  const title = instance
    ? media
      ? t`${hashtagTitle} (Media only) on ${instance}`
      : t`${hashtagTitle} on ${instance}`
    : media
      ? t`${hashtagTitle} (Media only)`
      : t`${hashtagTitle}`;
  useTitle(title, `/:instance?/t/:hashtag`);
  const latestItem = useRef<string | undefined>(undefined);

  const mediaFirst = false;

  const tagTimelines = getMastoV1Resource<{ tag: HashtagTimelineEndpoint }>(
    masto,
    'timelines',
  ).tag;
  // const hashtagsIterator = useRef();
  const maxID = useRef<string | undefined>(undefined);
  async function fetchHashtags(
    firstLoad?: boolean,
  ): Promise<FetchHashtagsResult> {
    // if (firstLoad || !hashtagsIterator.current) {
    //   hashtagsIterator.current = masto.v1.timelines.tag.$select(hashtag).list({
    //     limit: LIMIT,
    //     any: hashtags.slice(1),
    //   }).values();
    // }
    // const results = await hashtagsIterator.current.next();

    // NOTE: Temporary fix for listHashtag not persisting `any` in subsequent calls.
    const results = await tagTimelines
      .$select(hashtag)
      .list({
        limit: LIMIT,
        any: hashtags.slice(1),
        maxId: firstLoad ? undefined : maxID.current,
        onlyMedia: media ? true : undefined,
      })
      .values()
      .next();
    let { value } = results as { value: HashtagStatus[] | undefined };
    if (value?.length) {
      if (firstLoad) {
        latestItem.current = value[0].id;
      }

      // value = filteredItems(value, 'public');
      value.forEach((item) => {
        saveStatus(toSaveStatus(item), instance, {
          skipThreading: media || mediaFirst, // If media view, no need to form threads
        });
      });

      maxID.current = value[value.length - 1].id;
    }
    return {
      ...(results as { done?: boolean }),
      value,
    };
  }

  async function checkForUpdates(): Promise<boolean> {
    try {
      const results = await tagTimelines
        .$select(hashtag)
        .list({
          limit: 1,
          any: hashtags.slice(1),
          since_id: latestItem.current,
          onlyMedia: media,
        })
        .values()
        .next();
      let { value } = results as { value: HashtagStatus[] };
      const valueContainsLatestItem = value[0]?.id === latestItem.current; // since_id might not be supported
      if (value?.length && !valueContainsLatestItem) {
        value = filteredItems(value, 'public') as HashtagStatus[];
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const reachLimit = hashtags.length >= TOTAL_TAGS_LIMIT;

  return (
    <>
      <Timeline
        key={instance + hashtagTitle}
        title={title}
        titleComponent={
          !!instance && (
            <h1 className="header-double-lines">
              <b dir="auto">{hashtagTitle}</b>
              <div>{instance}</div>
            </h1>
          )
        }
        id="hashtag"
        timelineKey={`hashtag-${instance || ''}-${hashtagTitle}-${
          media ? 'media' : 'all'
        }`}
        instance={instance}
        emptyText={t`No one has posted anything with this tag yet.`}
        errorText={t`Unable to load posts with this tag`}
        fetchItems={fetchHashtags}
        checkForUpdates={checkForUpdates}
        useItemID
        view={media || mediaFirst ? 'media' : undefined}
        refresh={media}
        // allowFilters
        filterContext="public"
        headerEnd={
          <Menu2
            portal
            setDownOverflow
            overflow="auto"
            // viewScroll="close"
            position="anchor"
            menuButton={
              <button type="button" className="plain">
                <Icon icon="more" size="l" alt={t`More`} />
              </button>
            }
          >
            {!mediaFirst && (
              <>
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
              </>
            )}
            <FocusableItem className="menu-field" disabled={reachLimit}>
              {({ ref }: { ref: React.Ref<HTMLInputElement> }) => (
                <form
                  onSubmit={(e: SyntheticEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.item(
                      0,
                    ) as HTMLInputElement | null;
                    const newHashtag = input?.value.trim();
                    // Use includes but need to be case insensitive
                    if (
                      newHashtag &&
                      !hashtags.some(
                        (h) => h.toLowerCase() === newHashtag.toLowerCase(),
                      )
                    ) {
                      hashtags.push(newHashtag);
                      hashtags.sort();
                      // navigate(
                      //   instance
                      //     ? `/${instance}/t/${hashtags.join('+')}`
                      //     : `/t/${hashtags.join('+')}`,
                      // );
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
                    // no spaces, no hashtags
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
                    // navigate(
                    //   instance
                    //     ? `/${instance}/t/${hashtags.join('+')}`
                    //     : `/t/${hashtags.join('+')}`,
                    // );
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
              disabled={!currentAuthenticated}
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
                // Check if already exists
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

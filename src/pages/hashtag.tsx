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
import type { ComponentType } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useParams, useSearchParams } from 'react-router-dom';

import Icon from '../components/icon';
import MenuConfirm from '../components/menu-confirm';
import Menu2 from '../components/menu2';
import { SHORTCUTS_LIMIT } from '../components/shortcuts-settings';
import TimelineUntyped from '../components/timeline';
import { api } from '../utils/api';
import { filteredItems } from '../utils/filters';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';
import { isMediaFirstInstance } from '../utils/store-utils';
import { checkTimelineAccess } from '../utils/timeline-access';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

// Limit is 4 per "mode"
// https://github.com/mastodon/mastodon/issues/15194
// Hard-coded https://github.com/mastodon/mastodon/blob/19614ba2477f3d12468f5ec251ce1cc5f8c6210c/app/models/tag_feed.rb#L4
const TAGS_LIMIT_PER_MODE = 4;
const TOTAL_TAGS_LIMIT = TAGS_LIMIT_PER_MODE + 1;

type HashtagStatus = mastodon.v1.Status;

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

interface HashtagInfo {
  name: string;
  following?: boolean;
  [key: string]: unknown;
}

interface FeaturedTag {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface TagsApi {
  $select(hashtag: string): {
    fetch(): Promise<HashtagInfo>;
    follow(): Promise<unknown>;
    unfollow(): Promise<unknown>;
  };
}

interface FeaturedTagsApi {
  list(): Promise<FeaturedTag[]>;
  create(params: { name: string }): Promise<FeaturedTag>;
  $select(id: string): {
    remove(): Promise<unknown>;
  };
}

interface TimelineProps {
  key?: string;
  title?: string;
  titleComponent?: preact.ComponentChildren;
  id?: string;
  timelineKey?: string;
  instance?: string;
  emptyText?: string;
  errorText?: string;
  fetchItems?: (firstLoad?: boolean) => Promise<FetchHashtagsResult>;
  checkForUpdates?: () => Promise<boolean>;
  useItemID?: boolean;
  view?: string;
  refresh?: unknown;
  filterContext?: string;
  headerEnd?: preact.ComponentChildren;
}

const Timeline = TimelineUntyped as unknown as ComponentType<TimelineProps>;

type TimelineAccess = string | null;

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
  const hashtags = (rawHashtag as string).trim().split(/[\s+]+/).toSorted();
  const hashtag: string = hashtags[0];
  const [searchParams, setSearchParams] = useSearchParams();
  const media = mediaView || !!searchParams.get('media');
  const linkParams = media ? '?media=1' : '';

  const { masto, instance, authenticated } = api({
    instance: props?.instance || params.instance,
  });
  const {
    instance: currentInstance,
    authenticated: currentAuthenticated,
  } = api();
  const hashtagTitle = hashtags.map((tag) => `#${tag}`).join(' ');
  const title = instance
    ? media
      ? t`${hashtagTitle} (Media only) on ${instance}`
      : t`${hashtagTitle} on ${instance}`
    : media
      ? t`${hashtagTitle} (Media only)`
      : t`${hashtagTitle}`;
  useTitle(title, `/:instance?/t/:hashtag`);
  const latestItem = useRef<string | undefined>();

  const mediaFirst = useMemo(() => isMediaFirstInstance(), []);

  // Timeline access: public, authenticated, disabled
  const [timelineAccess, setTimelineAccess] = useState<TimelineAccess>(null);
  const isDisabled = timelineAccess === 'disabled';
  const requiresAuth = timelineAccess === 'authenticated';
  const isPrivate = requiresAuth && !authenticated;

  const tagTimelines = (
    masto.v1 as unknown as { timelines: { tag: HashtagTimelineEndpoint } }
  ).timelines.tag;
  const tagsApi = masto.v1.tags as TagsApi;
  const featuredTagsApi = masto.v1.featuredTags as FeaturedTagsApi;

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
    const access = await checkTimelineAccess({
      feed: 'hashtagFeeds',
      feedType: 'local',
      instance,
    });
    setTimelineAccess(access as TimelineAccess);
    if (
      access === 'disabled' ||
      (access === 'authenticated' && !authenticated)
    ) {
      return {
        done: true,
        value: [],
      };
    }

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
        saveStatus(
          item as unknown as Parameters<typeof saveStatus>[0],
          instance,
          {
            skipThreading: media || mediaFirst, // If media view, no need to form threads
          },
        );
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

  const [followUIState, setFollowUIState] = useState('default');
  const [info, setInfo] = useState<HashtagInfo | undefined>();
  // Get hashtag info
  // NOTE: deliberately omits `tagsApi` from deps. `masto.v1.tags` is a proxy
  // recreated on every property access, so including it would refetch every
  // render. The proxy delegates to a stable underlying client, so capturing
  // the reference once per `hashtag` change is fine.
  useEffect(() => {
    void (async () => {
      try {
        const fetchedInfo = await tagsApi.$select(hashtag).fetch();
        console.log(fetchedInfo);
        setInfo(fetchedInfo);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [hashtag]);

  const reachLimit = hashtags.length >= TOTAL_TAGS_LIMIT;

  const [featuredUIState, setFeaturedUIState] = useState('default');
  const [featuredTags, setFeaturedTags] = useState<FeaturedTag[]>([]);
  const [isFeaturedTag, setIsFeaturedTag] = useState(false);
  // NOTE: deliberately omits `featuredTagsApi` from deps. `masto.v1.featuredTags`
  // is a proxy recreated on every property access; including it would loop.
  useEffect(() => {
    if (!authenticated) return;
    void (async () => {
      try {
        const fetchedFeaturedTags = await featuredTagsApi.list();
        setFeaturedTags(fetchedFeaturedTags);
        setIsFeaturedTag(
          fetchedFeaturedTags.some(
            (tag) => tag.name.toLowerCase() === hashtag.toLowerCase(),
          ),
        );
      } catch (e) {
        console.error(e);
      }
    })();
  }, [authenticated, hashtag]);

  return (
    <>
      <Timeline
        key={instance + hashtagTitle}
        title={title}
        titleComponent={
          !!instance && (
            <h1 class="header-double-lines">
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
        emptyText={
          isDisabled
            ? t`This timeline is disabled on this server.`
            : isPrivate
              ? t`Login required to see posts from this server.`
              : t`No one has posted anything with this tag yet.`
        }
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
              <button type="button" class="plain">
                <Icon icon="more" size="l" alt={t`More`} />
              </button>
            }
          >
            {!!info && hashtags.length === 1 && (
              <>
                <MenuConfirm
                  subMenu
                  confirm={info.following}
                  confirmLabel={t`Unfollow #${hashtag}?`}
                  disabled={followUIState === 'loading' || !authenticated}
                  onClick={() => {
                    setFollowUIState('loading');
                    if (info.following) {
                      // const yes = confirm(`Unfollow #${hashtag}?`);
                      // if (!yes) {
                      //   setFollowUIState('default');
                      //   return;
                      // }
                      void tagsApi
                        .$select(hashtag)
                        .unfollow()
                        .then(() => {
                          setInfo({ ...info, following: false });
                          showToast(t`Unfollowed #${hashtag}`);
                          return undefined;
                        })
                        .catch((e) => {
                          alert(e);
                          console.error(e);
                        })
                        .finally(() => {
                          setFollowUIState('default');
                        });
                    } else {
                      void tagsApi
                        .$select(hashtag)
                        .follow()
                        .then(() => {
                          setInfo({ ...info, following: true });
                          showToast(t`Followed #${hashtag}`);
                          return undefined;
                        })
                        .catch((e) => {
                          alert(e);
                          console.error(e);
                        })
                        .finally(() => {
                          setFollowUIState('default');
                        });
                    }
                  }}
                >
                  {info.following ? (
                    <>
                      <Icon icon="check-circle" />{' '}
                      <span>
                        <Trans>Following…</Trans>
                      </span>
                    </>
                  ) : (
                    <>
                      <Icon icon="plus" />{' '}
                      <span>
                        <Trans>Follow</Trans>
                      </span>
                    </>
                  )}
                </MenuConfirm>
                <MenuItem
                  type="checkbox"
                  checked={isFeaturedTag}
                  disabled={featuredUIState === 'loading' || !authenticated}
                  onClick={() => {
                    setFeaturedUIState('loading');
                    if (isFeaturedTag) {
                      const featuredTagID = (
                        featuredTags.find(
                          (tag) =>
                            tag.name.toLowerCase() === hashtag.toLowerCase(),
                        ) as FeaturedTag
                      ).id;
                      if (featuredTagID) {
                        void featuredTagsApi
                          .$select(featuredTagID)
                          .remove()
                          .then(() => {
                            setIsFeaturedTag(false);
                            showToast(t`Unfeatured on profile`);
                            setFeaturedTags(
                              featuredTags.filter(
                                (tag) => tag.id !== featuredTagID,
                              ),
                            );
                            return undefined;
                          })
                          .catch((e) => {
                            console.error(e);
                          })
                          .finally(() => {
                            setFeaturedUIState('default');
                          });
                      } else {
                        showToast(t`Unable to unfeature on profile`);
                      }
                    } else {
                      void featuredTagsApi
                        .create({
                          name: hashtag,
                        })
                        .then((value) => {
                          setIsFeaturedTag(true);
                          showToast(t`Featured on profile`);
                          setFeaturedTags(featuredTags.concat(value));
                          return undefined;
                        })
                        .catch((e) => {
                          console.error(e);
                        })
                        .finally(() => {
                          setFeaturedUIState('default');
                        });
                    }
                  }}
                >
                  {isFeaturedTag ? (
                    <>
                      <Icon icon="check-circle" />
                      <span>
                        <Trans>Featured on profile</Trans>
                      </span>
                    </>
                  ) : (
                    <>
                      <Icon icon="check-circle" />
                      <span>
                        <Trans>Feature on profile</Trans>
                      </span>
                    </>
                  )}
                </MenuItem>
                <MenuDivider />
              </>
            )}
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
                  <span class="menu-grow">
                    <Trans>Media only</Trans>
                  </span>
                </MenuItem>
                <MenuDivider />
              </>
            )}
            <FocusableItem className="menu-field" disabled={reachLimit}>
              {({ ref }: { ref: preact.Ref<HTMLInputElement> }) => (
                <form
                  onSubmit={(e: Event) => {
                    e.preventDefault();
                    const target = e.target as unknown as Array<{
                      value?: { trim?: () => string };
                    }>;
                    const newHashtag = target[0].value?.trim?.();
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
                      location.hash = instance
                        ? `/${instance}/t/${hashtags.join('+')}${linkParams}`
                        : `/t/${hashtags.join('+')}${linkParams}`;
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
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck={false}
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
                    location.hash = instance
                      ? `/${instance}/t/${hashtags.join('+')}${linkParams}`
                      : `/t/${hashtags.join('+')}${linkParams}`;
                  }}
                >
                  <Icon icon="x" alt={t`Remove hashtag`} class="danger-icon" />
                  <span class="bidi-isolate">
                    <span class="more-insignificant">#</span>
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
                    s.hashtag
                      .split(/[\s+]+/)
                      .toSorted()
                      .join(' ') ===
                      shortcut.hashtag
                        .split(/[\s+]+/)
                        .toSorted()
                        .join(' ') &&
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
            <MenuItem
              onClick={() => {
                let newInstance = prompt(
                  t`Enter a new server e.g. "mastodon.social"`,
                );
                if (!/\./.test(newInstance as string)) {
                  if (newInstance) alert(t`Invalid server`);
                  return;
                }
                if (newInstance) {
                  newInstance = newInstance.toLowerCase().trim();
                  // navigate(`/${newInstance}/t/${hashtags.join('+')}`);
                  location.hash = `/${newInstance}/t/${hashtags.join(
                    '+',
                  )}${linkParams}`;
                }
              }}
            >
              <Icon icon="bus" />{' '}
              <span>
                <Trans>Go to another server…</Trans>
              </span>
            </MenuItem>
            {currentInstance !== instance && (
              <MenuItem
                onClick={() => {
                  location.hash = `/${currentInstance}/t/${hashtags.join(
                    '+',
                  )}${linkParams}`;
                }}
              >
                <Icon icon="bus" />{' '}
                <small class="menu-double-lines">
                  <Trans>
                    Go to my server (<b>{currentInstance}</b>)
                  </Trans>
                </small>
              </MenuItem>
            )}
          </Menu2>
        }
      />
      {!columnMode && !!hashtags?.length && (
        <data
          class="compose-data"
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

import './settings.css';

import '../components/button-install';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { HTMLAttributes, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { useSnapshot } from 'valtio';

import logo from '../assets/logo.svg';

import Icon from '../components/icon';
import LangSelector from '../components/lang-selector';
import Link from '../components/link';
import RelativeTime from '../components/relative-time';
import languages from '../data/translang-languages.json';
import {
  api,
  getCompatV1Resource,
  getPreferences,
  setPreferences,
} from '../utils/api';
import { APPVIEW_OPTIONS, getActiveAppview } from '../utils/atproto-adapter';
import getTranslateTargetLanguage from '../utils/get-translate-target-language';
import localeCode2Text from '../utils/localeCode2Text';
import { isMutedPostVisibility } from '../utils/muted-post-visibility';
import prettyBytes from '../utils/pretty-bytes';
import { supportsNativeQuote } from '../utils/quote-utils';
import showToast from '../utils/show-toast';
import states from '../utils/states';
import store from '../utils/store';

// `button-install` is a custom element registered in
// `../components/button-install`. Declare its JSX shape so the wrapper below
// type-checks without touching the existing untyped runtime behavior.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'button-install': HTMLAttributes<HTMLElement>;
    }
  }
}

// `compat.v1.accounts` in the typed api.ts shim only exposes
// `verifyCredentials`. `updateCredentials` is used here at runtime to sync
// posting preferences. Shim the call surface locally; the wave that fully
// types the compat client removes this.
interface AccountsUpdateCredentialsClient {
  updateCredentials(params: {
    source: { privacy?: string; quote_policy?: string };
  }): Promise<unknown>;
}

type Preferences = Record<string, unknown>;

const DEFAULT_TEXT_SIZE = 16;
const TEXT_SIZES = [14, 15, 16, 17, 18, 19, 20];
const SMALLEST_TEXT_SIZE = TEXT_SIZES[0];
const LARGEST_TEXT_SIZE = TEXT_SIZES[TEXT_SIZES.length - 1];
const {
  PHANPY_WEBSITE: WEBSITE,
  PHANPY_PRIVACY_POLICY_URL: PRIVACY_POLICY_URL,
  PHANPY_TRANSLANG_INSTANCES: TRANSLANG_INSTANCES,
  PHANPY_IMG_ALT_API_URL: IMG_ALT_API_URL,
  PHANPY_GIPHY_API_KEY: GIPHY_API_KEY,
  PHANPY_CLIENT_NAME: CLIENT_NAME,
} = import.meta.env;

const targetLanguages = Object.entries(
  (languages as { tl: Record<string, string> }).tl,
).map(([code, name]) => ({
  code,
  name,
}));

const TRANSLATION_API_NAME = 'TransLang API';

interface SettingsProps {
  onClose?: () => void;
}

function Settings({ onClose }: SettingsProps): ReactElement {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const currentTheme = store.local.get('theme') || 'auto';
  const themeFormRef = useRef<HTMLFormElement | null>(null);
  const targetLanguage =
    snapStates.settings.contentTranslationTargetLanguage || null;
  const systemTargetLanguage = getTranslateTargetLanguage();
  const systemTargetLanguageText = systemTargetLanguage
    ? localeCode2Text(systemTargetLanguage)
    : undefined;
  // `textSize` is written via `localStorage.setItem`, which stringifies values
  // on store. Normalize back to number on read so arithmetic (`size - 1`,
  // `Math.min(..., size + 1)`) doesn't string-concatenate.
  const storedTextSize = store.local.get('textSize');
  const currentTextSize: number =
    parseInt(storedTextSize as string, 10) || DEFAULT_TEXT_SIZE;

  const [prefs, setPrefs] = useState<Preferences>(getPreferences());
  const { compat, authenticated } = api();

  // Get preferences every time Settings is opened
  // NOTE: Disabled for now because I don't expect this to change often. Also for some reason, the /api/v1/preferences endpoint is cached for a while and return old prefs if refresh immediately after changing them.
  // useEffect(() => {
  //   const { compat } = api();
  //   (async () => {
  //     try {
  //       const preferences = await compat.v1.preferences.fetch();
  //       setPrefs(preferences);
  //       store.account.set('preferences', preferences);
  //     } catch (e) {
  //       // Silently fail
  //       console.error(e);
  //     }
  //   })();
  // }, []);

  const [expTabBarV2, setExpTabBarV2] = useState<string | boolean>(
    store.local.get('experiments-tabBarV2') ?? false,
  );

  const [expTimeline2, setExpTimeline2] = useState<string | boolean>(
    store.local.get('experiments-timeline2') ?? false,
  );

  const disableQuotePolicy = prefs['posting:default:visibility'] === 'private';

  return (
    <div
      id="settings-container"
      className="sheet"
      tabIndex={-1}
      style={{
        '--current-text-size': `${currentTextSize}px`,
      }}
    >
      {!!onClose && (
        <button type="button" className="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Settings</Trans>
        </h2>
      </header>
      <main>
        <section>
          <ul>
            <li>
              <div>
                {/* TODO(oxlint:jsx-a11y/label-has-associated-control): visual
                    section heading; not a form control label. The form below
                    has no single primary input for htmlFor. Keeping <label>
                    for the styling hook in settings.css. */}
                <span className="settings-section-label">
                  <Trans>Appearance</Trans>
                </span>
              </div>
              <div>
                <form
                  ref={themeFormRef}
                  onInput={(e) => {
                    console.log(e);
                    e.preventDefault();
                    const form = themeFormRef.current;
                    if (!form) return;
                    const formData = new FormData(form);
                    const theme = formData.get('theme') as string | null;
                    const html = document.documentElement;

                    if (theme === 'auto') {
                      html.classList.remove('is-light', 'is-dark');

                      // Disable manual theme <meta>
                      const $manualMeta =
                        document.querySelector<HTMLMetaElement>(
                          'meta[data-theme-setting="manual"]',
                        );
                      if ($manualMeta) {
                        $manualMeta.name = '';
                      }
                      // Enable auto theme <meta>s
                      const $autoMetas =
                        document.querySelectorAll<HTMLMetaElement>(
                          'meta[data-theme-setting="auto"]',
                        );
                      $autoMetas.forEach((m) => {
                        m.name = 'theme-color';
                      });
                    } else {
                      html.classList.toggle('is-light', theme === 'light');
                      html.classList.toggle('is-dark', theme === 'dark');

                      // Enable manual theme <meta>
                      const $manualMeta =
                        document.querySelector<HTMLMetaElement>(
                          'meta[data-theme-setting="manual"]',
                        );
                      if ($manualMeta) {
                        $manualMeta.name = 'theme-color';
                        $manualMeta.content =
                          theme === 'light'
                            ? String($manualMeta.dataset.themeLightColor)
                            : String($manualMeta.dataset.themeDarkColor);
                      }
                      // Disable auto theme <meta>s
                      const $autoMetas =
                        document.querySelectorAll<HTMLMetaElement>(
                          'meta[data-theme-setting="auto"]',
                        );
                      $autoMetas.forEach((m) => {
                        m.name = '';
                      });
                    }
                    const $colorScheme = document.querySelector(
                      'meta[name="color-scheme"]',
                    );
                    $colorScheme?.setAttribute(
                      'content',
                      theme === 'auto' ? 'light dark' : (theme as string),
                    );

                    if (theme === 'auto') {
                      store.local.del('theme');
                    } else {
                      store.local.set('theme', theme as string);
                    }
                  }}
                >
                  {/* TODO(oxlint:jsx-a11y/label-has-associated-control): radio
                      labels wrap their <input> and contain <Trans> text inside
                      a <span>; the rule's static analysis doesn't see <Trans>
                      output as accessible text, but it renders to a string. */}
                  <div className="radio-group">
                    <label>
                      <input
                        type="radio"
                        name="theme"
                        value="light"
                        aria-label={t`Light`}
                        defaultChecked={currentTheme === 'light'}
                      />
                      <span>
                        <Trans>Light</Trans>
                      </span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="theme"
                        value="dark"
                        aria-label={t`Dark`}
                        defaultChecked={currentTheme === 'dark'}
                      />
                      <span>
                        <Trans>Dark</Trans>
                      </span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="theme"
                        value="auto"
                        aria-label={t`Auto`}
                        defaultChecked={
                          currentTheme !== 'light' && currentTheme !== 'dark'
                        }
                      />
                      <span>
                        <Trans>Auto</Trans>
                      </span>
                    </label>
                  </div>
                </form>
              </div>
            </li>
            <li>
              <div>
                {/* TODO(oxlint:jsx-a11y/label-has-associated-control): visual
                    section heading for a multi-button control. */}
                <span className="settings-section-label">
                  <Trans>Text size</Trans>
                </span>
              </div>
              <TextSizeControl currentTextSize={currentTextSize} />
            </li>
            <li>
              <span>
                {/* TODO(oxlint:jsx-a11y/label-has-associated-control): visual
                    label sibling to <LangSelector />'s internal <select>; no
                    stable id to point htmlFor at. */}
                <span className="settings-section-label">
                  <Trans>Display language</Trans>
                </span>{' '}
                <small>
                  <a
                    href="https://crowdin.com/project/phanpy"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Trans>Volunteer translations</Trans>
                  </a>
                </small>
              </span>
              <LangSelector />
            </li>
          </ul>
        </section>
        {authenticated && (
          <>
            <h3>
              <Trans>Posting</Trans>
            </h3>
            <section>
              <ul>
                <li>
                  <label htmlFor="posting-privacy-field">
                    <Trans>Default visibility</Trans>{' '}
                    <Icon
                      icon="cloud"
                      alt={t`Synced`}
                      className="synced-icon"
                    />
                  </label>
                  <select
                    aria-label="Default visibility"
                    id="posting-privacy-field"
                    value={
                      (prefs['posting:default:visibility'] as
                        | string
                        | undefined) || 'public'
                    }
                    onChange={(e) => {
                      const { value } = e.currentTarget;
                      void (async () => {
                        try {
                          await getCompatV1Resource<AccountsUpdateCredentialsClient>(
                            compat,
                            'accounts',
                          ).updateCredentials({
                            source: {
                              privacy: value,
                            },
                          });
                          const newPrefs: Preferences = {
                            ...prefs,
                            'posting:default:visibility': value,
                          };
                          if (value === 'private') {
                            newPrefs['posting:default:quote_policy'] = 'nobody';
                          }
                          setPrefs(newPrefs);
                          setPreferences(newPrefs);
                          showToast(t`Default visibility updated`);
                        } catch (err) {
                          alert(t`Failed to update default visibility`);
                          console.error(err);
                        }
                      })();
                    }}
                  >
                    <option value="public">
                      <Trans>Public</Trans>
                    </option>
                    <option value="unlisted">
                      <Trans>Quiet public</Trans>
                    </option>
                    <option value="private">
                      <Trans>Followers</Trans>
                    </option>
                  </select>
                </li>
                {supportsNativeQuote() && (
                  <li>
                    <label htmlFor="posting-quote-policy-field">
                      <Trans>Quote settings</Trans>{' '}
                      <Icon
                        icon="cloud"
                        alt={t`Synced`}
                        className="synced-icon"
                      />
                    </label>
                    <select
                      aria-label="Quote settings"
                      id="posting-quote-policy-field"
                      value={
                        disableQuotePolicy
                          ? 'nobody'
                          : (prefs['posting:default:quote_policy'] as
                              | string
                              | undefined) || 'public'
                      }
                      disabled={disableQuotePolicy}
                      onChange={(e) => {
                        const { value } = e.currentTarget;
                        void (async () => {
                          try {
                            await getCompatV1Resource<AccountsUpdateCredentialsClient>(
                              compat,
                              'accounts',
                            ).updateCredentials({
                              source: {
                                quote_policy: value,
                              },
                            });
                            const newPrefs: Preferences = {
                              ...prefs,
                              'posting:default:quote_policy': value,
                            };
                            setPrefs(newPrefs);
                            setPreferences(newPrefs);
                            showToast(t`Quote settings updated`);
                          } catch (err) {
                            alert(t`Failed to update quote settings`);
                            console.error(err);
                          }
                        })();
                      }}
                    >
                      <option value="public" disabled={disableQuotePolicy}>
                        <Trans>Anyone can quote</Trans>
                      </option>
                      <option value="followers" disabled={disableQuotePolicy}>
                        <Trans>Your followers can quote</Trans>
                      </option>
                      <option value="nobody">
                        <Trans>Only you can quote</Trans>
                      </option>
                    </select>
                  </li>
                )}
              </ul>
            </section>
            <p className="section-postnote">
              <Icon icon="cloud" alt={t`Synced`} className="synced-icon" />{' '}
              <small>
                {(() => {
                  const activeAppview = getActiveAppview();
                  const appviewLabel =
                    APPVIEW_OPTIONS[activeAppview]?.label ?? 'Bluesky';
                  const settingsURL =
                    activeAppview === 'blacksky'
                      ? 'https://blacksky.community/settings'
                      : 'https://bsky.app/settings';
                  return (
                    <Trans>
                      Synced to your {appviewLabel} account settings.{' '}
                      <a
                        href={settingsURL}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open {appviewLabel} settings.
                      </a>
                    </Trans>
                  );
                })()}
              </small>
            </p>
          </>
        )}
        <h3>
          <Trans>Experiments</Trans>
        </h3>
        <section>
          <ul>
            <li className="block">
              <label>
                <input
                  aria-label="Auto refresh timeline posts"
                  type="checkbox"
                  checked={snapStates.settings.autoRefresh}
                  onChange={(e) => {
                    states.settings.autoRefresh = e.currentTarget.checked;
                  }}
                />{' '}
                <Trans>Auto refresh timeline posts</Trans>
              </label>
            </li>
            <li className="block">
              <label>
                <input
                  aria-label="Reposts carousel"
                  type="checkbox"
                  checked={snapStates.settings.boostsCarousel}
                  onChange={(e) => {
                    states.settings.boostsCarousel = e.currentTarget.checked;
                  }}
                />{' '}
                <Trans>Reposts carousel</Trans>
              </label>
            </li>
            <li className="block">
              <label>
                <Trans>Muted posts</Trans>{' '}
                <select
                  aria-label="Muted posts visibility"
                  value={snapStates.settings.mutedPostVisibility}
                  onChange={(e) => {
                    const visibility = e.currentTarget.value;
                    if (isMutedPostVisibility(visibility)) {
                      states.settings.mutedPostVisibility = visibility;
                    }
                  }}
                >
                  <option value="hide">
                    <Trans>Hide entirely</Trans>
                  </option>
                  <option value="collapse">
                    <Trans>Collapse with reveal</Trans>
                  </option>
                  <option value="show">
                    <Trans>Show normally</Trans>
                  </option>
                </select>
              </label>
              <div className="sub-section insignificant">
                <small>
                  <Trans>
                    Notifications from muted accounts are always hidden.
                  </Trans>
                </small>
              </div>
            </li>
            {!!TRANSLANG_INSTANCES && (
              <li className="block">
                <label>
                  <input
                    aria-label="Post translation"
                    type="checkbox"
                    checked={snapStates.settings.contentTranslation}
                    onChange={(e) => {
                      const { checked } = e.currentTarget;
                      states.settings.contentTranslation = checked;
                      if (!checked) {
                        states.settings.contentTranslationTargetLanguage = null;
                      }
                    }}
                  />{' '}
                  <Trans>Post translation</Trans>
                </label>
                <div
                  className={`sub-section ${
                    !snapStates.settings.contentTranslation
                      ? 'more-insignificant'
                      : ''
                  }`}
                >
                  <div>
                    <label>
                      <Trans>Translate to </Trans>{' '}
                      <select
                        value={targetLanguage || ''}
                        disabled={!snapStates.settings.contentTranslation}
                        style={{ width: '10em' }}
                        onChange={(e) => {
                          states.settings.contentTranslationTargetLanguage =
                            e.currentTarget.value || null;
                        }}
                      >
                        <option value="">
                          <Trans>
                            System language ({systemTargetLanguageText})
                          </Trans>
                        </option>
                        <option disabled>──────────</option>
                        {targetLanguages.map((lang) => {
                          const common = localeCode2Text({
                            code: lang.code,
                            fallback: lang.name,
                          });
                          const native = localeCode2Text({
                            code: lang.code,
                            locale: lang.code,
                          });
                          const showCommon = native && common !== native;
                          return (
                            <option key={lang.code} value={lang.code}>
                              {showCommon ? `${native} - ${common}` : common}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>
                  <hr />
                  <div className="checkbox-fieldset">
                    <Plural
                      value={
                        snapStates.settings.contentTranslationHideLanguages
                          .length
                      }
                      _0={`Hide "Translate" button for:`}
                      other={`Hide "Translate" button for (#):`}
                    />
                    <div className="checkbox-fields">
                      {targetLanguages.map((lang) => {
                        const common = localeCode2Text({
                          code: lang.code,
                          fallback: lang.name,
                        });
                        const native = localeCode2Text({
                          code: lang.code,
                          locale: lang.code,
                        });
                        const showCommon = native && common !== native;
                        return (
                          <label key={lang.code}>
                            <input
                              aria-label="Hide translate button for language"
                              type="checkbox"
                              checked={snapStates.settings.contentTranslationHideLanguages.includes(
                                lang.code,
                              )}
                              onChange={(e) => {
                                const { checked } = e.currentTarget;
                                if (checked) {
                                  states.settings.contentTranslationHideLanguages.push(
                                    lang.code,
                                  );
                                } else {
                                  states.settings.contentTranslationHideLanguages =
                                    snapStates.settings.contentTranslationHideLanguages.filter(
                                      (code) => code !== lang.code,
                                    );
                                }
                              }}
                            />{' '}
                            {showCommon ? (
                              <span>
                                {native}{' '}
                                <span className="insignificant ib">
                                  - {common}
                                </span>
                              </span>
                            ) : (
                              common
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <p className="insignificant">
                    <small>
                      <Trans>
                        Note: This feature uses external translation services,
                        powered by{' '}
                        <a
                          href="https://github.com/cheeaun/translang-api"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {TRANSLATION_API_NAME}
                        </a>
                        .
                      </Trans>
                    </small>
                  </p>
                  <hr />
                  <div>
                    <label>
                      <input
                        aria-label="Auto inline translation"
                        type="checkbox"
                        checked={
                          snapStates.settings.contentTranslationAutoInline
                        }
                        disabled={!snapStates.settings.contentTranslation}
                        onChange={(e) => {
                          states.settings.contentTranslationAutoInline =
                            e.currentTarget.checked;
                        }}
                      />{' '}
                      <Trans>Auto inline translation</Trans>
                    </label>
                    <p className="insignificant">
                      <small>
                        <Trans>
                          Automatically show translation for posts in timeline.
                          Only works for <b>short</b> posts without content
                          warning, media and poll.
                        </Trans>
                      </small>
                    </p>
                  </div>
                </div>
              </li>
            )}
            {authenticated && (
              <li className="block">
                <label>
                  <input
                    aria-label="Paginated timeline"
                    type="checkbox"
                    checked={!!expTimeline2}
                    onChange={(e) => {
                      const { checked } = e.currentTarget;
                      setExpTimeline2(checked);
                      if (checked) {
                        store.local.set('experiments-timeline2', 'true');
                      } else {
                        store.local.del('experiments-timeline2');
                      }
                    }}
                  />{' '}
                  <Trans>Paginated timeline (beta)</Trans>
                </label>
                <div className="sub-section insignificant">
                  <small>
                    <Trans>
                      Manual pagination of timeline posts instead of infinite
                      scrolling. Only works for Home/Following timeline for now.
                      Auto refresh and reposts carousel will not work when this
                      is enabled.
                    </Trans>
                  </small>
                </div>
              </li>
            )}
            {!!GIPHY_API_KEY && authenticated && (
              <li className="block">
                <label>
                  <input
                    aria-label="GIF picker for composer"
                    type="checkbox"
                    checked={snapStates.settings.composerGIFPicker}
                    onChange={(e) => {
                      states.settings.composerGIFPicker =
                        e.currentTarget.checked;
                    }}
                  />{' '}
                  <Trans>GIF Picker for composer</Trans>
                </label>
                <div className="sub-section insignificant">
                  <small>
                    <Trans>
                      Note: This feature uses external GIF search service,
                      powered by{' '}
                      <a
                        href="https://developers.giphy.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GIPHY
                      </a>
                      . G-rated (suitable for viewing by all ages), tracking
                      parameters are stripped, referrer information is omitted
                      from requests, but search queries and IP address
                      information will still reach their servers.
                    </Trans>
                  </small>
                </div>
              </li>
            )}
            {!!IMG_ALT_API_URL && authenticated && (
              <li className="block">
                <label>
                  <input
                    aria-label="Image description generator"
                    type="checkbox"
                    checked={snapStates.settings.mediaAltGenerator}
                    onChange={(e) => {
                      states.settings.mediaAltGenerator =
                        e.currentTarget.checked;
                    }}
                  />{' '}
                  <Trans>Image description generator</Trans>{' '}
                  <Icon icon="sparkles2" className="more-insignificant" />
                </label>
                <div className="sub-section insignificant">
                  <small>
                    <Trans>
                      Only for new images while composing new posts.
                    </Trans>
                  </small>
                </div>
                <div className="sub-section insignificant">
                  <small>
                    <Trans>
                      Note: This feature uses external AI service, powered by{' '}
                      <a
                        href="https://github.com/cheeaun/img-alt-api"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        img-alt-api
                      </a>
                      . May not work well. Only for images and in English.
                    </Trans>
                  </small>
                </div>
              </li>
            )}
            <li className="block">
              <label>
                <input
                  aria-label="Cloak mode"
                  type="checkbox"
                  checked={snapStates.settings.cloakMode}
                  onChange={(e) => {
                    states.settings.cloakMode = e.currentTarget.checked;
                  }}
                />{' '}
                <Trans>
                  Cloak mode{' '}
                  <span className="insignificant">
                    (<samp>Text</samp> → <samp>████</samp>)
                  </span>
                </Trans>
              </label>
              <div className="sub-section insignificant">
                <small>
                  <Trans>
                    Replace text as blocks, useful when taking screenshots, for
                    privacy reasons.
                  </Trans>
                </small>
              </div>
            </li>
            <li className="block">
              <label>
                <input
                  aria-label="Disable all animations"
                  type="checkbox"
                  checked={snapStates.settings.noAnimations}
                  onChange={(e) => {
                    states.settings.noAnimations = e.currentTarget.checked;
                  }}
                />{' '}
                <Trans>Disable all animations</Trans>
              </label>
              <div className="sub-section insignificant">
                <small>
                  <Trans>
                    Removes all UI animations, transitions, and smooth
                    scrolling. Useful if motion is distracting.
                  </Trans>
                </small>
              </div>
            </li>
            {authenticated && (
              <li>
                <button
                  type="button"
                  className="light"
                  onClick={() => {
                    states.showDrafts = true;
                    states.showSettings = false;
                  }}
                >
                  <Trans>Unsent drafts</Trans>
                </button>
              </li>
            )}
            <li>
              <Link to="/yip" onClick={onClose} className="button light">
                Year in Posts
              </Link>
            </li>
            <li>
              <button-install>
                <button type="button" className="light">
                  <Trans>Install {CLIENT_NAME}</Trans>
                </button>
              </button-install>
            </li>
          </ul>
        </section>
        <h3>
          <Trans>About</Trans>
        </h3>
        <section>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              lineHeight: 1.25,
              alignItems: 'center',
              marginTop: 8,
            }}
          >
            <img
              src={logo}
              alt=""
              width="64"
              height="64"
              style={{
                aspectRatio: '1/1',
                verticalAlign: 'middle',
                background: '#b7cdf9',
                borderRadius: 12,
              }}
            />
            <div>
              <b>Bluepy</b>{' '}
              <a
                href="https://hachyderm.io/@phanpy"
                // target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  states.showAccount = 'phanpy@hachyderm.io';
                }}
              >
                @phanpy
              </a>
              <br />
              <a
                href="https://github.com/cheeaun/phanpy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Built
              </a>{' '}
              by{' '}
              <a
                href="https://github.com/cheeaun"
                target="_blank"
                rel="noopener noreferrer"
              >
                @cheeaun
              </a>
              , forked for ATProto by{' '}
              <a
                href="https://bsky.app/profile/alice.mosphere.at"
                target="_blank"
                rel="noopener noreferrer"
              >
                @alice.mosphere.at
              </a>{' '}
              and{' '}
              <a
                href="https://bsky.app/profile/quillmatiq.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                @quillmatiq.com
              </a>
            </div>
          </div>
          <p>
            <a
              href="https://github.com/sponsors/cheeaun"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Trans>Sponsor</Trans>
            </a>{' '}
            &middot;{' '}
            <a
              href="https://www.buymeacoffee.com/cheeaun"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Trans>Donate</Trans>
            </a>{' '}
            &middot;{' '}
            <a
              href="https://patreon.com/cheeaun"
              target="_blank"
              rel="noopener noreferrer"
            >
              Patreon
            </a>{' '}
            &middot;{' '}
            <a
              href="https://github.com/cheeaun/phanpy/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Trans>What's new</Trans>
            </a>{' '}
            &middot;{' '}
            <a
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Trans>Privacy Policy</Trans>
            </a>
          </p>
          {__COMMIT_TIME__ && (
            <p>
              {WEBSITE && (
                <>
                  <Trans>
                    <span className="insignificant">Site:</span>{' '}
                    {WEBSITE.replace(/https?:\/\//g, '').replace(/\/$/, '')}
                  </Trans>
                  <br />
                </>
              )}
              <Trans>
                <span className="insignificant">Version:</span>{' '}
                <input
                  aria-label="Version string"
                  type="text"
                  className="version-string"
                  readOnly
                  size={18} // Manually calculated here
                  value={`${__COMMIT_TIME__.slice(0, 10).replace(/-/g, '.')}${
                    __COMMIT_HASH__ ? `.${__COMMIT_HASH__}` : ''
                  }`}
                  onClick={(e) => {
                    const target = e.currentTarget;
                    target.select();
                    // Copy to clipboard
                    try {
                      void navigator.clipboard.writeText(target.value);
                      showToast(t`Version string copied`);
                    } catch (err) {
                      console.warn(err);
                      showToast(t`Unable to copy version string`);
                    }
                  }}
                />{' '}
                {!__FAKE_COMMIT_HASH__ && (
                  <span className="ib insignificant">
                    (
                    <a
                      href={`https://github.com/cheeaun/phanpy/commit/${__COMMIT_HASH__}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <RelativeTime datetime={new Date(__BUILD_TIME__)} />
                    </a>
                    )
                  </span>
                )}
              </Trans>
            </p>
          )}
        </section>
        {(import.meta.env.DEV || import.meta.env.PHANPY_DEV) && (
          <details className="debug-info">
            <summary aria-label="Debug info"></summary>
            <p className="side">
              <Link
                to="/_sandbox"
                onClick={onClose}
                className="button plain6 small"
              >
                Sandbox
              </Link>
            </p>
            <p>Debugging</p>
            {(window.__BENCH_RESULTS?.size ?? 0) > 0 && (
              <ul>
                {Array.from(window.__BENCH_RESULTS?.entries() ?? []).map(
                  ([name, duration]) => (
                    <li key={name}>
                      <b>{name}</b>: {duration as number}ms
                    </li>
                  ),
                )}
              </ul>
            )}
            <p>Service Worker Cache</p>
            <button
              type="button"
              className="plain2 small"
              onClick={() => {
                void (async () => {
                  alert(await getCachesKeys());
                })();
              }}
            >
              Show keys count
            </button>{' '}
            <button
              type="button"
              className="plain2 small"
              onClick={() => {
                void (async () => {
                  alert(await getCachesSize());
                })();
              }}
            >
              Show cache size
            </button>{' '}
            <button
              type="button"
              className="plain2 small"
              onClick={() => {
                const key = prompt('Enter cache key');
                if (!key) return;
                try {
                  void clearCacheKey(key);
                } catch (err) {
                  alert(err);
                }
              }}
            >
              Clear cache key
            </button>{' '}
            <button
              type="button"
              className="plain2 small"
              onClick={() => {
                try {
                  void clearCaches();
                } catch (err) {
                  alert(err);
                }
              }}
            >
              Clear all caches
            </button>
            <p>Temporary Experiments</p>
            <label>
              <input
                aria-label="Tab bar v2"
                type="checkbox"
                checked={!!expTabBarV2}
                onChange={(e) => {
                  const { checked } = e.currentTarget;
                  document.body.classList.toggle('exp-tab-bar-v2', checked);
                  setExpTabBarV2(checked);
                  if (checked) {
                    store.local.set('experiments-tabBarV2', 'true');
                  } else {
                    store.local.del('experiments-tabBarV2');
                  }
                }}
              />{' '}
              Tab bar v2
            </label>
          </details>
        )}
      </main>
    </div>
  );
}

interface TextSizeControlProps {
  currentTextSize: number;
}

function TextSizeControl({
  currentTextSize,
}: TextSizeControlProps): ReactElement {
  const textSizeFieldRef = useRef<HTMLInputElement | null>(null);
  const [size, setSize] = useState<number>(currentTextSize);
  const [debouncedSize] = useDebounce(size, 1000);

  useEffect(() => {
    const html = document.documentElement;
    // set CSS variable
    html.style.setProperty('--text-size', `${debouncedSize}px`);
    // save to local storage
    if (debouncedSize === DEFAULT_TEXT_SIZE) {
      store.local.del('textSize');
    } else {
      store.local.set('textSize', String(debouncedSize));
    }
  }, [debouncedSize]);

  return (
    <div
      className={`text-size-control ${size !== debouncedSize ? 'loading' : ''}`}
    >
      <button
        type="button"
        style={{ fontSize: SMALLEST_TEXT_SIZE }}
        className={`small light ${size === DEFAULT_TEXT_SIZE ? 'default-size' : ''}`}
        disabled={size === SMALLEST_TEXT_SIZE}
        onClick={() => {
          setSize(Math.max(SMALLEST_TEXT_SIZE, size - 1));
        }}
      >
        <Trans comment="Preview of one character, in smallest size">A</Trans>
      </button>{' '}
      <input
        aria-label="Text size"
        ref={textSizeFieldRef}
        type="range"
        min={SMALLEST_TEXT_SIZE}
        max={LARGEST_TEXT_SIZE}
        step={1}
        value={size}
        list="sizes"
        onChange={(e) => {
          const value = parseInt(e.currentTarget.value, 10);
          setSize(value);
        }}
      />{' '}
      <button
        type="button"
        style={{ fontSize: LARGEST_TEXT_SIZE }}
        className={`small light ${size === DEFAULT_TEXT_SIZE ? 'default-size' : ''}`}
        disabled={size === LARGEST_TEXT_SIZE}
        onClick={() => {
          setSize(Math.min(LARGEST_TEXT_SIZE, size + 1));
        }}
      >
        <Trans comment="Preview of one character, in largest size">A</Trans>
      </button>
      <datalist id="sizes">
        {TEXT_SIZES.map((s) => (
          <option aria-label="Text size preset" key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

async function getCachesKeys(): Promise<Record<string, number>> {
  const keys = await caches.keys();
  const entries = await Promise.all(
    keys.map(async (key) => {
      const cache = await caches.open(key);
      const k = await cache.keys();
      return [key, k.length] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function getCachesSize(): Promise<Record<string, string>> {
  const keys = await caches.keys();
  const total: Record<string, number> = {};
  let TOTAL = 0;
  await Promise.all(
    keys.map(async (key) => {
      const cache = await caches.open(key);
      const k = await cache.keys();
      const sizes = await Promise.all(
        k.map(async (item) => {
          try {
            const response = await cache.match(item);
            const blob = await response?.blob();
            return blob?.size ?? 0;
          } catch (e) {
            alert(`Failed to get cache size for ${item.url}`);
            alert(e instanceof Error ? e.message : String(e));
            return 0;
          }
        }),
      );
      const keyTotal = sizes.reduce((sum, size) => sum + size, 0);
      total[key] = keyTotal;
      TOTAL += keyTotal;
    }),
  );
  return {
    ...Object.fromEntries(
      Object.entries(total).map(([k, v]) => [k, prettyBytes(v)]),
    ),
    TOTAL: prettyBytes(TOTAL),
  };
}

function clearCacheKey(key: string): Promise<boolean> {
  return caches.delete(key);
}

async function clearCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

export default Settings;

import './report-modal.css';

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { mastodon } from 'masto';
import { Fragment, type ComponentType, type InputHTMLAttributes } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';

import { api } from '../utils/api';
import localeMatch from '../utils/locale-match';
import showToast from '../utils/show-toast';
import { getCurrentInstance } from '../utils/store-utils';

import AccountBlock from './account-block';
import Icon from './icon';
import Loader from './loader';
import StatusUntyped from './status';

function Status(props: {
  status?: unknown;
  size?: string;
  previewMode?: boolean;
  readOnly?: boolean;
  [key: string]: unknown;
}) {
  const Inner = StatusUntyped as unknown as ComponentType<{
  status?: unknown;
  size?: string;
  previewMode?: boolean;
  readOnly?: boolean;
  [key: string]: unknown;
}>;
  return <Inner {...props} />;
}

// NOTE: `dislike` hidden for now, it's actually not used for reporting
// Mastodon shows another screen for unfollowing, muting or blocking instead of reporting

type ReportCategory = 'spam' | 'legal' | 'violation' | 'other';

const CATEGORIES: readonly ReportCategory[] = [
  /*'dislike' ,*/ 'spam',
  'legal',
  'violation',
  'other',
];
// `violation` will be set if there are `rule_ids[]`

interface CategoryInfo {
  label: MessageDescriptor;
  description: MessageDescriptor;
  stampLabel?: MessageDescriptor;
  excludeStamp?: boolean;
}

const CATEGORIES_INFO: Record<ReportCategory, CategoryInfo> = {
  // dislike: {
  //   label: 'Dislike',
  //   description: 'Not something you want to see',
  // },
  spam: {
    label: msg`Spam`,
    description: msg`Malicious links, fake engagement, or repetitive replies`,
  },
  legal: {
    label: msg`Illegal`,
    description: msg`Violates the law of your or the server's country`,
  },
  violation: {
    label: msg`Server rule violation`,
    description: msg`Breaks specific server rules`,
    stampLabel: msg`Violation`,
  },
  other: {
    label: msg`Other`,
    description: msg`Issue doesn't fit other categories`,
    excludeStamp: true,
  },
};

interface InstanceRule {
  id: string;
  text: string;
  translations?: Record<string, { text?: string } | undefined>;
}

interface TranslatedInstanceRule extends InstanceRule {
  _translatedText: string | null;
}

function findMatchingLanguage(
  rule: InstanceRule,
  currentLang: string | null | undefined,
): string | null {
  if (!rule.translations || !currentLang) return null;
  const availableLanguages = Object.keys(rule.translations);
  if (!availableLanguages?.length) return null;

  let matchedLang: string | false = localeMatch(
    [currentLang],
    availableLanguages,
    '',
  );
  if (!matchedLang) {
    // localeMatch fails if there are keys like zhCn, zhTw
    // Convert them something like zh-CN first, try again
    // Detect uppercase, then split by dash
    const normalizedLanguages = availableLanguages.map((lang) => {
      const parts = lang.split(/(?=[A-Z])/);
      return parts
        .map((part, i) => (i === 0 ? part : part.toLowerCase()))
        .join('-');
    });
    matchedLang = localeMatch([currentLang], normalizedLanguages, '');
  }

  // If matchedLang has dash, convert back to original format
  // E.g. zh-cn to zhCn
  if (matchedLang && matchedLang.includes('-')) {
    const [lang, region] = matchedLang.split('-');
    matchedLang = lang + region.charAt(0).toUpperCase() + region.slice(1);
  }

  return matchedLang ? matchedLang : null;
}

function translateRules(
  rules: readonly InstanceRule[] | null | undefined,
  currentLang: string | null | undefined,
): TranslatedInstanceRule[] {
  if (!rules?.length) return [];
  if (!currentLang)
    return rules.map((rule) => ({ ...rule, _translatedText: null }));
  return rules.map((rule) => {
    const matchedLang = findMatchingLanguage(rule, currentLang);
    return {
      ...rule,
      _translatedText:
        (matchedLang && rule.translations?.[matchedLang]?.text) || null,
    };
  });
}

interface ReportModalProps {
  account: mastodon.v1.Account;
  post?: { id?: string; [key: string]: unknown };
  onClose: () => void;
}

interface MastoReportsClient {
  v1: {
    reports: {
      create(params: {
        accountId: string;
        statusIds?: string[];
        category: string;
        comment?: string;
        ruleIds?: string[];
        forward?: boolean;
      }): Promise<unknown>;
    };
    accounts: {
      $select(id: string): {
        mute(): Promise<unknown>;
        block(): Promise<unknown>;
      };
    };
  };
}

function ReportModal({ account, post, onClose }: ReportModalProps) {
  const { t, i18n } = useLingui();
  const _ = (descriptor: MessageDescriptor) => i18n._(descriptor);
  const { masto: mastoBase } = api();
  const masto = mastoBase as unknown as MastoReportsClient;
  const [uiState, setUIState] = useState<
    'default' | 'loading' | 'success' | 'error'
  >('default');
  const [username, domain] = account.acct.split('@');

  const [translatedRules, currentDomain] = useMemo(() => {
    const instance = getCurrentInstance() as {
      rules?: readonly InstanceRule[] | null;
      domain?: string;
    };
    const rawRules = instance.rules || [];
    return [translateRules(rawRules, i18n.locale), instance.domain] as const;
  }, [i18n.locale]);

  const [selectedCategory, setSelectedCategory] =
    useState<ReportCategory | null>(null);
  const [showRules, setShowRules] = useState(false);

  const rulesRef = useRef<HTMLDivElement | null>(null);
  const [hasRules, setHasRules] = useState(false);

  return (
    <div class="report-modal-container">
      <div class="top-controls">
        <h1>{post ? t`Report Post` : t`Report @${username}`}</h1>
        <button
          type="button"
          class="plain4 small"
          disabled={uiState === 'loading'}
          onClick={() => onClose()}
        >
          <Icon icon="x" size="xl" alt={t`Close`} />
        </button>
      </div>
      <main>
        <div class="report-preview">
          {post ? (
            <Status status={post} size="s" previewMode />
          ) : (
            <AccountBlock
              account={account}
              avatarSize="xxl"
              useAvatarStatic
              showStats
              showActivity
            />
          )}
        </div>
        {!!selectedCategory &&
          !CATEGORIES_INFO[selectedCategory].excludeStamp && (
            <span
              class="rubber-stamp"
              key={selectedCategory}
              aria-hidden="true"
            >
              {_(
                CATEGORIES_INFO[selectedCategory].stampLabel ||
                  CATEGORIES_INFO[selectedCategory].label,
              )}
              <small>
                <Trans>Pending review</Trans>
              </small>
            </span>
          )}
        <form
          onSubmit={(e) => {
            e.preventDefault();

            const formEl = e.currentTarget;
            const formData = new FormData(formEl);
            const entries = Object.fromEntries(formData.entries()) as Record<
              string,
              FormDataEntryValue
            >;
            console.log('ENTRIES', entries);

            const category = entries.category as string;
            let comment: string | undefined = entries.comment as string;
            if (!comment) comment = undefined;
            const forward = entries.forward === 'on' ? true : undefined;
            const ruleIds =
              category === 'violation'
                ? Object.entries(entries)
                    .filter(([key]) => key.startsWith('rule_ids'))
                    .map(([, value]) => value as string)
                : undefined;

            const params = {
              category,
              comment,
              forward,
              ruleIds,
            };
            console.log('PARAMS', params);

            setUIState('loading');
            void (async () => {
              try {
                await masto.v1.reports.create({
                  accountId: account.id,
                  statusIds: post?.id ? [post.id] : undefined,
                  category,
                  comment,
                  ruleIds,
                  forward,
                });
                setUIState('success');
                showToast(post ? t`Post reported` : t`Profile reported`);
                onClose();
              } catch (error) {
                console.error(error);
                setUIState('error');
                const message =
                  (error as { message?: string } | null)?.message ||
                  (post
                    ? t`Unable to report post`
                    : t`Unable to report profile`);
                showToast(message);
              }
            })();
          }}
        >
          <p>
            {post
              ? t`What's the issue with this post?`
              : t`What's the issue with this profile?`}
          </p>
          <section class="report-categories">
            {CATEGORIES.map((category) =>
              category === 'violation' && !translatedRules?.length ? null : (
                <Fragment key={category}>
                  <label class="report-category">
                    <input
                      type="radio"
                      name="category"
                      value={category}
                      required
                      disabled={uiState === 'loading'}
                      onChange={(e) => {
                        const target = e.currentTarget;
                        setSelectedCategory(target.value as ReportCategory);
                        setShowRules(target.value === 'violation');
                      }}
                    />
                    <span>
                      {_(CATEGORIES_INFO[category].label)} &nbsp;
                      <small class="ib insignificant">
                        {_(CATEGORIES_INFO[category].description)}
                      </small>
                    </span>
                  </label>
                  {category === 'violation' && !!translatedRules?.length && (
                    <div
                      class="shazam-container no-animation"
                      hidden={!showRules}
                    >
                      <div class="shazam-container-inner">
                        <div class="report-rules" ref={rulesRef}>
                          {translatedRules.map(
                            (rule: TranslatedInstanceRule, i: number) => (
                              <label class="report-rule" key={rule.id}>
                                <input
                                  type="checkbox"
                                  name={`rule_ids[${i}]`}
                                  value={rule.id}
                                  required={showRules && !hasRules}
                                  disabled={uiState === 'loading'}
                                  onChange={(e) => {
                                    const target = e.currentTarget;
                                    const { checked } = target;
                                    if (checked) {
                                      setHasRules(true);
                                    } else {
                                      const checkedInputs =
                                        rulesRef.current?.querySelectorAll(
                                          'input:checked',
                                        );
                                      if (!checkedInputs?.length) {
                                        setHasRules(false);
                                      }
                                    }
                                  }}
                                />
                                <span>{rule._translatedText || rule.text}</span>
                              </label>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </Fragment>
              ),
            )}
          </section>
          <section class="report-comment">
            <p>
              <label htmlFor="report-comment">
                <Trans>Additional info</Trans>
              </label>
            </p>
            <textarea
              maxLength={1000}
              rows={1}
              name="comment"
              id="report-comment"
              disabled={uiState === 'loading'}
              required={!post} // Required if not reporting a post
            />
          </section>
          {!!domain && domain !== currentDomain && (
            <section>
              <p>
                <label>
                  <input
                    {...({
                      type: 'checkbox',
                      switch: true,
                      name: 'forward',
                      disabled: uiState === 'loading',
                    } as InputHTMLAttributes)}
                  />{' '}
                  <span>
                    <Trans>
                      Forward to <i>{domain}</i>
                    </Trans>
                  </span>
                </label>
              </p>
            </section>
          )}
          <footer>
            <button type="submit" disabled={uiState === 'loading'}>
              <Trans>Send Report</Trans>
            </button>{' '}
            <button
              type="submit"
              class="plain2"
              disabled={uiState === 'loading'}
              onClick={() => {
                void (async () => {
                  try {
                    await masto.v1.accounts.$select(account.id).mute(); // Infinite duration
                    showToast(t`Muted ${username}`);
                  } catch (e) {
                    console.error(e);
                    showToast(t`Unable to mute ${username}`);
                  }
                  // onSubmit will still run
                })();
              }}
            >
              <Trans>
                Send Report <small class="ib">+ Mute profile</small>
              </Trans>
            </button>{' '}
            <button
              type="submit"
              class="plain2"
              disabled={uiState === 'loading'}
              onClick={() => {
                void (async () => {
                  try {
                    await masto.v1.accounts.$select(account.id).block();
                    showToast(t`Blocked ${username}`);
                  } catch (e) {
                    console.error(e);
                    showToast(t`Unable to block ${username}`);
                  }
                  // onSubmit will still run
                })();
              }}
            >
              <Trans>
                Send Report <small class="ib">+ Block profile</small>
              </Trans>
            </button>
            <Loader hidden={uiState !== 'loading'} />
          </footer>
        </form>
      </main>
    </div>
  );
}

export default ReportModal;

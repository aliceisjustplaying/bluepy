import '@github/text-expander-element';

import { useLingui } from '@lingui/react/macro';
import type { JSX, Ref } from 'preact';
import { forwardRef, useImperativeHandle } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';

import { api } from '../utils/api';
import getCustomEmojis from '../utils/custom-emojis';
import emojifyText from '../utils/emojify-text';
import getDomain from '../utils/get-domain';
import isRTL from '../utils/is-rtl';
import shortenNumber from '../utils/shorten-number';

interface EmojiSearcher {
  search(
    term: string,
    options?: { limit?: number },
  ): { item: { shortcode: string; url: string } }[];
}

interface AccountResult {
  name?: string;
  avatarStatic?: string;
  displayName?: string;
  username?: string;
  acct?: string;
  emojis?: unknown[];
  history?: { uses?: number | string }[];
  roles?: { name?: string }[];
  url?: string;
}

interface TextExpanderChangeDetail {
  key: string;
  text: string;
  provide(
    result:
      | Promise<{ matched: boolean; fragment?: HTMLElement }>
      | { matched: boolean; fragment?: HTMLElement },
  ): void;
}

interface TextExpanderValueDetail {
  key: string;
  item: HTMLElement & { dataset: DOMStringMap };
  value: string;
  continue?: boolean;
}

interface TextExpanderCommittedDetail {
  input: HTMLInputElement | HTMLTextAreaElement | null;
}

export interface TextExpanderHandle {
  setStyle(style: Partial<CSSStyleDeclaration>): void;
  activated(): boolean;
}

interface TextExpanderProps extends Omit<
  JSX.HTMLAttributes<HTMLElement>,
  'onTrigger' | 'keys'
> {
  onTrigger?: ((payload: Record<string, unknown>) => void) | null;
  keys?: string;
}

const menu = document.createElement('ul');
menu.role = 'listbox';
menu.className = 'text-expander-menu';

// Set IntersectionObserver on menu, reposition it because text-expander doesn't handle it
const windowMargin = 16;
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const { left, width } = entry.boundingClientRect;
      const { innerWidth } = window;
      if (left + width > innerWidth) {
        const insetInlineStart = isRTL() ? 'right' : 'left';
        menu.style[insetInlineStart] = innerWidth - width - windowMargin + 'px';
      }
    }
  });
});
observer.observe(menu);

function encodeHTML(str: string | number | null | undefined = '') {
  const s = `${str}`;
  return s.replace(/[&<>"']/g, function (char) {
    return '&#' + char.charCodeAt(0) + ';';
  });
}

function TextExpander(
  { onTrigger = null, ...props }: TextExpanderProps,
  ref: Ref<TextExpanderHandle>,
) {
  const { t } = useLingui();
  const textExpanderRef = useRef<HTMLElement | null>(null);
  const { masto, instance } = api();
  const searcherRef = useRef<EmojiSearcher | undefined>(undefined);
  const textExpanderTextRef = useRef<string>('');
  const hasTextExpanderRef = useRef<boolean>(false);

  // Expose the activated state to parent components
  useImperativeHandle(ref, () => ({
    setStyle: (style: Partial<CSSStyleDeclaration>) => {
      if (textExpanderRef.current) {
        Object.assign(textExpanderRef.current.style, style);
      }
    },
    activated: () => hasTextExpanderRef.current,
  }));

  // Setup emoji search if not already set up
  useEffect(() => {
    if (searcherRef.current) return; // Already set up

    (getCustomEmojis(instance) as unknown as Promise<[unknown, EmojiSearcher]>)
      .then(([, searcher]) => {
        searcherRef.current = searcher;
      })
      .catch((e: unknown) => {
        console.error(e);
      });
  }, [instance]);

  useEffect(() => {
    const textExpander = textExpanderRef.current;
    if (!textExpander) return;

    const handleChange = (e: Event) => {
      const detail = (e as CustomEvent<TextExpanderChangeDetail>).detail;
      const { key, provide, text } = detail;
      textExpanderTextRef.current = text;

      if (text === '') {
        provide(
          Promise.resolve({
            matched: false,
          }),
        );
        return;
      }

      if (key === ':') {
        const showMore = !!onTrigger;
        const results = searcherRef.current?.search(text, {
          limit: 5,
        });

        let html = '';
        results?.forEach(({ item: emoji }) => {
          const { shortcode, url } = emoji;
          html += `
            <li role="option" data-value="${encodeHTML(shortcode)}">
              <img src="${encodeHTML(
                url,
              )}" width="16" height="16" alt="" loading="lazy" />
              ${encodeHTML(shortcode)}
            </li>`;
        });
        if (showMore) {
          html += `<li role="option" data-value="" data-more="${text}">${'More…'}</li>`;
        }
        menu.innerHTML = html;

        provide(
          Promise.resolve({
            matched: (results?.length || 0) > 0,
            fragment: menu,
          }),
        );
        return;
      }

      // Handle @ mentions and # hashtags
      const type = (
        {
          '@': 'accounts',
          '＠': 'accounts',
          '#': 'hashtags',
          '＃': 'hashtags',
        } as Record<string, 'accounts' | 'hashtags' | undefined>
      )[key];

      if (type) {
        provide(
          new Promise(async (resolve) => {
            try {
              let searchResults: AccountResult[];
              if (type === 'accounts') {
                searchResults = (await (
                  masto.v1.accounts as unknown as {
                    search: {
                      list(options: {
                        q: string;
                        limit: number;
                        resolve: boolean;
                      }): Promise<AccountResult[]>;
                    };
                  }
                ).search.list({
                  q: text,
                  limit: 5,
                  resolve: false,
                })) as AccountResult[];
              } else {
                const response = (await (
                  masto.v2.search as unknown as {
                    list(options: {
                      type: string;
                      q: string;
                      limit: number;
                    }): Promise<Record<string, AccountResult[] | undefined>>;
                  }
                ).list({
                  type,
                  q: text,
                  limit: 5,
                })) as Record<string, AccountResult[] | undefined>;
                searchResults =
                  response[type] || (response as unknown as AccountResult[]);
              }

              if (text !== textExpanderTextRef.current) {
                return;
              }

              const results = searchResults;
              let html = '';
              results.forEach((result) => {
                const {
                  name,
                  avatarStatic,
                  displayName,
                  username,
                  acct,
                  emojis,
                  history,
                  roles,
                  url,
                } = result;
                const displayNameWithEmoji = emojifyText(
                  displayName ?? '',
                  emojis as Parameters<typeof emojifyText>[1],
                );
                const accountInstance = getDomain(url ?? '');

                if (acct) {
                  html += `
                    <li role="option" data-value="${encodeHTML(acct)}">
                      <span class="avatar">
                        <img src="${encodeHTML(
                          avatarStatic,
                        )}" width="16" height="16" alt="" loading="lazy" />
                      </span>
                      <span>
                        <b>${displayNameWithEmoji || username}</b>
                        <br><span class="bidi-isolate">@${encodeHTML(
                          acct,
                        )}</span>
                        ${
                          roles?.map(
                            (role) => ` <span class="tag collapsed">
                            ${role.name}
                            ${
                              !!accountInstance &&
                              `<span class="more-insignificant">
                                ${accountInstance}
                              </span>`
                            }
                          </span>`,
                          ) || ''
                        }
                      </span>
                    </li>
                  `;
                } else {
                  const total = history?.reduce?.(
                    (acc: number, cur) => acc + +(cur.uses ?? 0),
                    0,
                  );
                  html += `
                    <li role="option" data-value="${encodeHTML(name)}">
                      <span class="grow">#<b>${encodeHTML(name)}</b></span>
                      ${
                        total
                          ? `<span class="count">${shortenNumber(total)}</span>`
                          : ''
                      }
                    </li>
                  `;
                }
              });
              if (type === 'accounts') {
                html += `<li role="option" data-value="" data-more="${text}">${t`More…`}</li>`;
              }
              menu.innerHTML = html;
              resolve({
                matched: results.length > 0,
                fragment: menu,
              });
            } catch (error) {
              console.error('Search error:', error);
              resolve({
                matched: false,
              });
            }
          }),
        );
        return;
      }

      // No other keys supported
      provide(
        Promise.resolve({
          matched: false,
        }),
      );
    };

    const handleValue = (e: Event) => {
      const detail = (e as CustomEvent<TextExpanderValueDetail>).detail;
      const { key, item } = detail;
      const { value, more } = item.dataset;

      if (key === ':') {
        detail.value = value ? `:${value}:` : '​'; // zero-width space
        if (more) {
          // Prevent adding space after the above value
          detail.continue = true;

          setTimeout(() => {
            // Trigger custom emoji picker modal for more options
            onTrigger?.({
              name: 'custom-emojis',
              defaultSearchTerm: more,
            });
          }, 300);
        }
      } else if (key === '@') {
        detail.value = value ? `@${value}` : '​'; // zero-width space
        if (more) {
          detail.continue = true;
          setTimeout(() => {
            onTrigger?.({
              name: 'mention',
              defaultSearchTerm: more,
            });
          }, 300);
        }
      } else if (key === '＠') {
        detail.value = value ? `＠${value}` : '​'; // zero-width space
        if (more) {
          detail.continue = true;
          setTimeout(() => {
            onTrigger?.({
              name: 'mention',
              defaultSearchTerm: more,
            });
          }, 300);
        }
      } else {
        detail.value = `${key}${value}`;
      }
    };

    const handleCommited = (e: Event) => {
      const detail = (e as CustomEvent<TextExpanderCommittedDetail>).detail;
      const { input } = detail;

      if (input) {
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
      }
    };

    const handleActivate = () => {
      hasTextExpanderRef.current = true;
    };

    const handleDeactivate = () => {
      hasTextExpanderRef.current = false;
    };

    textExpander.addEventListener('text-expander-change', handleChange);
    textExpander.addEventListener('text-expander-value', handleValue);
    textExpander.addEventListener('text-expander-committed', handleCommited);
    textExpander.addEventListener('text-expander-activate', handleActivate);
    textExpander.addEventListener('text-expander-deactivate', handleDeactivate);

    return () => {
      textExpander.removeEventListener('text-expander-change', handleChange);
      textExpander.removeEventListener('text-expander-value', handleValue);
      textExpander.removeEventListener(
        'text-expander-committed',
        handleCommited,
      );
      textExpander.removeEventListener(
        'text-expander-activate',
        handleActivate,
      );
      textExpander.removeEventListener(
        'text-expander-deactivate',
        handleDeactivate,
      );
    };
  }, [searcherRef.current, onTrigger, t, masto]);

  const TextExpanderTag = 'text-expander' as unknown as 'div';
  return (
    <TextExpanderTag
      ref={textExpanderRef as unknown as Ref<HTMLDivElement>}
      {...(props as JSX.HTMLAttributes<HTMLDivElement>)}
    />
  );
}

export default forwardRef(TextExpander);

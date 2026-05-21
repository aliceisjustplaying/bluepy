import '@github/text-expander-element';

import { useLingui } from '@lingui/react/macro';
import type { HTMLAttributes, Ref } from 'react';
import { useEffectEvent } from 'react';
import { useImperativeHandle } from 'react';
import { useEffect, useRef } from 'react';

import { api, getMastoV1Resource, getMastoV2Resource } from '../utils/api';
import emojifyText from '../utils/emojify-text';
import getDomain from '../utils/get-domain';
import isRTL from '../utils/is-rtl';
import shortenNumber from '../utils/shorten-number';

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

interface AccountSearchResource {
  search: {
    list(options: {
      q: string;
      limit: number;
      resolve: boolean;
    }): Promise<AccountResult[]>;
  };
}

interface TextExpanderSearchResponse extends Array<AccountResult> {
  accounts?: AccountResult[];
  hashtags?: AccountResult[];
}

interface TextExpanderSearchResource {
  list(options: {
    type: string;
    q: string;
    limit: number;
  }): Promise<TextExpanderSearchResponse>;
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
  HTMLAttributes<HTMLElement>,
  'onTrigger' | 'keys'
> {
  ref?: Ref<TextExpanderHandle>;
  onTrigger?: ((payload: Record<string, unknown>) => void) | null;
  keys?: string;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'text-expander': HTMLAttributes<HTMLElement> & {
        ref?: Ref<HTMLElement>;
      };
    }
  }
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

function TextExpander({ ref, onTrigger = null, ...props }: TextExpanderProps) {
  const { t } = useLingui();
  const textExpanderRef = useRef<HTMLElement | null>(null);
  const { masto } = api();
  const triggerMentionSearch = useEffectEvent((more: string) => {
    onTrigger?.({
      name: 'mention',
      defaultSearchTerm: more,
    });
  });
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

  useEffect(() => {
    const textExpander = textExpanderRef.current;
    if (!textExpander) return undefined;

    const handleChange = (e: Event) => {
      const detail = (e as CustomEvent<TextExpanderChangeDetail>).detail;
      const { key, text } = detail;
      textExpanderTextRef.current = text;

      if (text === '') {
        detail.provide(
          Promise.resolve({
            matched: false,
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
        detail.provide(
          (async () => {
            try {
              let searchResults: AccountResult[];
              if (type === 'accounts') {
                searchResults = await getMastoV1Resource<AccountSearchResource>(
                  masto,
                  'accounts',
                ).search.list({
                  q: text,
                  limit: 5,
                  resolve: false,
                });
              } else {
                const response =
                  await getMastoV2Resource<TextExpanderSearchResource>(
                    masto,
                    'search',
                  ).list({
                    type,
                    q: text,
                    limit: 5,
                  });
                searchResults = response[type] || response;
              }

              if (text !== textExpanderTextRef.current) {
                // Stale request: never resolve so the in-flight suggestion
                // menu isn't dismissed by an older response.
                await new Promise<never>(() => {});
                return { matched: false };
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
                          roles
                            ?.map(
                              (role) =>
                                ` <span class="tag collapsed">
                            ${role.name}
                            ${
                              accountInstance
                                ? `<span class="more-insignificant">
                                ${accountInstance}
                              </span>`
                                : false
                            }
                          </span>`,
                            )
                            .join(',') ?? ''
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
              return {
                matched: results.length > 0,
                fragment: menu,
              };
            } catch (error) {
              console.error('Search error:', error);
              return {
                matched: false,
              };
            }
          })(),
        );
        return;
      }

      // No other keys supported
      detail.provide(
        Promise.resolve({
          matched: false,
        }),
      );
    };

    const handleValue = (e: Event) => {
      const detail = (e as CustomEvent<TextExpanderValueDetail>).detail;
      const { key, item } = detail;
      const { value, more } = item.dataset;

      if (key === '@') {
        detail.value = value ? `@${value}` : '​'; // zero-width space
        if (more) {
          detail.continue = true;
          setTimeout(() => {
            triggerMentionSearch(more);
          }, 300);
        }
      } else if (key === '＠') {
        detail.value = value ? `＠${value}` : '​'; // zero-width space
        if (more) {
          detail.continue = true;
          setTimeout(() => {
            triggerMentionSearch(more);
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
  }, [t, masto]);

  return <text-expander ref={textExpanderRef} {...props} />;
}

export default TextExpander;

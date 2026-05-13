import type { JSX, Ref, RefObject } from 'preact';
import { forwardRef } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDebouncedCallback, useThrottledCallback } from 'use-debounce';

import { langDetector } from '../utils/browser-translator';
import escapeHTML from '../utils/escape-html';
import states from '../utils/states';
import urlRegexObj from '../utils/url-regex';
import useThrottledResizeObserver from '../utils/useThrottledResizeObserver';

import TextExpander, { type TextExpanderHandle } from './text-expander';

// https://github.com/mastodon/mastodon/blob/c03bd2a238741a012aa4b98dc4902d6cf948ab63/app/models/account.rb#L69
const USERNAME_RE = /[a-z0-9_]+([a-z0-9_.-]+[a-z0-9_]+)?/i;
const MENTION_RE = new RegExp(
  `(^|[^=\\/\\w])([@＠]${USERNAME_RE.source}(?:@[\\p{L}\\w.-]+[\\w]+)?)`,
  'uig',
);

// AI-generated, all other regexes are too complicated
const HASHTAG_RE = new RegExp(
  `(^|[^=\\/\\w])([#＃][\\p{L}\\p{N}_]+([\\p{L}\\p{N}_.]+[\\p{L}\\p{N}_]+)?)(?![\\/\\w])`,
  'iug',
);

// https://github.com/mastodon/mastodon/blob/23e32a4b3031d1da8b911e0145d61b4dd47c4f96/app/models/custom_emoji.rb#L31
const SHORTCODE_RE_FRAGMENT = '[a-zA-Z0-9_]{2,}';
const SCAN_RE = new RegExp(
  `(^|[^=\\/\\w])(:${SHORTCODE_RE_FRAGMENT}:)(?=[^A-Za-z0-9_:]|$)`,
  'g',
);

const segmenter = new Intl.Segmenter();

function highlightText(
  text: string,
  { maxCharacters = Infinity }: { maxCharacters?: number },
): string {
  // Exceeded characters limit
  const { composerCharacterCount } = states as unknown as {
    composerCharacterCount?: number;
  };
  if ((composerCharacterCount ?? 0) > maxCharacters) {
    // Highlight exceeded characters
    let withinLimitHTML = '',
      exceedLimitHTML = '';
    const htmlSegments = segmenter.segment(text);
    for (const { segment, index } of htmlSegments) {
      if (index < maxCharacters) {
        withinLimitHTML += segment;
      } else {
        exceedLimitHTML += segment;
      }
    }
    if (exceedLimitHTML) {
      exceedLimitHTML =
        '<mark class="compose-highlight-exceeded">' +
        escapeHTML(exceedLimitHTML) +
        '</mark>';
    }
    return escapeHTML(withinLimitHTML) + exceedLimitHTML;
  }

  return escapeHTML(text)
    .replace(urlRegexObj, '$2<mark class="compose-highlight-url">$3</mark>') // URLs
    .replace(MENTION_RE, '$1<mark class="compose-highlight-mention">$2</mark>') // Mentions
    .replace(HASHTAG_RE, '$1<mark class="compose-highlight-hashtag">$2</mark>') // Hashtags
    .replace(
      SCAN_RE,
      '$1<mark class="compose-highlight-emoji-shortcode">$2</mark>',
    ); // Emoji shortcodes
}

function autoResizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  // writing-mode is vertical, don't do this
  if (getComputedStyle(textarea).writingMode.includes('vertical')) return;
  const { value, offsetHeight, scrollHeight, clientHeight } = textarea;
  if (offsetHeight < window.innerHeight) {
    // NOTE: This check is needed because the offsetHeight return 50000 (really large number) on first render
    // No idea why it does that, will re-investigate in far future
    const offset = offsetHeight - clientHeight;
    const height = value ? scrollHeight + offset + 'px' : '';
    textarea.style.height = height;
  }
}

interface LanguageDetectionResult {
  detectedLanguage?: string;
  lang?: string;
}

const detectLangs = async (text: string): Promise<string[] | null> => {
  if (langDetector) {
    const langs = (await langDetector.detect(
      text,
    )) as LanguageDetectionResult[];
    if (langs?.length) {
      return langs
        .slice(0, 2)
        .map((lang) => lang.detectedLanguage)
        .filter((l): l is string => typeof l === 'string');
    }
  }
  const { detectAll } = await import('tinyld/light');
  const langs = (detectAll as (t: string) => LanguageDetectionResult[])(text);
  if (langs?.length) {
    // return max 2
    return langs
      .slice(0, 2)
      .map((lang) => lang.lang)
      .filter((l): l is string => typeof l === 'string');
  }
  return null;
};

interface TextareaProps extends Omit<
  JSX.HTMLAttributes<HTMLTextAreaElement>,
  'onTrigger'
> {
  maxCharacters?: number;
  onTrigger?: ((payload: Record<string, unknown>) => void) | null;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (props: TextareaProps, ref: Ref<HTMLTextAreaElement>) => {
    const textareaRef = ref as RefObject<HTMLTextAreaElement>;
    const [text, setText] = useState<string>(textareaRef?.current?.value || '');
    const { maxCharacters, onTrigger = null, ...textareaProps } = props;

    const textExpanderRef = useRef<TextExpanderHandle | null>(null);

    useThrottledResizeObserver<HTMLTextAreaElement>({
      ref: textareaRef,
      onResize: () => {
        // Get height of textarea, set height to textExpander
        if (textExpanderRef.current && textareaRef?.current) {
          const { height } = textareaRef.current.getBoundingClientRect();
          if (height) {
            textExpanderRef.current.setStyle({
              minHeight: height + 'px',
            } as unknown as Partial<CSSStyleDeclaration>);
          }
        }
      },
    });

    const slowHighlightPerf = useRef(0); // increment if slow
    const composeHighlightRef = useRef<HTMLDivElement | null>(null);
    const throttleHighlightText = useThrottledCallback((text: string) => {
      if (!composeHighlightRef.current) return;
      if (slowHighlightPerf.current > 3) {
        // After 3 times of lag, disable highlighting
        composeHighlightRef.current.innerHTML = '';
        composeHighlightRef.current = null; // Destroy the whole thing
        throttleHighlightText?.cancel?.();
        return;
      }
      let start: number | undefined;
      let end: number | undefined;
      if (slowHighlightPerf.current <= 3) start = Date.now();
      composeHighlightRef.current.innerHTML =
        highlightText(text, {
          maxCharacters,
        }) + '\n';
      if (slowHighlightPerf.current <= 3) end = Date.now();
      console.debug('HIGHLIGHT PERF', {
        start,
        end,
        diff:
          end !== undefined && start !== undefined ? end - start : undefined,
      });
      if (start && end && end - start > 50) {
        // if slow, increment
        slowHighlightPerf.current++;
      }
      // Newline to prevent multiple line breaks at the end from being collapsed, no idea why
    }, 500);

    const debouncedAutoDetectLanguage = useDebouncedCallback(() => {
      // Make use of the highlightRef to get the DOM
      // Clone the dom
      const dom = composeHighlightRef.current?.cloneNode(true) as
        | HTMLElement
        | undefined;
      if (!dom) return;
      // Remove mark
      dom.querySelectorAll('mark').forEach((mark: HTMLElement) => {
        mark.remove();
      });
      const text = dom.innerText?.trim();
      if (!text) return;
      (async () => {
        const langs = await detectLangs(text);
        if (langs?.length) {
          onTrigger?.({
            name: 'auto-detect-language',
            languages: langs,
          });
        }
      })();
    }, 2000);

    return (
      <TextExpander
        ref={textExpanderRef as unknown as Ref<TextExpanderHandle>}
        keys="@ ＠ : # ＃"
        class="compose-field-container"
        onTrigger={onTrigger}
      >
        <textarea
          class="compose-field"
          autoCapitalize="sentences"
          autoComplete="on"
          autoCorrect="on"
          spellcheck
          dir="auto"
          rows={6}
          cols={50}
          {...textareaProps}
          ref={ref}
          name="status"
          value={text}
          onKeyDown={(e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
            // Get line before cursor position after pressing 'Enter'
            const { key } = e;
            const target = e.currentTarget;
            const hasTextExpander = textExpanderRef.current?.activated();
            if (
              key === 'Enter' &&
              !(e.ctrlKey || e.metaKey || hasTextExpander) &&
              !e.isComposing
            ) {
              try {
                const { value, selectionStart } = target;
                const textBeforeCursor = value.slice(0, selectionStart);
                const lastLine = textBeforeCursor.split('\n').slice(-1)[0];
                if (lastLine) {
                  // If line starts with "- " or "12. "
                  if (/^\s*(-|\d+\.)\s/.test(lastLine)) {
                    // insert "- " at cursor position
                    const [_, preSpaces, bullet, postSpaces, anything] =
                      lastLine.match(/^(\s*)(-|\d+\.)(\s+)(.+)?/) || [];
                    if (anything) {
                      e.preventDefault();
                      const [number] = bullet.match(/\d+/) || [];
                      const newBullet = number ? `${+number + 1}.` : '-';
                      const text = `\n${preSpaces}${newBullet}${postSpaces}`;
                      target.setRangeText(text, selectionStart, selectionStart);
                      const pos = selectionStart + text.length;
                      target.setSelectionRange(pos, pos);
                    } else {
                      // trim the line before the cursor, then insert new line
                      const pos = selectionStart - lastLine.length;
                      target.setRangeText('', pos, selectionStart);
                    }
                    autoResizeTextarea(target);
                    target.dispatchEvent(new Event('input'));
                  }
                }
              } catch (e) {
                // silent fail
                console.error(e);
              }
            }
            if (composeHighlightRef.current) {
              composeHighlightRef.current.scrollTop = target.scrollTop;
            }
          }}
          onInput={(e: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => {
            const target = e.currentTarget;
            const text = target.value;
            setText(text);
            autoResizeTextarea(target);
            (
              props.onInput as
                | ((ev: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => void)
                | undefined
            )?.(e);
            throttleHighlightText(text);
            debouncedAutoDetectLanguage();
          }}
          onScroll={(e: JSX.TargetedUIEvent<HTMLTextAreaElement>) => {
            if (composeHighlightRef.current) {
              const { scrollTop } = e.currentTarget;
              composeHighlightRef.current.scrollTop = scrollTop;
            }
          }}
          onPaste={(e: JSX.TargetedClipboardEvent<HTMLTextAreaElement>) => {
            try {
              const pastedText = e.clipboardData?.getData('text').trim();
              if (pastedText) {
                onTrigger?.({
                  name: 'pasted-link',
                  url: pastedText,
                });
              }
            } catch (error) {
              console.error(error);
            }
          }}
        />
        <div
          ref={composeHighlightRef}
          class="compose-highlight"
          aria-hidden="true"
        />
      </TextExpander>
    );
  },
);

export default Textarea;

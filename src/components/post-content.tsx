import { useEffect, useLayoutEffect, useRef } from 'react';
import { useSnapshot } from 'valtio';

import enhanceContent from '../utils/enhance-content';
import handleContentLinks from '../utils/handle-content-links';
import states, { statusKey } from '../utils/states';

const HTTP_REGEX = /^http/i;

interface EmojiEntry {
  shortcode?: string;
  url?: string;
  staticUrl?: string;
}

interface MentionLike {
  url?: string;
  acct?: string;
  username?: string;
}

interface PostContentPost {
  id?: string;
  content?: string;
  emojis?: EmojiEntry[];
  language?: string;
  mentions?: MentionLike[];
  url?: string;
  [key: string]: unknown;
}

interface PostContentProps {
  post: PostContentPost;
  instance?: string;
  previewMode?: boolean;
}

type EnhanceContentDOM = HTMLDivElement | DocumentFragment;

function enhanceContentDOM(
  content: string | undefined,
  opts: { emojis?: readonly EmojiEntry[]; returnDOM: true },
): EnhanceContentDOM {
  const dom = enhanceContent(content, opts);
  if (typeof dom === 'string') {
    throw new TypeError('Expected enhanceContent to return DOM');
  }
  return dom;
}

const PostContent =
  /*memo(*/
  ({ post, instance, previewMode }: PostContentProps) => {
    const { content, emojis, language, mentions } = post;
    const snapStates = useSnapshot(states);
    const sKey = statusKey(post.id, instance);
    const quotes = sKey ? snapStates.statusQuotes[sKey] : undefined;

    const divRef = useRef<HTMLDivElement | null>(null);

    // Track the latest `emojis` and `quotes` arrays via refs so the effects
    // below can read them without subscribing to every new array reference
    // the parent may emit. The effects intentionally re-run only when
    // length changes (a cheap proxy for content change) — without these
    // refs, depending on the arrays themselves would re-run on every parent
    // render, re-doing expensive DOM enhancement.
    //
    // The emojis ref is updated in a `useLayoutEffect` so it is current
    // before the DOM-enhancement layout effect below runs in the same
    // commit (passive effects fire later, which would leave the
    // enhancement reading a stale reference).
    const emojisRef = useRef(emojis);
    useLayoutEffect(() => {
      emojisRef.current = emojis;
    }, [emojis]);
    const quotesRef = useRef(quotes);
    useEffect(() => {
      quotesRef.current = quotes;
    }, [quotes]);

    const emojisLength = emojis?.length;
    useLayoutEffect(() => {
      if (!divRef.current) return;
      const dom = enhanceContentDOM(content, {
        emojis: emojisRef.current,
        returnDOM: true,
      });
      // Remove target="_blank" from links
      for (const a of dom.querySelectorAll<HTMLAnchorElement>(
        'a.u-url[target="_blank"]',
      )) {
        if (!HTTP_REGEX.test(a.innerText.trim())) {
          a.removeAttribute('target');
        }
      }
      divRef.current.replaceChildren(dom.cloneNode(true));
    }, [content, emojisLength]);

    const quotesLength = quotes?.length;
    useEffect(() => {
      // Find all links that's in states.statusQuotes and add 'is-quote' class
      const currentQuotes = quotesRef.current;
      const currentDiv = divRef.current;
      if (currentQuotes?.length) {
        for (const a of currentDiv?.querySelectorAll('a') ?? []) {
          if (
            currentQuotes.some(
              (quote) =>
                (quote as { originalURL?: string } | null)?.originalURL ===
                a.href,
            )
          ) {
            a.classList.add('is-quote');
          }
        }
      }
    }, [quotesLength]);

    return (
      // TODO(oxlint:jsx-a11y/click-events-have-key-events,no-static-element-interactions):
      // delegated click handler captures clicks on dynamically-inserted anchor
      // tags (mentions, hashtags) inside the rendered post HTML. Keyboard users
      // interact with the actual anchors via Tab+Enter, which works natively.
      <div
        ref={divRef}
        lang={language}
        dir="auto"
        className="inner-content"
        role="presentation"
        onClick={handleContentLinks({
          mentions,
          instance,
          previewMode,
        })}
        // dangerouslySetInnerHTML={{
        //   __html: enhanceContent(content, {
        //     emojis,
        //     postEnhanceDOM: (dom) => {
        //       // Remove target="_blank" from links
        //       dom.querySelectorAll('a.u-url[target="_blank"]').forEach((a) => {
        //         if (!/http/i.test(a.innerText.trim())) {
        //           a.removeAttribute('target');
        //         }
        //       });
        //     },
        //   }),
        // }}
      />
    );
  }; /*,
  (oldProps, newProps) => {
    const { post: oldPost } = oldProps;
    const { post: newPost } = newProps;
    return oldPost.content === newPost.content;
  },
);*/

export default PostContent;

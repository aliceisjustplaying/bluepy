import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import enhanceContent from '../utils/enhance-content';
import handleContentLinks from '../utils/handle-content-links';
import states, { statusKey } from '../utils/states';

const HTTP_REGEX = /^http/i;

interface PostContentPost {
  id?: string;
  content?: string;
  emojis?: unknown[];
  language?: string;
  mentions?: unknown[];
  url?: string;
  [key: string]: unknown;
}

interface PostContentProps {
  post: PostContentPost;
  instance?: string;
  previewMode?: boolean;
}

// `enhanceContent` and `handleContentLinks` are still untyped JS. Shim their
// signatures locally; the next batch that types those modules removes these
// casts.
const enhanceContentT = enhanceContent as unknown as (
  content: string | undefined,
  opts: { emojis?: unknown[]; returnDOM?: boolean },
) => (Element | DocumentFragment) & {
  querySelectorAll: Element['querySelectorAll'];
  cloneNode: Node['cloneNode'];
};
const handleContentLinksT = handleContentLinks as unknown as (
  opts: Record<string, unknown>,
) => (e: MouseEvent) => void;

const PostContent =
  /*memo(*/
  ({ post, instance, previewMode }: PostContentProps) => {
    const { content, emojis, language, mentions, url } = post;
    const snapStates = useSnapshot(states);
    const sKey = statusKey(post.id, instance);
    const quotes = sKey ? snapStates.statusQuotes[sKey] : undefined;

    const divRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
      if (!divRef.current) return;
      const dom = enhanceContentT(content, {
        emojis,
        returnDOM: true,
      });
      // Remove target="_blank" from links
      for (const a of dom.querySelectorAll(
        'a.u-url[target="_blank"]',
      ) as NodeListOf<HTMLAnchorElement>) {
        if (!HTTP_REGEX.test(a.innerText.trim())) {
          a.removeAttribute('target');
        }
      }
      divRef.current.replaceChildren(dom.cloneNode(true));
    }, [content, (emojis as unknown[] | undefined)?.length]);

    useEffect(() => {
      // Find all links that's in states.statusQuotes and add 'is-quote' class
      if (quotes?.length) {
        for (const a of divRef.current!.querySelectorAll('a')) {
          if (
            quotes.some(
              (quote) =>
                (quote as { originalURL?: string } | null)?.originalURL ===
                a.href,
            )
          ) {
            a.classList.add('is-quote');
          }
        }
      }
    }, [quotes?.length]);

    return (
      <div
        ref={divRef}
        lang={language}
        dir="auto"
        class="inner-content"
        onClick={handleContentLinksT({
          mentions,
          instance,
          previewMode,
          statusURL: url,
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

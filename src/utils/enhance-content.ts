import emojifyText from './emojify-text';
import escapeHTML from './escape-html';
import mem from './mem';

const fauxDiv = document.createElement('div');
const whitelistLinkClasses = new Set(['u-url', 'mention', 'hashtag']);

const LINK_REGEX = /<a/i;
const HTTP_LINK_REGEX = /^https?:\/\//i;
const MENTION_REGEX = /^[@＠][^@＠]+(@[^@＠]+)?$/;
const HASHTAG_REGEX = /^[#＃][^#＃]+$/;
const HASH_EMOJI_REGEX = /^#️⃣/;
const CODE_BLOCK_REGEX = /^```[^]+```$/;
const CODE_BLOCK_START_REGEX = /^```/;
const CODE_BLOCK_END_REGEX = /```$/;
const INLINE_CODE_REGEX = /`[^`]+`/;
const TWITTER_DOMAIN_REGEX = /(twitter|x)\.com/i;
const TWITTER_MENTION_REGEX = /@[a-zA-Z0-9_]+@(twitter|x)\.com/;
const TWITTER_MENTION_CAPTURE_REGEX = /(@([a-zA-Z0-9_]+)@(twitter|x)\.com)/g;
const CODE_INLINE_CAPTURE_REGEX = /(`[^]+?`)/g;

// `dom` is either an HTMLDivElement (when caller wants HTML back) or a
// DocumentFragment (when caller wants the live DOM via `returnDOM: true`).
// Both implement the parent-node methods used here.
type EnhanceDOM = HTMLDivElement | DocumentFragment;

interface EmojiEntry {
  shortcode?: string;
  url?: string;
  staticUrl?: string;
}

interface EnhanceOpts {
  emojis?: readonly EmojiEntry[];
  returnDOM?: boolean;
  postEnhanceDOM?: (dom: EnhanceDOM) => void;
}

function createDOM(html: string, isDocumentFragment: true): DocumentFragment;
function createDOM(html: string, isDocumentFragment?: false): HTMLDivElement;
function createDOM(html: string, isDocumentFragment?: boolean): EnhanceDOM;
function createDOM(html: string, isDocumentFragment?: boolean): EnhanceDOM {
  if (isDocumentFragment) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content;
  } else {
    const tpl = document.createElement('div');
    tpl.innerHTML = html;
    return tpl;
  }
}

function enhanceContentRaw(
  content: string | null | undefined,
  opts: EnhanceOpts = {},
): string | EnhanceDOM {
  if (!content) return '';
  const { emojis, returnDOM, postEnhanceDOM = () => {} } = opts;
  const enhancedContent = content;
  // const dom = document.createElement('div');
  // dom.innerHTML = enhancedContent;
  const dom = createDOM(enhancedContent, returnDOM);
  const hasLink = LINK_REGEX.test(enhancedContent);
  const hasCodeBlock = enhancedContent.includes('```');

  if (hasLink) {
    // Add target="_blank" to all links with no target="_blank"
    // E.g. `note` in `account`
    const noTargetBlankLinks = dom.querySelectorAll<HTMLAnchorElement>(
      'a:not([target="_blank"])',
    );
    for (const link of noTargetBlankLinks) {
      link.setAttribute('target', '_blank');
    }

    // Remove all classes except `u-url`, `mention`, `hashtag`
    const links = dom.querySelectorAll<HTMLAnchorElement>('a[class]');
    for (const link of links) {
      for (const c of link.classList) {
        if (!whitelistLinkClasses.has(c)) {
          link.classList.remove(c);
        }
      }
    }
  }

  // Add 'has-url-text' to all links that contains a url
  if (hasLink) {
    const links = dom.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (const link of links) {
      if (HTTP_LINK_REGEX.test((link.textContent ?? '').trim())) {
        link.classList.add('has-url-text');
        shortenLink(link);
      }
    }
  }

  // Spanify un-spanned mentions
  if (hasLink) {
    const links = dom.querySelectorAll<HTMLAnchorElement>('a[href]');
    const usernames: Array<[string, string | undefined]> = [];
    for (const link of links) {
      const text = link.innerText.trim();
      const hasChildren = link.querySelector('*');
      // If text looks like @username@domain, then it's a mention
      if (MENTION_REGEX.test(text)) {
        // Only show @username
        const atSymbol = text[0]; // Preserve the original @ or ＠
        const [, username, domain] = text.split(/[@＠]/);
        if (!hasChildren) {
          if (
            !usernames.some(([u]) => u === username) ||
            usernames.some(([u, d]) => u === username && d === domain)
          ) {
            link.innerHTML = `${atSymbol}<span>${username}</span>`;
            usernames.push([username, domain]);
          } else {
            link.innerHTML = `${atSymbol}<span>${username}@${domain}</span>`;
          }
        }
        link.classList.add('mention');
      }
      // If text looks like #hashtag, then it's a hashtag
      if (HASHTAG_REGEX.test(text)) {
        const hashSymbol = text[0]; // Preserve the original # or ＃
        if (!hasChildren) {
          link.innerHTML = `${hashSymbol}<span>${text.slice(1)}</span>`;
        } else {
          // Special case for #️⃣
          if (HASH_EMOJI_REGEX.test(text)) {
            // <span> contains half-char of #️⃣
            const actualText = text.replace(HASH_EMOJI_REGEX, '');
            link.innerHTML = `#️⃣<span>${actualText}</span>`;
          }
        }
        link.classList.add('mention', 'hashtag');
      }
    }
  }

  // EMOJIS
  // ======
  // Convert :shortcode: to <img />
  let textNodes: Text[];
  if (enhancedContent.includes(':') && emojis?.length) {
    textNodes = extractTextNodes(dom);
    for (const node of textNodes) {
      let html = escapeHTML(node.nodeValue ?? '');
      html = emojifyText(html, emojis as EmojiEntry[]);
      fauxDiv.innerHTML = html;
      node.replaceWith(...fauxDiv.childNodes);
    }
  }

  // CODE BLOCKS
  // ===========
  // Convert ```code``` to <pre><code>code</code></pre>
  if (hasCodeBlock) {
    const blocks = [...dom.querySelectorAll<HTMLParagraphElement>('p')].filter(
      (p) => CODE_BLOCK_REGEX.test(p.innerText.trim()),
    );
    for (const block of blocks) {
      const pre = document.createElement('pre');
      // Replace <br /> with newlines
      for (const br of block.querySelectorAll('br')) {
        br.replaceWith('\n');
      }
      pre.innerHTML = `<code>${block.innerHTML.trim()}</code>`;
      block.replaceWith(pre);
    }
  }

  // Convert multi-paragraph code blocks to <pre><code>code</code></pre>
  if (hasCodeBlock) {
    const paragraphs = [...dom.querySelectorAll<HTMLParagraphElement>('p')];
    // Filter out paragraphs with ``` in beginning only
    const codeBlocks = paragraphs.filter((p) =>
      CODE_BLOCK_START_REGEX.test(p.innerText),
    );
    // For each codeBlocks, get all paragraphs until the last paragraph with ``` at the end only
    for (const block of codeBlocks) {
      const nextParagraphs: HTMLParagraphElement[] = [block];
      let hasClosingBlock = false;
      let currentBlock: Element = block;
      while (currentBlock.nextElementSibling) {
        const next = currentBlock.nextElementSibling;
        if (next && next.tagName === 'P') {
          const nextP = next as HTMLParagraphElement;
          if (CODE_BLOCK_END_REGEX.test(nextP.innerText)) {
            nextParagraphs.push(nextP);
            hasClosingBlock = true;
            break;
          } else {
            nextParagraphs.push(nextP);
          }
        } else {
          break;
        }
        currentBlock = next;
      }
      if (hasClosingBlock) {
        const pre = document.createElement('pre');
        for (const p of nextParagraphs) {
          // Replace <br /> with newlines
          for (const br of p.querySelectorAll('br')) {
            br.replaceWith('\n');
          }
        }
        const codeText = nextParagraphs.map((p) => p.innerHTML).join('\n\n');
        pre.innerHTML = `<code tabindex="0">${codeText}</code>`;
        block.replaceWith(pre);
        for (const p of nextParagraphs) {
          p.remove();
        }
      }
    }
  }

  // INLINE CODE
  // ===========
  // Convert `code` to <code>code</code>
  if (enhancedContent.includes('`')) {
    textNodes = extractTextNodes(dom);
    for (const node of textNodes) {
      let html = escapeHTML(node.nodeValue ?? '');
      if (INLINE_CODE_REGEX.test(html)) {
        html = html.replaceAll(CODE_INLINE_CAPTURE_REGEX, '<code>$1</code>');
      }
      fauxDiv.innerHTML = html;
      // const nodes = [...fauxDiv.childNodes];
      node.replaceWith(...fauxDiv.childNodes);
    }
  }

  // TWITTER USERNAMES
  // =================
  // Convert @username@twitter.com to <a href="https://twitter.com/username">@username@twitter.com</a>
  if (TWITTER_DOMAIN_REGEX.test(enhancedContent)) {
    textNodes = extractTextNodes(dom, {
      rejectFilter: ['A'],
    });
    for (const node of textNodes) {
      let html = escapeHTML(node.nodeValue ?? '');
      if (TWITTER_MENTION_REGEX.test(html)) {
        html = html.replaceAll(
          TWITTER_MENTION_CAPTURE_REGEX,
          '<a href="https://twitter.com/$2" rel="nofollow noopener" target="_blank">$1</a>',
        );
      }
      fauxDiv.innerHTML = html;
      // const nodes = [...fauxDiv.childNodes];
      node.replaceWith(...fauxDiv.childNodes);
    }
  }

  // HASHTAG STUFFING
  // ================
  // Get the <p> that contains a lot of hashtags, add a class to it
  if (enhancedContent.includes('#') || enhancedContent.includes('＃')) {
    let prevIndex: number | null = null;
    const hashtagStuffedParagraphs = [
      ...dom.querySelectorAll<HTMLParagraphElement>('p'),
    ].filter((p, index) => {
      let hashtagCount = 0;
      for (let i = 0; i < p.childNodes.length; i++) {
        const node = p.childNodes[i];

        if (node.nodeType === Node.TEXT_NODE) {
          const text = (node.textContent ?? '').trim();
          if (text !== '') {
            return false;
          }
        } else if ((node as Element).tagName === 'BR') {
          // Ignore <br />
        } else if ((node as Element).tagName === 'A') {
          const linkText = (node.textContent ?? '').trim();
          if (
            !linkText ||
            !(linkText.startsWith('#') || linkText.startsWith('＃'))
          ) {
            return false;
          } else {
            hashtagCount++;
          }
        } else {
          return false;
        }
      }
      // Only consider "stuffing" if:
      // - there are more than 3 hashtags
      // - there are more than 1 hashtag in adjacent paragraphs
      if (hashtagCount > 3) {
        prevIndex = index;
        return true;
      }
      // Preserve original JS truthiness: `prevIndex && ...` treats both
      // `null` and `0` as falsy, so adjacency only kicks in when the previous
      // stuffed paragraph was at index 1 or higher. Behavior change candidate
      // — fix in its own follow-up, not as a drive-by in this batch.
      if (hashtagCount > 1 && prevIndex && index === prevIndex + 1) {
        prevIndex = index;
        return true;
      }
      return false;
    });
    if (hashtagStuffedParagraphs?.length) {
      for (const p of hashtagStuffedParagraphs) {
        p.classList.add('hashtag-stuffing');
        p.title = p.innerText;
      }
    }
  }

  // ADD ASPECT RATIO TO ALL IMAGES
  if (enhancedContent.includes('<img')) {
    const imgs = dom.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const width = img.getAttribute('width') || img.naturalWidth;
      const height = img.getAttribute('height') || img.naturalHeight;
      if (width && height) {
        img.style.setProperty('--original-aspect-ratio', `${width}/${height}`);
      }
    }
  }

  // FIX CLOAK MODE FOR SAFARI
  // Workaround for Safari so that `text-decoration-thickness` works
  // Wrap child text nodes in spans
  for (const node of dom.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) {
      const span = document.createElement('span');
      span.textContent = node.textContent;
      dom.replaceChild(span, node);
    }
  }

  if (postEnhanceDOM) {
    queueMicrotask(() => {
      postEnhanceDOM(dom);
    });
    // postEnhanceDOM(dom); // mutate dom
  }

  if (returnDOM) return dom;
  // When `returnDOM` is false, `createDOM` returned an HTMLDivElement, which
  // exposes `innerHTML`. Cast away the union here.
  return (dom as HTMLDivElement).innerHTML;
}
const enhanceContent = mem(enhanceContentRaw);

const defaultRejectFilter = [
  // Document metadata
  'STYLE',
  // Image and multimedia
  'IMG',
  'VIDEO',
  'AUDIO',
  'AREA',
  'MAP',
  'TRACK',
  // Embedded content
  'EMBED',
  'IFRAME',
  'OBJECT',
  'PICTURE',
  'PORTAL',
  'SOURCE',
  // SVG and MathML
  'SVG',
  'MATH',
  // Scripting
  'CANVAS',
  'NOSCRIPT',
  'SCRIPT',
  // Forms
  'INPUT',
  'OPTION',
  'TEXTAREA',
  // Web Components
  'SLOT',
  'TEMPLATE',
];
const defaultRejectFilterMap: Record<string, true> = Object.fromEntries(
  defaultRejectFilter.map((nodeName) => [nodeName, true]),
);

const URL_PREFIX_REGEX = /^(https?:\/\/(www\.)?|xmpp:)/;
const URL_DISPLAY_LENGTH = 30;
function shortenLink(link: HTMLAnchorElement | null | undefined): void {
  if (!link || link.querySelector?.('*')) {
    return;
  }
  try {
    const url = link.innerText.trim();
    const prefix = (url.match(URL_PREFIX_REGEX) || [])[0] || '';
    if (!prefix) return;
    const displayURL = url.slice(
      prefix.length,
      prefix.length + URL_DISPLAY_LENGTH,
    );
    const suffix = url.slice(prefix.length + URL_DISPLAY_LENGTH);
    const cutoff = url.slice(prefix.length).length > URL_DISPLAY_LENGTH;
    link.replaceChildren(
      createTextSpan(prefix, 'invisible'),
      createTextSpan(displayURL, cutoff ? 'ellipsis' : ''),
      createTextSpan(suffix, 'invisible'),
    );
  } catch {
    // Silently fail on malformed URLs
  }
}

function createTextSpan(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

interface ExtractTextNodesOpts {
  rejectFilter?: readonly string[];
}

function extractTextNodes(dom: Node, opts: ExtractTextNodesOpts = {}): Text[] {
  const textNodes: Text[] = [];
  const rejectFilterMap: Record<string, true> = Object.assign(
    {},
    defaultRejectFilterMap,
    opts.rejectFilter?.reduce<Record<string, true>>((acc, cur) => {
      acc[cur] = true;
      return acc;
    }, {}),
  );
  const walk = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentName = node.parentNode?.nodeName;
      if (parentName && rejectFilterMap[parentName]) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = walk.nextNode())) {
    textNodes.push(node as Text);
  }
  return textNodes;
}

export default enhanceContent;

import { createElement, type HTMLAttributes, type Ref, useMemo } from 'react';

type RawHtmlTag = 'div' | 'span' | 'p' | 'output';

interface RawHtmlProps extends HTMLAttributes<HTMLElement> {
  html: string;
  ref?: Ref<HTMLElement>;
  tag?: RawHtmlTag;
}

const URL_ATTRS = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
]);
const BLOCKED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
]);

function isSafeURL(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^(#|\/(?!\/)|\.{0,2}\/|\?|mailto:|tel:)/i.test(trimmed)) return true;
  try {
    const url = new URL(trimmed, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeHTML(html: string): string {
  if (typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('*').forEach((element) => {
    if (BLOCKED_TAGS.has(element.tagName.toLowerCase())) {
      element.remove();
      return;
    }
    [...element.attributes].forEach(({ name, value }) => {
      const attrName = name.toLowerCase();
      if (
        attrName.startsWith('on') ||
        attrName === 'srcdoc' ||
        (URL_ATTRS.has(attrName) && !isSafeURL(value))
      ) {
        element.removeAttribute(name);
      }
    });
  });
  return template.innerHTML;
}

export default function RawHtml({ html, tag = 'div', ...props }: RawHtmlProps) {
  const safeHTML = useMemo(() => sanitizeHTML(html), [html]);
  return createElement(tag, {
    ...props,
    dangerouslySetInnerHTML: { __html: safeHTML },
  });
}

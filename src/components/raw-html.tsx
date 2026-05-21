import { createElement, type HTMLAttributes, type Ref } from 'react';

type RawHtmlTag = 'div' | 'span' | 'p' | 'output';

interface RawHtmlProps extends HTMLAttributes<HTMLElement> {
  html: string;
  ref?: Ref<HTMLElement>;
  tag?: RawHtmlTag;
}

export default function RawHtml({
  html,
  tag = 'div',
  ...props
}: RawHtmlProps) {
  return createElement(tag, {
    ...props,
    dangerouslySetInnerHTML: { __html: html },
  });
}

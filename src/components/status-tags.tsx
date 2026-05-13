import type { ComponentChildren, ComponentType } from 'preact';
import { useMemo } from 'preact/hooks';

import { api } from '../utils/api';

import LinkRaw from './link';

interface LinkProps {
  to: string;
  children?: ComponentChildren;
}
const Link = LinkRaw as unknown as ComponentType<LinkProps>;

interface StatusTag {
  name: string;
}

interface StatusTagsProps {
  tags?: StatusTag[];
  content?: string;
}

const fauxDiv = document.createElement('div');
const HASHTAG_REGEX = /^[#＃][^#＃]+$/;
// Keycap "#️⃣" is U+0023 U+FE0F U+20E3 (multi-code-point) — match it via
// alternation so it never appears inside a character class.
const ANOTHER_HASHTAG_REGEX = /^(?:#️⃣|[^#＃])*(?:#️⃣|[#＃])+/u;

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  usage: 'search',
});
const isSameTag = (a: string, b: string) => collator.compare(a, b) === 0;

const extractTagsFromStatus = (content: string | undefined): string[] => {
  if (!content) return [];
  if (content.indexOf('#') === -1) return [];
  fauxDiv.innerHTML = content;
  const tags: string[] = [];

  const allLinks = fauxDiv.querySelectorAll('a[href]');
  for (const link of allLinks) {
    const text = link.textContent.trim();
    const isHashtagLink =
      link.classList.contains('hashtag') || HASHTAG_REGEX.test(text);

    if (isHashtagLink) {
      tags.push(text.replace(ANOTHER_HASHTAG_REGEX, ''));
    }
  }

  return tags;
};

export default function StatusTags({ tags, content }: StatusTagsProps) {
  const { instance } = api();

  const tagsToShow = useMemo(() => {
    if (!tags?.length) return [];
    const hashtagsInContent = extractTagsFromStatus(content);
    if (!hashtagsInContent.length) return tags;
    return tags.filter(
      (tag) => !hashtagsInContent.some((ht) => isSameTag(ht, tag.name)),
    );
  }, [tags, content]);

  if (!tagsToShow.length) return null;

  return (
    <ul class="status-tags">
      {tagsToShow.map((tag) => (
        <li key={tag.name}>
          <Link
            to={
              instance
                ? `/${instance}/t/${encodeURIComponent(tag.name)}`
                : `/t/${encodeURIComponent(tag.name)}`
            }
          >
            <span class="more-insignificant">#</span>
            {tag.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};
const HTML_ESCAPE_REGEX = /[&"<>]/g;

interface EmojiEntry {
  shortcode?: string;
  url?: string;
  staticUrl?: string;
}

function escapeRegex(str: string): string {
  return str.replace(ESCAPE_REGEX, '\\$&');
}

function escapeHTML(str: string): string {
  return str.replace(HTML_ESCAPE_REGEX, (char) => HTML_ESCAPE_MAP[char]);
}

function emojifyText(text: string, emojis: EmojiEntry[] = []): string {
  if (!text) return '';
  if (!emojis.length) return text;
  if (!text.includes(':')) return text;

  // Deduplicate emojis by shortcode and filter out invalid entries
  const emojiMap = new Map<string, EmojiEntry>();
  for (let i = 0; i < emojis.length; i++) {
    const emoji = emojis[i];
    if (emoji?.shortcode && emoji?.url) {
      emojiMap.set(emoji.shortcode, emoji);
    }
  }

  if (emojiMap.size === 0) return text;

  const shortcodes = Array.from(emojiMap.keys());
  const pattern = shortcodes.map((sc) => `:${escapeRegex(sc)}:`).join('|');
  const regex = new RegExp(pattern, 'g');

  return text.replace(regex, (match) => {
    const shortcode = match.slice(1, -1);
    const emoji = emojiMap.get(shortcode);

    if (!emoji) return match;

    const { staticUrl, url } = emoji;
    const escapedShortcode = escapeHTML(match);
    // Emoji metadata is remote/untrusted: a malicious `url`/`staticUrl`/
    // `shortcode` like `x" onerror="alert(1)` would otherwise break out of the
    // double-quoted attribute and inject a live handler. Escape every
    // interpolated attribute value. (Consumers that render this through the
    // DOMPurify sanitizer are already protected, but emojifyText output is also
    // used in the trusted-internal embed-code snippet, which is not.)
    const escapedTitle = escapeHTML(shortcode);
    const escapedUrl = escapeHTML(url ?? '');
    const escapedStaticUrl = staticUrl ? escapeHTML(staticUrl) : '';

    const sourceTag = escapedStaticUrl
      ? `<source srcset="${escapedStaticUrl}" media="(prefers-reduced-motion: reduce)"></source>`
      : '';

    return `<picture>${sourceTag}<img class="shortcode-emoji emoji" src="${escapedUrl}" alt="${escapedShortcode}" title="${escapedTitle}" width="16" height="16" loading="lazy" decoding="async" fetchPriority="low" onload="try { this.dataset.isLarger = this.naturalWidth > (this.width * 2) || this.naturalHeight > (this.height * 2) } catch (e) {}" /></picture>`;
  });
}

export default emojifyText;

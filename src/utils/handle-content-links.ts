import { navigatePath } from './router';
import { isLeafletUrl } from './standard-site';
import states from './states';

const supportsHover = window.matchMedia('(hover: hover)').matches;

interface MentionLike {
  url?: string;
  acct?: string;
  username?: string;
}

interface HandleContentLinksOpts {
  mentions?: MentionLike[];
  instance?: string;
  previewMode?: boolean;
}

// The handler is attached to elements rendering arbitrary status content; the
// element types vary (anchors, images, spans), so we keep DOM access loose and
// rely on the existing runtime guards (closest, contains, optional chaining).
type LinkClickTarget = HTMLElement &
  Partial<HTMLImageElement> &
  Partial<HTMLAnchorElement>;

function handleContentLinks(
  opts?: HandleContentLinksOpts,
): (e: React.MouseEvent) => void {
  const { mentions = [], instance, previewMode } = opts || {};
  return (e: React.MouseEvent) => {
    // If cmd/ctrl/shift/alt key is pressed or middle-click, let the browser handle it
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) {
      return;
    }

    let target = e.target as LinkClickTarget | null;

    // Experiment opening custom emoji in a modal
    // TODO: Rename this function because it's not just for links
    if (target?.closest('.shortcode-emoji')) {
      const { naturalWidth, naturalHeight, width, height } =
        target as HTMLImageElement;
      const kindaLargeRatio = 2;
      const kindaLarge =
        naturalWidth > width * kindaLargeRatio ||
        naturalHeight > height * kindaLargeRatio;
      if (kindaLarge) {
        e.preventDefault();
        e.stopPropagation();
        states.showMediaModal = {
          mediaAttachments: [
            {
              type: 'image',
              url: (target as HTMLImageElement).src,
              description:
                (target as HTMLImageElement).title ||
                (target as HTMLImageElement).alt,
            },
          ],
        };
        return;
      }
    }

    target = target?.closest('a') as LinkClickTarget | null;
    if (!target) return;
    // Only handle links inside, not itself or anything outside
    if (!(e.currentTarget as Node | null)?.contains(target)) return;

    const { href } = target as HTMLAnchorElement;
    if (isLeafletUrl(href)) {
      e.preventDefault();
      e.stopPropagation();
      states.showEmbedModal = {
        iframeUrl: href,
        url: href,
        title: (target as HTMLAnchorElement).innerText.trim() || href,
      };
      return;
    }

    const prevText = target.previousSibling?.textContent;
    const textBeforeLinkIsAt =
      prevText?.endsWith('@') || prevText?.endsWith('＠');
    const targetInnerText = (target as HTMLAnchorElement).innerText;
    const textStartsWithAt =
      targetInnerText.startsWith('@') || targetInnerText.startsWith('＠');
    if (
      ((target.classList.contains('u-url') ||
        target.classList.contains('mention')) &&
        textStartsWithAt) ||
      (textBeforeLinkIsAt && !textStartsWithAt)
    ) {
      const targetText = (
        (target.querySelector('span') as HTMLElement | null) ||
        (target as HTMLElement)
      ).innerText.trim();
      const username = targetText.replace(/^[@＠]/, '');
      // Only fallback to acct/username check if url doesn't match
      const mention =
        mentions.find((m) => m.url === href) ||
        mentions.find((m) => m.acct === username || m.username === username);
      console.warn('MENTION', mention, href);
      if (mention) {
        e.preventDefault();
        e.stopPropagation();
        states.showAccount = {
          account: mention.acct,
          instance,
        };
        return;
      } else if (!/^http/i.test(targetText)) {
        console.log('mention not found', targetText);
        e.preventDefault();
        e.stopPropagation();
        states.showAccount = {
          account: href,
          instance,
        };
        return;
      }
    } else if (!previewMode) {
      const textBeforeLinkIsHash =
        prevText?.endsWith('#') || prevText?.endsWith('＃');
      if (target.classList.contains('hashtag') || textBeforeLinkIsHash) {
        e.preventDefault();
        e.stopPropagation();
        const tag = targetInnerText.replace(/^[#＃]/, '').trim();
        const tagURL = instance ? `/${instance}/t/${tag}` : `/t/${tag}`;
        console.log({ tagURL });
        navigatePath(tagURL);
        return;
      }
    }

    try {
      const urlObj = URL.parse(href);
      if (!urlObj) return;
      const domain = urlObj.hostname.replace(/^www\./i, '');
      const containsDomain = targetInnerText
        .toLowerCase()
        .includes(domain.toLowerCase());
      // Only show this on non-hover devices (touch-only)
      // Assuming that hover-supported = there's a statusbar to see the URL
      // Non-hover devices don't have statusbar, so we show this
      if (!containsDomain && !supportsHover) {
        e.preventDefault();
        e.stopPropagation();
        const linkText = targetInnerText.trim();
        states.showOpenLink = {
          url: href,
          linkText,
        };
      }
    } catch {}
  };
}

export default handleContentLinks;

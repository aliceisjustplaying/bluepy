import getHTMLText from './get-html-text';

interface PollOption {
  title: string;
}

interface PollLike {
  options?: PollOption[];
  multiple?: boolean;
}

interface MediaAttachmentLike {
  type: string;
}

interface StatusLike {
  id?: string;
  spoilerText?: string;
  content?: string;
  poll?: PollLike | null;
  mediaAttachments?: MediaAttachmentLike[] | null;
  quote?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function quotedStatusFromQuote(
  quote: unknown,
): (StatusLike & { id?: string }) | undefined {
  if (!isRecord(quote) || !isRecord(quote.quotedStatus)) return undefined;
  return quote.quotedStatus;
}

function statusPeek(status: StatusLike): string {
  const { spoilerText, content, poll, mediaAttachments, quote } = status;
  let text = '';
  // Don't need supportsNativeQuote because checking quotedStatus ID is enough
  const quotedStatus = quotedStatusFromQuote(quote);
  const hasQuote = !!quotedStatus?.id;
  if (spoilerText?.trim()) {
    text += spoilerText;
  } else {
    text += getHTMLText(content ?? '', {
      preProcess: (dom) => {
        if (hasQuote) {
          const reContainer = dom.querySelector('.quote-inline');
          if (reContainer) {
            reContainer.remove();
          }
        }
      },
    });
  }
  text = text.trim();
  if (poll?.options?.length) {
    text += `\n\n📊:\n${poll.options
      .map((o) => `${poll.multiple ? '▪️' : '•'} ${o.title}`)
      .join('\n')}`;
  }
  if (mediaAttachments?.length) {
    text +=
      ' ' +
      mediaAttachments
        .map(
          (m) =>
            (
              ({
                image: '🖼️',
                gifv: '🎞️',
                video: '📹',
                audio: '🎵',
                unknown: '',
              }) as Record<string, string>
            )[m.type] || '',
        )
        .join('');
  }
  if (hasQuote && quotedStatus) {
    const quotePeek = statusPeek(quotedStatus);
    text += `\n\n❝\n${quotePeek}\n❞`;
  }
  return text;
}

export default statusPeek;

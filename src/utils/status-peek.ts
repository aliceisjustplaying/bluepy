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
  spoilerText?: string;
  content?: string;
  poll?: PollLike | null;
  mediaAttachments?: MediaAttachmentLike[] | null;
  quote?: { quotedStatus?: StatusLike & { id?: string } } | null;
}

function statusPeek(status: StatusLike): string {
  const { spoilerText, content, poll, mediaAttachments, quote } = status;
  let text = '';
  // Don't need supportsNativeQuote because checking quotedStatus ID is enough
  const hasQuote = !!quote?.quotedStatus?.id;
  if (spoilerText?.trim()) {
    text += spoilerText;
  } else {
    text += getHTMLText(content as string, {
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
              {
                image: '🖼️',
                gifv: '🎞️',
                video: '📹',
                audio: '🎵',
                unknown: '',
              } as Record<string, string>
            )[m.type] || '',
        )
        .join('');
  }
  if (hasQuote && quote?.quotedStatus) {
    const quotePeek = statusPeek(quote.quotedStatus);
    text += `\n\n❝\n${quotePeek}\n❞`;
  }
  return text;
}

export default statusPeek;

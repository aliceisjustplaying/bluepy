import type { ComponentChildren } from 'preact';

interface MultipleMediaFigureProps {
  enabled?: boolean;
  children?: ComponentChildren;
  lang?: string;
  captionChildren?: ComponentChildren;
}

function MultipleMediaFigure(props: MultipleMediaFigureProps) {
  const { enabled, children, lang, captionChildren } = props;
  if (!enabled || !captionChildren) return children;
  return (
    <figure class="media-figure-multiple">
      {children}
      <figcaption lang={lang} dir="auto">
        {captionChildren}
      </figcaption>
    </figure>
  );
}

export default MultipleMediaFigure;

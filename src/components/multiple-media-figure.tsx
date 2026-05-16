import type { ReactNode } from 'react';

interface MultipleMediaFigureProps {
  enabled?: boolean;
  children?: ReactNode;
  lang?: string;
  captionChildren?: ReactNode;
}

function MultipleMediaFigure(props: MultipleMediaFigureProps) {
  const { enabled, children, lang, captionChildren } = props;
  if (!enabled || !captionChildren) return children;
  return (
    <figure className="media-figure-multiple">
      {children}
      <figcaption lang={lang} dir="auto">
        {captionChildren}
      </figcaption>
    </figure>
  );
}

export default MultipleMediaFigure;

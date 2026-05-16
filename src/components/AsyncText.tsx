import { useEffect, useState } from 'react';

interface AsyncTextProps {
  children: string | Promise<string>;
}

function AsyncText({ children }: AsyncTextProps) {
  const [text, setText] = useState(
    typeof children === 'string' ? children : '',
  );
  useEffect(() => {
    if (typeof children === 'string') {
      setText(children);
      return undefined;
    }
    let cancelled = false;
    Promise.resolve(children)
      .then((resolved) => {
        if (!cancelled) setText(resolved);
        return undefined;
      })
      .catch((error: unknown) => {
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [children]);
  return text;
}

export default AsyncText;

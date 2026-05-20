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
    void (async () => {
      try {
        const resolved = await children;
        if (!cancelled) setText(resolved);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [children]);
  return text;
}

export default AsyncText;

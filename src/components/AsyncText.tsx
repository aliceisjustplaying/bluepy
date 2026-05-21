import { useEffect, useState } from 'react';

interface AsyncTextProps {
  value: string | Promise<string>;
}

function AsyncText({ value }: AsyncTextProps) {
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  useEffect(() => {
    if (typeof value === 'string') {
      setText(value);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await value;
        if (!cancelled) setText(resolved);
      } catch (error) {
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value]);
  return text;
}

export default AsyncText;

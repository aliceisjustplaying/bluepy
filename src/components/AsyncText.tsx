import { useEffect, useState } from 'preact/hooks';

interface AsyncTextProps {
  children: string | Promise<string>;
}

function AsyncText({ children }: AsyncTextProps) {
  if (typeof children === 'string') return children;
  const [text, setText] = useState('');
  useEffect(() => {
    Promise.resolve(children).then(setText);
  }, [children]);
  return text;
}

export default AsyncText;

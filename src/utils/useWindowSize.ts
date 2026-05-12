import { useLayoutEffect, useState } from 'preact/hooks';

interface WindowSize {
  width: number | null;
  height: number | null;
}

export default function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>({
    width: null,
    height: null,
  });

  useLayoutEffect(() => {
    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize, {
      passive: true,
    });

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return size;
}

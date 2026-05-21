import { useEffect, useState } from 'react';

export default function useCurrentTime(interval = 60_000) {
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  useEffect(() => {
    setCurrentTime(Date.now());
    const intervalId = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, interval);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [interval]);

  return currentTime;
}

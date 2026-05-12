// Rate limit repeated function calls and queue them to set interval
export default function rateLimit<Args extends unknown[]>(
  fn: (this: unknown, ...args: Args) => void,
  interval: number,
): (...args: Args) => void {
  const queue: (() => void)[] = [];
  let isRunning = false;

  function executeNext(): void {
    if (queue.length === 0) {
      isRunning = false;
      return;
    }

    const nextFn = queue.shift();
    if (!nextFn) {
      return;
    }
    nextFn();
    setTimeout(executeNext, interval);
  }

  return function rateLimited(this: unknown, ...args: Args): void {
    const callFn = (): void => {
      fn.apply(this, args);
    };
    queue.push(callFn);

    if (!isRunning) {
      isRunning = true;
      setTimeout(executeNext, interval);
    }
  };
}

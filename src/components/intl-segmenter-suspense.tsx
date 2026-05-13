import { shouldPolyfill } from '@formatjs/intl-segmenter/should-polyfill.js';
import type { ComponentChildren } from 'preact';
import { Suspense } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';

import Loader from './loader';

const supportsIntlSegmenter = !shouldPolyfill();

// Preload IntlSegmenter
setTimeout(() => {
  queueMicrotask(() => {
    if (!supportsIntlSegmenter) {
      import('@formatjs/intl-segmenter/polyfill-force.js').catch(() => {});
    }
  });
}, 1000);

interface IntlSegmenterSuspenseProps {
  children?: ComponentChildren;
}

export default function IntlSegmenterSuspense({
  children,
}: IntlSegmenterSuspenseProps) {
  if (supportsIntlSegmenter) {
    return <Suspense fallback={<Loader />}>{children}</Suspense>;
  }

  const [polyfillLoaded, setPolyfillLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      await import('@formatjs/intl-segmenter/polyfill-force.js');
      setPolyfillLoaded(true);
    })();
  }, []);

  return polyfillLoaded ? (
    <Suspense fallback={<Loader />}>{children}</Suspense>
  ) : (
    <Loader />
  );
}

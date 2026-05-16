import { shouldPolyfill } from '@formatjs/intl-segmenter/should-polyfill.js';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { useEffect, useState } from 'react';

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
  children?: ReactNode;
}

export default function IntlSegmenterSuspense({
  children,
}: IntlSegmenterSuspenseProps) {
  const [polyfillLoaded, setPolyfillLoaded] = useState(supportsIntlSegmenter);
  useEffect(() => {
    if (supportsIntlSegmenter) return;
    void (async () => {
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

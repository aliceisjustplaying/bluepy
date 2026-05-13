import { shouldPolyfill } from '@formatjs/intl-segmenter/should-polyfill.js';
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import Loader from './loader';

const supportsIntlSegmenter = !shouldPolyfill();

type ComposeModule = { default: ComponentType<Record<string, unknown>> };

function importIntlSegmenter() {
  if (!supportsIntlSegmenter) {
    return import('@formatjs/intl-segmenter/polyfill-force.js').catch(() => {});
  }
}

function importCompose(): Promise<ComposeModule> {
  return import('./compose') as unknown as Promise<ComposeModule>;
}

export async function preload() {
  try {
    await importIntlSegmenter();
    importCompose();
  } catch (e) {
    console.error(e);
  }
}

export default function ComposeSuspense(props: Record<string, unknown>) {
  const [Compose, setCompose] = useState<ComposeModule | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (supportsIntlSegmenter) {
          const component = await importCompose();
          setCompose(component);
        } else {
          await importIntlSegmenter();
          const component = await importCompose();
          setCompose(component);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  return Compose?.default ? <Compose.default {...props} /> : <Loader />;
}

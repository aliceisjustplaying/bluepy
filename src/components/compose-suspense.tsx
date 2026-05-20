import { shouldPolyfill } from '@formatjs/intl-segmenter/should-polyfill.js';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';

import Loader from './loader';

const supportsIntlSegmenter = !shouldPolyfill();

type ComposeModule = { default: ComponentType<Record<string, unknown>> };
let composeModulePromise: Promise<ComposeModule> | undefined;

function importIntlSegmenter(): Promise<unknown> {
  if (!supportsIntlSegmenter) {
    return import('@formatjs/intl-segmenter/polyfill-force.js').catch(() => {});
  }
  return Promise.resolve();
}

function importCompose(): Promise<ComposeModule> {
  composeModulePromise ??= (async () => {
    try {
      const mod = await import('./compose');
      const Compose = mod.default;
      const LoadedCompose: ComponentType<Record<string, unknown>> = (props) => (
        <Compose
          {...(props as {
            onClose: Parameters<typeof Compose>[0]['onClose'];
          } & Record<string, unknown>)}
        />
      );
      return { default: LoadedCompose };
    } catch (e) {
      composeModulePromise = undefined;
      throw e;
    }
  })();
  return composeModulePromise;
}

export async function preload() {
  try {
    await importIntlSegmenter();
    try {
      await importCompose();
    } catch (err) {
      console.error(err);
    }
  } catch (e) {
    console.error(e);
  }
}

export default function ComposeSuspense(props: Record<string, unknown>) {
  const [Compose, setCompose] = useState<ComposeModule | null>(null);

  useEffect(() => {
    void (async () => {
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

import { readdirSync } from 'node:fs';

import { formatter } from '@lingui/format-po';

const catalogLocales = readdirSync('src/locales')
  .filter((file) => file.endsWith('.po'))
  .map((file) => file.slice(0, -'.po'.length))
  .toSorted((a, b) => a.localeCompare(b));

const config = {
  locales: catalogLocales,
  sourceLocale: 'en',
  format: formatter({
    origins: true,
    lineNumbers: false,
  }),
  pseudoLocale: 'pseudo-LOCALE',
  fallbackLocales: {
    default: 'en',
  },
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}',
      include: ['src'],
    },
  ],
  // compileNamespace: 'es',
  formatOptions: {
    lineNumbers: false,
  },
  orderBy: 'messageId',
};

export default config;

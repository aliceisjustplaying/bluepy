import Fuse from 'fuse.js';

import { api } from './api';
import pmem from './pmem';

interface CustomEmoji {
  shortcode: string;
  visibleInPicker?: boolean;
  [key: string]: unknown;
}

interface MastoCustomEmojisApi {
  list(): Promise<CustomEmoji[]>;
}

async function _getCustomEmojis(
  instance: string,
): Promise<[CustomEmoji[], Fuse<CustomEmoji>]> {
  const { masto } = api({ instance });
  const emojis = await (
    masto.v1.customEmojis as unknown as MastoCustomEmojisApi
  ).list();
  const visibleEmojis = emojis.filter((e) => e.visibleInPicker);
  const searcher = new Fuse(visibleEmojis, {
    keys: ['shortcode'],
    findAllMatches: true,
  });
  return [visibleEmojis, searcher];
}

const getCustomEmojis = pmem(_getCustomEmojis, {
  // Limit by time to reduce memory usage
  expires: 30 * 60 * 1000, // 30 minutes
});

export { getCustomEmojis, _getCustomEmojis };
export default getCustomEmojis;

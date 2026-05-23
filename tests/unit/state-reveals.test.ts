import { describe, expect, test } from 'bun:test';

import { useRevealsStore } from '../../src/state/reveals';

describe('useRevealsStore', () => {
  test('tracks text and media spoilers separately', () => {
    useRevealsStore.setState({
      spoilers: {},
      spoilersMedia: {},
      revealedQuotes: {},
      revealedMutedPosts: {},
    });

    useRevealsStore.getState().revealSpoiler('post-1');
    useRevealsStore.getState().revealSpoiler('post-2', true);

    expect(useRevealsStore.getState().isSpoilerRevealed('post-1')).toBe(true);
    expect(useRevealsStore.getState().isSpoilerRevealed('post-1', true)).toBe(
      false,
    );
    expect(useRevealsStore.getState().isSpoilerRevealed('post-2', true)).toBe(
      true,
    );
  });

  test('hideSpoiler clears the matching reveal map', () => {
    useRevealsStore.setState({
      spoilers: { 'post-1': true },
      spoilersMedia: { 'post-1': true },
      revealedQuotes: {},
      revealedMutedPosts: {},
    });

    useRevealsStore.getState().hideSpoiler('post-1', true);

    expect(useRevealsStore.getState().isSpoilerRevealed('post-1')).toBe(true);
    expect(useRevealsStore.getState().isSpoilerRevealed('post-1', true)).toBe(
      false,
    );
  });
});

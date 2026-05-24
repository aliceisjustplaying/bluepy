import { create } from 'zustand';

export interface RevealsState {
  spoilers: Record<string, boolean>;
  spoilersMedia: Record<string, boolean>;
  revealedQuotes: Record<string, unknown>;
  revealedMutedPosts: Record<string, boolean>;
  revealSpoiler: (id: string, media?: boolean) => void;
  hideSpoiler: (id: string, media?: boolean) => void;
  revealQuote: (id: string, value: unknown) => void;
  revealMutedPost: (id: string) => void;
  isSpoilerRevealed: (id: string, media?: boolean) => boolean;
  isQuoteRevealed: (id: string) => boolean;
  isMutedPostRevealed: (id: string) => boolean;
}

export const useRevealsStore = create<RevealsState>()((set, get) => ({
  spoilers: {},
  spoilersMedia: {},
  revealedQuotes: {},
  revealedMutedPosts: {},
  revealSpoiler: (id, media = false) => {
    set((state) => {
      if (media) {
        if (state.spoilersMedia[id]) return state;
        return {
          spoilersMedia: { ...state.spoilersMedia, [id]: true },
        };
      }
      if (state.spoilers[id]) return state;
      return {
        spoilers: { ...state.spoilers, [id]: true },
      };
    });
  },
  hideSpoiler: (id, media = false) => {
    set((state) => {
      if (media) {
        const next = { ...state.spoilersMedia };
        delete next[id];
        return { spoilersMedia: next };
      }
      const next = { ...state.spoilers };
      delete next[id];
      return { spoilers: next };
    });
  },
  revealQuote: (id, value) => {
    if (get().revealedQuotes[id] === value) return;
    set((state) => ({
      revealedQuotes: { ...state.revealedQuotes, [id]: value },
    }));
  },
  revealMutedPost: (id) => {
    if (get().revealedMutedPosts[id]) return;
    set((state) => ({
      revealedMutedPosts: { ...state.revealedMutedPosts, [id]: true },
    }));
  },
  isSpoilerRevealed: (id, media = false) => {
    const state = get();
    if (media) return state.spoilersMedia[id] ?? false;
    return state.spoilers[id] ?? false;
  },
  isQuoteRevealed: (id) => id in get().revealedQuotes,
  isMutedPostRevealed: (id) => get().revealedMutedPosts[id] ?? false,
}));

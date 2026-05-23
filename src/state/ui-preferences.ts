import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useActiveDid } from '../contexts/SessionProvider';
import {
  DEFAULT_MUTED_POST_VISIBILITY,
  getMutedPostVisibility,
  type MutedPostVisibility,
} from '../utils/muted-post-visibility';
import {
  persistShortcutsColumnsMode,
  persistShortcutsViewMode,
  restoreShortcutsColumnsMode,
  restoreShortcutsViewMode,
} from '../utils/settings-storage';

export interface UiPreferences {
  autoRefresh: boolean;
  shortcutsViewMode: string | null;
  shortcutsColumnsMode: boolean;
  boostsCarousel: boolean;
  contentTranslation: boolean;
  contentTranslationTargetLanguage: string | null;
  contentTranslationHideLanguages: string[];
  contentTranslationAutoInline: boolean;
  mediaAltGenerator: boolean;
  composerGIFPicker: boolean;
  cloakMode: boolean;
  noAnimations: boolean;
  mutedPostVisibility: MutedPostVisibility;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  autoRefresh: false,
  shortcutsViewMode: null,
  shortcutsColumnsMode: false,
  boostsCarousel: true,
  contentTranslation: true,
  contentTranslationTargetLanguage: null,
  contentTranslationHideLanguages: [],
  contentTranslationAutoInline: false,
  mediaAltGenerator: false,
  composerGIFPicker: false,
  cloakMode: false,
  noAnimations: false,
  mutedPostVisibility: DEFAULT_MUTED_POST_VISIBILITY,
};

interface UiPreferencesState {
  byDid: Record<string, UiPreferences>;
  getForDid: (did: string) => UiPreferences;
  setForDid: (did: string, patch: Partial<UiPreferences>) => void;
  setFieldForDid: <K extends keyof UiPreferences>(
    did: string,
    field: K,
    value: UiPreferences[K],
  ) => void;
  importLegacyForDid: (
    did: string,
    legacy: Partial<UiPreferences>,
  ) => UiPreferences;
}

function mergePreferences(
  current: UiPreferences,
  patch: Partial<UiPreferences>,
): UiPreferences {
  const next = { ...current, ...patch };
  next.mutedPostVisibility = getMutedPostVisibility({
    mutedPostVisibility: next.mutedPostVisibility,
  });
  next.shortcutsViewMode = persistShortcutsViewMode(next.shortcutsViewMode);
  next.shortcutsColumnsMode = persistShortcutsColumnsMode(
    next.shortcutsColumnsMode,
  );
  return next;
}

function applyBodyClasses(preferences: UiPreferences): void {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('no-animations', preferences.noAnimations);
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set, get) => ({
      byDid: {},
      getForDid: (did) => get().byDid[did] ?? DEFAULT_UI_PREFERENCES,
      setForDid: (did, patch) => {
        set((state) => {
          const current = state.byDid[did] ?? DEFAULT_UI_PREFERENCES;
          const next = mergePreferences(current, patch);
          applyBodyClasses(next);
          return {
            byDid: {
              ...state.byDid,
              [did]: next,
            },
          };
        });
      },
      setFieldForDid: (did, field, value) => {
        get().setForDid(did, { [field]: value } as Partial<UiPreferences>);
      },
      importLegacyForDid: (did, legacy) => {
        const restoredViewMode = restoreShortcutsViewMode(
          legacy.shortcutsViewMode ?? null,
          restoreShortcutsColumnsMode(legacy.shortcutsColumnsMode ?? false),
        );
        const merged = mergePreferences(DEFAULT_UI_PREFERENCES, {
          ...legacy,
          shortcutsViewMode: restoredViewMode,
          shortcutsColumnsMode: restoreShortcutsColumnsMode(
            legacy.shortcutsColumnsMode ?? false,
          ),
          mutedPostVisibility: getMutedPostVisibility({
            mutedPostVisibility: legacy.mutedPostVisibility,
          }),
        });
        set((state) => ({
          byDid: {
            ...state.byDid,
            [did]: merged,
          },
        }));
        return merged;
      },
    }),
    {
      name: 'bluepy:ui-preferences',
      partialize: (state) => ({ byDid: state.byDid }),
    },
  ),
);

export function useUiPreferences(): {
  data: UiPreferences;
  setPreference: <K extends keyof UiPreferences>(
    field: K,
    value: UiPreferences[K],
  ) => void;
  setPreferences: (patch: Partial<UiPreferences>) => void;
} {
  const activeDid = useActiveDid();
  const data = useUiPreferencesStore((state) =>
    activeDid
      ? state.getForDid(activeDid)
      : DEFAULT_UI_PREFERENCES,
  );
  const setForDid = useUiPreferencesStore((state) => state.setForDid);
  const setFieldForDid = useUiPreferencesStore((state) => state.setFieldForDid);

  return {
    data,
    setPreference: (field, value) => {
      if (!activeDid) return;
      setFieldForDid(activeDid, field, value);
    },
    setPreferences: (patch) => {
      if (!activeDid) return;
      setForDid(activeDid, patch);
    },
  };
}

export function bootstrapUiPreferencesForDid(
  did: string,
  legacy: Partial<UiPreferences>,
): UiPreferences {
  const existing = useUiPreferencesStore.getState().byDid[did];
  if (existing) {
    applyBodyClasses(existing);
    return existing;
  }
  const imported = useUiPreferencesStore
    .getState()
    .importLegacyForDid(did, legacy);
  applyBodyClasses(imported);
  return imported;
}

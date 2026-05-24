import { AppBskyActorDefs } from '@atproto/api';

import type { SavedFeed, SavedFeedKind } from './reconcile-shortcuts';

export interface NormalizedPreferences {
  adultContentEnabled: boolean;
  adultContent: boolean;
  contentLabels: AppBskyActorDefs.ContentLabelPref[];
  savedFeeds: SavedFeed[];
  mutedWords: AppBskyActorDefs.MutedWord[];
  threadView: AppBskyActorDefs.ThreadViewPref | undefined;
  feedView: AppBskyActorDefs.FeedViewPref[];
  postInteractionSettings:
    | AppBskyActorDefs.PostInteractionSettingsPref
    | undefined;
  hiddenPosts: string[];
  personalDetails: AppBskyActorDefs.PersonalDetailsPref | undefined;
  declaredAge: AppBskyActorDefs.DeclaredAgePref | undefined;
  labelers: AppBskyActorDefs.LabelerPrefItem[];
}

function toSavedFeedKind(type: AppBskyActorDefs.SavedFeed['type']): SavedFeedKind {
  if (type === 'feed') return 'feed';
  if (type === 'list') return 'list';
  if (type === 'timeline') return 'timeline';
  return 'feed';
}

function toSavedFeed(item: AppBskyActorDefs.SavedFeed): SavedFeed {
  return {
    id: item.id,
    type: toSavedFeedKind(item.type),
    value: item.value,
    pinned: item.pinned ?? false,
  };
}

function isOverAge18(
  birthDate: string | undefined,
  declaredAge: AppBskyActorDefs.DeclaredAgePref | undefined,
): boolean {
  if (declaredAge?.isOverAge18 === false) return false;
  if (declaredAge?.isOverAge18 === true) return true;
  if (!birthDate) return true;

  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return true;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getDate() < birth.getDate())
  ) {
    age -= 1;
  }
  return age >= 18;
}

export function resolveAdultContent(
  adultContentEnabled: boolean,
  personalDetails: AppBskyActorDefs.PersonalDetailsPref | undefined,
  declaredAge: AppBskyActorDefs.DeclaredAgePref | undefined,
): boolean {
  if (!isOverAge18(personalDetails?.birthDate, declaredAge)) {
    return false;
  }
  return adultContentEnabled;
}

export function normalizePreferences(
  prefs: AppBskyActorDefs.Preferences,
): NormalizedPreferences {
  let adultContentEnabled = false;
  const contentLabels: AppBskyActorDefs.ContentLabelPref[] = [];
  let savedFeeds: SavedFeed[] = [];
  let mutedWords: AppBskyActorDefs.MutedWord[] = [];
  let threadView: AppBskyActorDefs.ThreadViewPref | undefined;
  const feedView: AppBskyActorDefs.FeedViewPref[] = [];
  let postInteractionSettings:
    | AppBskyActorDefs.PostInteractionSettingsPref
    | undefined;
  let hiddenPosts: string[] = [];
  let personalDetails: AppBskyActorDefs.PersonalDetailsPref | undefined;
  let declaredAge: AppBskyActorDefs.DeclaredAgePref | undefined;
  let labelers: AppBskyActorDefs.LabelerPrefItem[] = [];

  for (const pref of prefs) {
    if (AppBskyActorDefs.isAdultContentPref(pref)) {
      adultContentEnabled = pref.enabled;
    } else if (AppBskyActorDefs.isContentLabelPref(pref)) {
      contentLabels.push(pref);
    } else if (AppBskyActorDefs.isSavedFeedsPrefV2(pref)) {
      savedFeeds = pref.items.map(toSavedFeed);
    } else if (AppBskyActorDefs.isMutedWordsPref(pref)) {
      mutedWords = pref.items;
    } else if (AppBskyActorDefs.isThreadViewPref(pref)) {
      threadView = pref;
    } else if (AppBskyActorDefs.isFeedViewPref(pref)) {
      feedView.push(pref);
    } else if (AppBskyActorDefs.isPostInteractionSettingsPref(pref)) {
      postInteractionSettings = pref;
    } else if (AppBskyActorDefs.isHiddenPostsPref(pref)) {
      hiddenPosts = pref.items;
    } else if (AppBskyActorDefs.isPersonalDetailsPref(pref)) {
      personalDetails = pref;
    } else if (AppBskyActorDefs.isDeclaredAgePref(pref)) {
      declaredAge = pref;
    } else if (AppBskyActorDefs.isLabelersPref(pref)) {
      labelers = pref.labelers;
    }
  }

  const adultContent = resolveAdultContent(
    adultContentEnabled,
    personalDetails,
    declaredAge,
  );

  return {
    adultContentEnabled,
    adultContent,
    contentLabels,
    savedFeeds,
    mutedWords,
    threadView,
    feedView,
    postInteractionSettings,
    hiddenPosts,
    personalDetails,
    declaredAge,
    labelers,
  };
}

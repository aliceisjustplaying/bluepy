import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';

function patchCount(
  count: number | undefined,
  wasEnabled: boolean,
  enabled: boolean,
): number | undefined {
  if (wasEnabled === enabled) return count;
  return Math.max(0, (count ?? 0) + (enabled ? 1 : -1));
}

export function patchPostLike(
  post: AppBskyFeedDefs.PostView,
  liked: boolean,
  likeUri?: string,
): AppBskyFeedDefs.PostView {
  const viewer = post.viewer ?? {};
  const wasLiked = Boolean(viewer.like);
  return {
    ...post,
    likeCount: patchCount(post.likeCount, wasLiked, liked),
    viewer: {
      ...viewer,
      like: liked ? (likeUri ?? viewer.like ?? post.uri) : undefined,
    },
  };
}

export function patchPostRepost(
  post: AppBskyFeedDefs.PostView,
  reposted: boolean,
  repostUri?: string,
): AppBskyFeedDefs.PostView {
  const viewer = post.viewer ?? {};
  const wasReposted = Boolean(viewer.repost);
  return {
    ...post,
    repostCount: patchCount(post.repostCount, wasReposted, reposted),
    viewer: {
      ...viewer,
      repost: reposted ? (repostUri ?? viewer.repost ?? post.uri) : undefined,
    },
  };
}

export function patchPostBookmark(
  post: AppBskyFeedDefs.PostView,
  bookmarked: boolean,
): AppBskyFeedDefs.PostView {
  const viewer = post.viewer ?? {};
  const wasBookmarked = Boolean(viewer.bookmarked);
  return {
    ...post,
    bookmarkCount: patchCount(post.bookmarkCount, wasBookmarked, bookmarked),
    viewer: {
      ...viewer,
      bookmarked: bookmarked ? true : undefined,
    },
  };
}

export function patchProfileFollow(
  profile: AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed,
  following: boolean,
  followUri?: string,
): AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed {
  const viewer = profile.viewer ?? {};
  return {
    ...profile,
    viewer: {
      ...viewer,
      following: following
        ? (followUri ?? viewer.following ?? profile.did)
        : undefined,
    },
  };
}

export function patchProfileMute(
  profile: AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed,
  muted: boolean,
): AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed {
  const viewer = profile.viewer ?? {};
  return {
    ...profile,
    viewer: {
      ...viewer,
      muted,
    },
  };
}

export function patchProfileBlock(
  profile: AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed,
  blocked: boolean,
  blockUri?: string,
): AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed {
  const viewer = profile.viewer ?? {};
  return {
    ...profile,
    viewer: {
      ...viewer,
      blocking: blocked
        ? (blockUri ?? viewer.blocking ?? profile.did)
        : undefined,
    },
  };
}

export type PostPatcher = (
  post: AppBskyFeedDefs.PostView,
) => AppBskyFeedDefs.PostView;

export type ProfilePatcher = (
  profile: AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed,
) => AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed;

export function applyPostPatcher(
  post: AppBskyFeedDefs.PostView,
  patcher: PostPatcher,
): AppBskyFeedDefs.PostView {
  return patcher(post);
}

export function applyProfilePatcher(
  profile: AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed,
  patcher: ProfilePatcher,
): AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed {
  return patcher(profile);
}

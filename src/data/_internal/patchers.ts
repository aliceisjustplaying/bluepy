import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';

export function patchPostLike(
  post: AppBskyFeedDefs.PostView,
  liked: boolean,
): AppBskyFeedDefs.PostView {
  const viewer = post.viewer ?? {};
  return {
    ...post,
    likeCount: Math.max(0, (post.likeCount ?? 0) + (liked ? 1 : -1)),
    viewer: {
      ...viewer,
      like: liked ? post.uri : undefined,
    },
  };
}

export function patchPostRepost(
  post: AppBskyFeedDefs.PostView,
  reposted: boolean,
  repostUri?: string,
): AppBskyFeedDefs.PostView {
  const viewer = post.viewer ?? {};
  return {
    ...post,
    repostCount: Math.max(0, (post.repostCount ?? 0) + (reposted ? 1 : -1)),
    viewer: {
      ...viewer,
      repost: reposted ? repostUri ?? post.uri : undefined,
    },
  };
}

export function patchPostBookmark(
  post: AppBskyFeedDefs.PostView,
  bookmarked: boolean,
): AppBskyFeedDefs.PostView {
  const viewer = post.viewer ?? {};
  return {
    ...post,
    bookmarkCount: Math.max(
      0,
      (post.bookmarkCount ?? 0) + (bookmarked ? 1 : -1),
    ),
    viewer: {
      ...viewer,
      bookmarked,
    },
  };
}

export function patchProfileFollow(
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed,
  following: boolean,
  followUri?: string,
): AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed {
  const viewer = profile.viewer ?? {};
  return {
    ...profile,
    viewer: {
      ...viewer,
      following: following ? followUri ?? profile.did : undefined,
    },
  };
}

export function patchProfileMute(
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed,
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
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed,
  blocked: boolean,
  blockUri?: string,
): AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed {
  const viewer = profile.viewer ?? {};
  return {
    ...profile,
    viewer: {
      ...viewer,
      blocking: blocked ? blockUri ?? profile.did : undefined,
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
):
  | AppBskyActorDefs.ProfileView
  | AppBskyActorDefs.ProfileViewDetailed {
  return patcher(profile);
}

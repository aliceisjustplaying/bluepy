import {
  AppBskyEmbedImages,
  AppBskyEmbedRecordWithMedia,
  AppBskyEmbedVideo,
  type AppBskyFeedDefs,
} from '@atproto/api';

export function postHasMedia(post: AppBskyFeedDefs.PostView | undefined): boolean {
  const embed = post?.embed;
  if (!embed) return false;
  if (AppBskyEmbedImages.isView(embed) || AppBskyEmbedVideo.isView(embed)) {
    return true;
  }
  return (
    AppBskyEmbedRecordWithMedia.isView(embed) &&
    (AppBskyEmbedImages.isView(embed.media) ||
      AppBskyEmbedVideo.isView(embed.media))
  );
}

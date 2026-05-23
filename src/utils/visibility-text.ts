import { msg } from '@lingui/core/macro';

const visibilityText = {
  direct: msg`Private mention`,
  local: msg`Local`,
  private: msg`Followers`,
  public: msg`Public`,
  unlisted: msg`Quiet public`,
  nobody: msg`Nobody can reply`,
  mention: msg`Only people you mention can reply`,
  following: msg`Only people you follow can reply`,
  followers: msg`Only your followers can reply`,
  everybody: msg`Everybody can reply`,
  followers_following_mention: msg`Followers, followed people, and mentioned people can reply`,
  followers_following: msg`Followers and followed people can reply`,
  followers_mention: msg`Followers and mentioned people can reply`,
  following_mention: msg`Followed people and mentioned people can reply`,
  list: msg`List members can reply`,
  followers_list: msg`Followers and list members can reply`,
  following_list: msg`Followed people and list members can reply`,
  mention_list: msg`Mentioned people and list members can reply`,
  followers_following_list: msg`Followers, followed people, and list members can reply`,
  followers_mention_list: msg`Followers, mentioned people, and list members can reply`,
  following_mention_list: msg`Followed people, mentioned people, and list members can reply`,
  followers_following_mention_list: msg`Followers, followed people, mentioned people, and list members can reply`,
} as const;

export default visibilityText;

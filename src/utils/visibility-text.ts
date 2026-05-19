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
} as const;

export default visibilityText;

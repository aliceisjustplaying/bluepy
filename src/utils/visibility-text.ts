import { msg } from '@lingui/core/macro';

const visibilityText = {
  direct: msg`Private mention`,
  local: msg`Local`,
  private: msg`Followers`,
  public: msg`Public`,
  unlisted: msg`Quiet public`,
} as const;

export default visibilityText;

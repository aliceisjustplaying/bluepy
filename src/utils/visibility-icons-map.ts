const visibilityIconsMap = {
  direct: 'message',
  local: 'building',
  private: 'lock',
  public: 'earth',
  unlisted: 'moon',
  nobody: 'block',
  mention: 'message',
  following: 'group',
  followers: 'lock',
  everybody: 'earth',
} as const;

export default visibilityIconsMap;

const supportedFeatures = new Set([
  '@atproto',
  '@atproto/fetch-multiple-posts',
  '@atproto/home-include-reposts',
  '@atproto/lists',
  '@atproto/post-bookmark',
  '@atproto/profile-edit',
]);

function supports(feature: string): boolean {
  return supportedFeatures.has(feature);
}

export default supports;

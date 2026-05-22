const ATPROTO_FEATURE_PREFIXES = ['@atproto', '@bluesky'];

function supports(feature: string): boolean {
  return ATPROTO_FEATURE_PREFIXES.some(
    (prefix) => feature === prefix || feature.startsWith(`${prefix}/`),
  );
}

export default supports;

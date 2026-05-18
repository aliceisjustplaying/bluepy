import { satisfies } from 'compare-versions';

import features from '../data/features.json';

import { getCurrentInstance, getCurrentNodeInfo } from './store-utils';

type SatisfiesWithOptions = (
  version: string | undefined,
  range: string,
  options?: { includePrerelease?: boolean; loose?: boolean },
) => boolean;

type SatisfiesCompat = (
  version: string,
  range: string,
  options?: { includePrerelease?: boolean; loose?: boolean },
) => boolean;

const satisfiesCompat: SatisfiesCompat = satisfies;
const satisfiesVersion: SatisfiesWithOptions = (version, range, options) => {
  if (version === undefined) {
    throw new TypeError('Expected version for semver comparison');
  }
  return satisfiesCompat(version, range, options);
};
const featuresMap = features as Record<string, string | undefined>;

// Non-semver(?) UA string detection
const containPixelfed = /pixelfed/i;
const notContainPixelfed = /^(?!.*pixelfed).*$/i;
const containPleroma = /pleroma/i;
const containAkkoma = /akkoma/i;
const platformFeatures: Record<string, RegExp> = {
  '@mastodon/lists': notContainPixelfed,
  '@mastodon/mentions': notContainPixelfed,
  '@mastodon/trending-hashtags': notContainPixelfed,
  '@mastodon/trending-links': notContainPixelfed,
  '@mastodon/post-bookmark': notContainPixelfed,
  '@mastodon/post-edit': notContainPixelfed,
  '@mastodon/profile-edit': notContainPixelfed,
  '@mastodon/profile-private-note': notContainPixelfed,
  '@mastodon/pinned-posts': notContainPixelfed,
  '@pixelfed/trending': containPixelfed,
  '@pixelfed/home-include-reblogs': containPixelfed,
  '@pixelfed/global-feed': containPixelfed,
  '@pleroma/local-visibility-post': containPleroma,
  '@akkoma/local-visibility-post': containAkkoma,
};

const supportsCache: Record<string, boolean> = {};
const bskyUnsupportedFeatures = new Set<string>([
  '@mastodon/endorsements',
  '@mastodon/pinned-posts',
  '@mastodon/post-edit',
  '@mastodon/profile-private-note',
  '@mastodon/trending-hashtags',
  '@mastodon/trending-links',
]);

const semverExtract = /^\d+\.\d+(\.\d+)?/;
const atSoftwareSlashMatch = /^@([a-z]+)\//i;

function supports(feature: string): boolean {
  try {
    const instance = getCurrentInstance() as {
      version?: string;
      domain?: string;
    };
    const { version, domain } = instance;
    const nodeInfo = getCurrentNodeInfo() as {
      software?: { name?: string };
    };
    let softwareName = nodeInfo?.software?.name || 'mastodon';

    if (domain === 'bsky.social' && bskyUnsupportedFeatures.has(feature)) {
      return false;
    }

    if (softwareName === 'hometown') {
      // Hometown is a Mastodon fork and inherits its features
      softwareName = 'mastodon';
    }

    const key = `${domain}-${feature}`;
    if (key in supportsCache) return supportsCache[key];

    if (platformFeatures[feature]) {
      return (supportsCache[key] = platformFeatures[feature].test(
        version as string,
      ));
    }

    const featureMatch = feature.match(atSoftwareSlashMatch);
    if (!featureMatch) {
      // Only software match, e.g. supports('@mastodon')
      const software = feature.replace(/^@/, '');
      return (supportsCache[key] = softwareName === software);
    }

    const range = featuresMap[feature];
    if (!range) return false;

    // '@mastodon/blah' => 'mastodon'
    const featureSoftware = featureMatch[1];

    const doesSoftwareMatch = featureSoftware === softwareName.toLowerCase();
    let satisfiesRange = satisfiesVersion(version, range, {
      includePrerelease: true,
      loose: true,
    });
    if (!satisfiesRange) {
      try {
        // E.g. "4.2.1 (compatible; Iceshrimp 2023.12.14-dev-046d237af)" is invalid semver 😅
        // This regex extracts numbers with dots out and tries again
        // Hopefully this doesn't break anything
        satisfiesRange = satisfiesVersion(
          (version as string).match(semverExtract)?.[0],
          range,
          {
            includePrerelease: true,
            loose: false,
          },
        );
      } catch {
        // Ignore
      }
    }
    return (supportsCache[key] = doesSoftwareMatch && satisfiesRange);
  } catch {
    return false;
  }
}

export default supports;

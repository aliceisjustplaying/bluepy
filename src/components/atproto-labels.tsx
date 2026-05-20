import './atproto-labels.css';

import { useLingui } from '@lingui/react/macro';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { getPreferenceSnapshot, subscribePreferences } from '../utils/api';
import {
  createAtprotoLabelerInfoCache,
  fetchCachedAtprotoLabelerInfo,
} from '../utils/atproto-labeler-cache';
import {
  type AtprotoGlobalLabelStrings,
  type AtprotoLabelerInfo,
  type AtprotoLabelerInfoMap,
  describeAtprotoLabel,
  getDisplayAtprotoLabels,
  getAtprotoLabelDefinitions,
  getAtprotoLabelerInfoMap,
} from '../utils/atproto-labels';

import Avatar from './avatar';

interface AtprotoLabelsProps {
  labels?: unknown;
  sourceProfiles?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function getOwn<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

const sharedLabelerCache = createAtprotoLabelerInfoCache();

function getSourceProfileInfo(
  profile: unknown,
): AtprotoLabelerInfo | undefined {
  if (!isRecord(profile)) return undefined;
  const id = getString(profile.id);
  const uri = getString(profile.uri);
  const did = id?.startsWith('did:')
    ? id
    : uri?.startsWith('did:')
      ? uri
      : undefined;
  if (!did) return undefined;
  return {
    did,
    handle: getString(profile.acct) ?? getString(profile.username),
    displayName: getString(profile.displayName),
    avatar: getString(profile.avatarStatic) ?? getString(profile.avatar),
  };
}

function getLabelerInfoFromView(view: unknown): AtprotoLabelerInfo | undefined {
  if (!isRecord(view) || !isRecord(view.creator)) return undefined;
  const did = getString(view.creator.did);
  if (!did) return undefined;
  return {
    did,
    handle: getString(view.creator.handle),
    displayName: getString(view.creator.displayName),
    avatar: getString(view.creator.avatar),
  };
}

function getSourceProfileMap(sourceProfiles: unknown): AtprotoLabelerInfoMap {
  const profiles = Array.isArray(sourceProfiles)
    ? sourceProfiles
    : [sourceProfiles];
  return Object.fromEntries(
    profiles.flatMap((profile) => {
      const info = getSourceProfileInfo(profile);
      return info ? [[info.did, info]] : [];
    }),
  );
}

async function fetchPublicLabelerInfo(
  dids: readonly string[],
): Promise<AtprotoLabelerInfoMap> {
  if (!dids.length) return {};
  const params = new URLSearchParams({ detailed: 'false' });
  dids.forEach((did) => {
    params.append('dids', did);
  });
  const res = await fetch(
    `https://public.api.bsky.app/xrpc/app.bsky.labeler.getServices?${params}`,
  );
  if (!res.ok) throw new Error('Failed to fetch labeler info');
  const json: unknown = await res.json();
  if (!isRecord(json) || !Array.isArray(json.views)) return {};
  return Object.fromEntries(
    json.views.flatMap((view) => {
      const info = getLabelerInfoFromView(view);
      return info ? [[info.did, info]] : [];
    }),
  );
}

async function fetchPublicLabelerInfoCached(
  dids: readonly string[],
): Promise<AtprotoLabelerInfoMap> {
  return fetchCachedAtprotoLabelerInfo(
    dids,
    sharedLabelerCache,
    fetchPublicLabelerInfo,
  );
}

export default function AtprotoLabels({
  labels,
  sourceProfiles,
}: AtprotoLabelsProps) {
  const { i18n, t } = useLingui();
  const [fetchedLabelers, setFetchedLabelers] = useState<AtprotoLabelerInfoMap>(
    () => ({ ...sharedLabelerCache.fetchedLabelers }),
  );
  const preferences = useSyncExternalStore(
    subscribePreferences,
    getPreferenceSnapshot,
    getPreferenceSnapshot,
  );
  const mounted = useRef(true);
  const globalLabelStrings = useMemo<AtprotoGlobalLabelStrings>(
    () => ({
      porn: {
        name: t`Adult Content`,
        description: t`Explicit sexual images.`,
      },
      sexual: {
        name: t`Sexually Suggestive`,
        description: t`Does not include nudity.`,
      },
      nudity: {
        name: t`Non-sexual Nudity`,
        description: t`E.g. artistic nudes.`,
      },
      'graphic-media': {
        name: t`Graphic Media`,
        description: t`Explicit or potentially disturbing media.`,
      },
      gore: {
        name: t`Graphic Media`,
        description: t`Explicit or potentially disturbing media.`,
      },
      bot: {
        name: t`Automated`,
        description: t`This account has marked itself as automated.`,
      },
    }),
    [t],
  );
  const visibleLabels = useMemo(
    () => getDisplayAtprotoLabels(labels),
    [labels],
  );

  const labelDefs = getAtprotoLabelDefinitions(preferences);
  const preferenceLabelerInfo = useMemo(
    () => getAtprotoLabelerInfoMap(preferences),
    [preferences],
  );
  const sourceProfileInfo = useMemo(
    () => getSourceProfileMap(sourceProfiles),
    [sourceProfiles],
  );
  const labelerInfo = useMemo(
    () => ({
      ...preferenceLabelerInfo,
      ...fetchedLabelers,
      ...sourceProfileInfo,
    }),
    [fetchedLabelers, preferenceLabelerInfo, sourceProfileInfo],
  );
  const missingLabelerDids = useMemo(
    () =>
      uniqueStrings(
        visibleLabels
          .map((label) => label.src)
          .filter((did) => did.startsWith('did:') && !getOwn(labelerInfo, did)),
      ),
    [labelerInfo, visibleLabels],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!missingLabelerDids.length) return undefined;
    const fetchLabelers = async () => {
      try {
        const nextLabelers =
          await fetchPublicLabelerInfoCached(missingLabelerDids);
        if (!mounted.current) return undefined;
        if (Object.keys(nextLabelers).length) {
          setFetchedLabelers((current) => ({ ...current, ...nextLabelers }));
        }
      } catch {
        // Abort and transient network failures leave the chip without source art.
      }
      return undefined;
    };
    void fetchLabelers();
    return undefined;
  }, [missingLabelerDids]);

  if (!visibleLabels.length) return null;

  return (
    <div className="atproto-labels">
      {visibleLabels.map((label) => {
        const labeler = getOwn(labelerInfo, label.src);
        const info = describeAtprotoLabel(
          label,
          labelDefs,
          i18n.locale,
          globalLabelStrings,
        );
        return (
          <span
            className={`atproto-label atproto-label-${info.severity}`}
            key={`${label.src}:${label.val}:${label.uri}`}
            title={info.description}
          >
            {!!labeler && (
              <span className="atproto-label-avatar">
                <Avatar
                  alt={labeler.displayName ?? labeler.handle ?? labeler.did}
                  size={14}
                  url={labeler.avatar}
                />
              </span>
            )}
            {info.name}
          </span>
        );
      })}
    </div>
  );
}

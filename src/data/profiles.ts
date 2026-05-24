import type { AppBskyActorDefs } from '@atproto/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';
import {
  profileHasCounts,
  type AtprotoProfileView,
} from '../utils/atproto-profile-shape';

import { feedReadMode } from './_internal/dispatch';
import {
  invalidateCachedProfileForViewer,
  patchCachedProfileForViewer,
} from './_internal/mutation-cache';
import {
  patchProfileBlock,
  patchProfileFollow,
  patchProfileMute,
} from './_internal/patchers';
import { primeProfiles } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent, getWriteAgent } from './clients';
import { keys } from './keys';
import { useViewerScope } from './scope';

const DIRECT_ROUTE_STALE_TIME = 60_000;
const PROFILE_GRAPH_LIMIT = 80;

interface ProfileMutationVars {
  did: string;
  recordUri?: string;
}

interface ProfileMutationContext {
  rollback?: () => void;
}

type RelationshipRecordKey = 'following' | 'blocking';

const RELATIONSHIP_COLLECTIONS: Record<RelationshipRecordKey, string> = {
  following: 'app.bsky.graph.follow',
  blocking: 'app.bsky.graph.block',
};

function atprotoRkey(uri: string): string {
  return uri.split('/').pop() ?? '';
}

function recordUriForCollection(
  uri: string | undefined,
  collection: string,
): string | undefined {
  return uri?.includes(`/${collection}/`) ? uri : undefined;
}

function getRelationshipRecordUri(
  relationship: unknown,
  key: RelationshipRecordKey,
): string | undefined {
  if (typeof relationship !== 'object' || relationship === null) {
    return undefined;
  }
  const value = (relationship as Record<RelationshipRecordKey, unknown>)[key];
  return typeof value === 'string'
    ? recordUriForCollection(value, RELATIONSHIP_COLLECTIONS[key])
    : undefined;
}

function isDid(actor: string): boolean {
  return actor.startsWith('did:');
}

async function fetchRelationshipRecordUri(
  clients: ReturnType<typeof useClients>,
  activeDid: string | null,
  did: string,
  key: RelationshipRecordKey,
): Promise<string | undefined> {
  if (!activeDid) return undefined;
  const agent = getReadAgent(clients, feedReadMode(activeDid));
  const res = await agent.app.bsky.graph.getRelationships({
    actor: activeDid,
    others: [did],
  });
  return getRelationshipRecordUri(res.data.relationships[0], key);
}

export async function resolveRelationshipRecordUri(
  clients: ReturnType<typeof useClients>,
  activeDid: string | null,
  did: string,
  key: RelationshipRecordKey,
  recordUri?: string,
): Promise<string | undefined> {
  return (
    recordUriForCollection(recordUri, RELATIONSHIP_COLLECTIONS[key]) ??
    (await fetchRelationshipRecordUri(clients, activeDid, did, key))
  );
}

export async function fetchProfile(
  actor: string,
  clients: ReturnType<typeof useClients>,
  activeDid: string | null,
): Promise<AppBskyActorDefs.ProfileViewDetailed> {
  const mode = feedReadMode(activeDid);
  const agent = getReadAgent(clients, mode);
  const res = await agent.getProfile({ actor });
  return res.data;
}

function useResolvedProfileDid(
  actor: string | undefined,
  options?: { directRoute?: boolean },
): {
  profileDid: string | undefined;
  isResolving: boolean;
  resolveError: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();
  const actorIsDid = actor ? isDid(actor) : false;
  const directRoute = options?.directRoute ?? false;

  const resolutionQuery = useQuery({
    queryKey:
      actor && !actorIsDid
        ? keys.actorResolution(scope, actor)
        : ['actorResolution', 'disabled'],
    enabled: Boolean(
      actor &&
      !actorIsDid &&
      (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    staleTime: directRoute ? DIRECT_ROUTE_STALE_TIME : Number.POSITIVE_INFINITY,
    refetchOnMount: directRoute ? 'always' : undefined,
    queryFn: async () => {
      const profile = await fetchProfile(actor!, clients, activeDid);
      primeProfiles(qc, scope, profile);
      return profile.did;
    },
  });

  return {
    profileDid: actorIsDid ? actor : resolutionQuery.data,
    isResolving: Boolean(actor && !actorIsDid && resolutionQuery.isLoading),
    resolveError:
      resolutionQuery.error instanceof Error ? resolutionQuery.error : null,
  };
}

function useProfileByDid(
  profileDid: string | undefined,
  options: {
    staleTime: number;
    refetchOnMount?: 'always';
    fetchActor?: string;
  },
): {
  data?: AppBskyActorDefs.ProfileViewDetailed;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: profileDid
      ? keys.profileByDid(scope, profileDid)
      : ['profile', 'disabled'],
    enabled: Boolean(
      profileDid && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    staleTime: options.staleTime,
    refetchOnMount: options.refetchOnMount,
    queryFn: async () => {
      if (options.refetchOnMount !== 'always') {
        const cached = qc.getQueryData<AtprotoProfileView>(
          keys.profileByDid(scope, profileDid!),
        );
        if (profileHasCounts(cached)) return cached;
      }

      const profile = await fetchProfile(
        options.fetchActor ?? profileDid!,
        clients,
        activeDid,
      );
      primeProfiles(qc, scope, profile);
      return (
        qc.getQueryData<AppBskyActorDefs.ProfileViewDetailed>(
          keys.profileByDid(scope, profile.did),
        ) ?? profile
      );
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useProfile(actor: string | undefined): {
  data?: AppBskyActorDefs.ProfileViewDetailed;
  isLoading: boolean;
  error: Error | null;
} {
  const { profileDid, isResolving, resolveError } =
    useResolvedProfileDid(actor);
  const profileQuery = useProfileByDid(profileDid, {
    staleTime: Number.POSITIVE_INFINITY,
    fetchActor: actor,
  });

  return {
    data: profileQuery.data,
    isLoading: isResolving || profileQuery.isLoading,
    error: resolveError ?? profileQuery.error,
  };
}

export function useProfileRoute(actor: string | undefined): {
  data?: AppBskyActorDefs.ProfileViewDetailed;
  isLoading: boolean;
  error: Error | null;
} {
  const { profileDid, isResolving, resolveError } = useResolvedProfileDid(
    actor,
    { directRoute: true },
  );
  const profileQuery = useProfileByDid(profileDid, {
    staleTime: DIRECT_ROUTE_STALE_TIME,
    refetchOnMount: 'always',
    fetchActor: actor,
  });

  return {
    data: profileQuery.data,
    isLoading: isResolving || profileQuery.isLoading,
    error: resolveError ?? profileQuery.error,
  };
}

export function useSearchActorsTypeahead(term: string | undefined) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useQuery({
    queryKey: [
      ...keys.search(scope, term ?? '', 'actors'),
      'typeahead',
    ] as const,
    enabled: Boolean(
      term &&
      term.length >= 1 &&
      (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    staleTime: 30_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.searchActorsTypeahead({ q: term!, limit: 10 });
      primeProfiles(qc, scope, { actors: res.data.actors });
      return res.data.actors;
    },
  });
}

export function useFollowers(
  subjectDid: string | undefined,
  options?: { enabled?: boolean },
) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useInfiniteList({
    queryKey: subjectDid
      ? keys.followers(scope, subjectDid)
      : ['followers', 'disabled'],
    enabled:
      (options?.enabled ?? true) &&
      Boolean(
        subjectDid && (activeDid ? clients.activeAppViewProxyAgent : true),
      ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.getFollowers({
        actor: subjectDid!,
        limit: PROFILE_GRAPH_LIMIT,
        cursor: pageParam,
      });
      primeProfiles(qc, scope, res.data);
      return {
        items: res.data.followers,
        cursor: res.data.cursor,
      };
    },
  });
}

export function useFollows(
  subjectDid: string | undefined,
  options?: { enabled?: boolean },
) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useInfiniteList({
    queryKey: subjectDid
      ? keys.follows(scope, subjectDid)
      : ['follows', 'disabled'],
    enabled:
      (options?.enabled ?? true) &&
      Boolean(
        subjectDid && (activeDid ? clients.activeAppViewProxyAgent : true),
      ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.getFollows({
        actor: subjectDid!,
        limit: PROFILE_GRAPH_LIMIT,
        cursor: pageParam,
      });
      primeProfiles(qc, scope, res.data);
      return {
        items: res.data.follows,
        cursor: res.data.cursor,
      };
    },
  });
}

export function useFollowAccount() {
  const clients = useClients();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<
    { uri: string },
    Error,
    ProfileMutationVars,
    ProfileMutationContext
  >({
    mutationFn: async ({ did }) => {
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      const follow = await agent.follow(did);
      return { uri: follow.uri };
    },
    onMutate: async ({ did }) => ({
      rollback: await patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileFollow(profile, true),
      ),
    }),
    onSuccess: ({ uri }, { did }) =>
      patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileFollow(profile, true, uri),
      ),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { did }) =>
      invalidateCachedProfileForViewer(qc, scope, did),
  });
}

export function useUnfollowAccount() {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<null, Error, ProfileMutationVars, ProfileMutationContext>({
    mutationFn: async ({ did, recordUri }) => {
      const followUri = await resolveRelationshipRecordUri(
        clients,
        activeDid,
        did,
        'following',
        recordUri,
      );
      if (!followUri) throw new Error('Follow URI required');
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      await agent.deleteFollow(followUri);
      return null;
    },
    onMutate: async ({ did }) => ({
      rollback: await patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileFollow(profile, false),
      ),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { did }) =>
      invalidateCachedProfileForViewer(qc, scope, did),
  });
}

export function useMuteAccount() {
  const clients = useClients();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<null, Error, ProfileMutationVars, ProfileMutationContext>({
    mutationFn: async ({ did }) => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      await agent.mute(did);
      return null;
    },
    onMutate: async ({ did }) => ({
      rollback: await patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileMute(profile, true),
      ),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { did }) =>
      invalidateCachedProfileForViewer(qc, scope, did),
  });
}

export function useUnmuteAccount() {
  const clients = useClients();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<null, Error, ProfileMutationVars, ProfileMutationContext>({
    mutationFn: async ({ did }) => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      await agent.unmute(did);
      return null;
    },
    onMutate: async ({ did }) => ({
      rollback: await patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileMute(profile, false),
      ),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { did }) =>
      invalidateCachedProfileForViewer(qc, scope, did),
  });
}

export function useBlockAccount() {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<
    { uri: string },
    Error,
    ProfileMutationVars,
    ProfileMutationContext
  >({
    mutationFn: async ({ did }) => {
      if (!activeDid) throw new Error('Active DID required');
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      const block = await agent.app.bsky.graph.block.create(
        { repo: activeDid },
        {
          subject: did,
          createdAt: new Date().toISOString(),
        },
      );
      return { uri: block.uri };
    },
    onMutate: async ({ did }) => ({
      rollback: await patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileBlock(profile, true),
      ),
    }),
    onSuccess: ({ uri }, { did }) =>
      patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileBlock(profile, true, uri),
      ),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { did }) =>
      invalidateCachedProfileForViewer(qc, scope, did),
  });
}

export function useUnblockAccount() {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useMutation<null, Error, ProfileMutationVars, ProfileMutationContext>({
    mutationFn: async ({ did, recordUri }) => {
      if (!activeDid) throw new Error('Active DID required');
      const blockUri = await resolveRelationshipRecordUri(
        clients,
        activeDid,
        did,
        'blocking',
        recordUri,
      );
      if (!blockUri) throw new Error('Block URI required');
      const agent = getWriteAgent(clients, 'pds-repo-direct');
      await agent.app.bsky.graph.block.delete({
        repo: activeDid,
        rkey: atprotoRkey(blockUri),
      });
      return null;
    },
    onMutate: async ({ did }) => ({
      rollback: await patchCachedProfileForViewer(qc, scope, did, (profile) =>
        patchProfileBlock(profile, false),
      ),
    }),
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSettled: (_data, _err, { did }) =>
      invalidateCachedProfileForViewer(qc, scope, did),
  });
}

import type { AppBskyActorDefs } from '@atproto/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { feedReadMode } from './_internal/dispatch';
import { primeProfiles } from './_internal/prime';
import { useInfiniteList } from './_internal/use-infinite';
import { getReadAgent } from './clients';
import { keys } from './keys';
import { useViewerScope } from './scope';

const DIRECT_ROUTE_STALE_TIME = 60_000;

function isDid(actor: string): boolean {
  return actor.startsWith('did:');
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
        const cached = qc.getQueryData<AppBskyActorDefs.ProfileViewDetailed>(
          keys.profileByDid(scope, profileDid!),
        );
        if (cached) return cached;
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
  const { profileDid, isResolving, resolveError } =
    useResolvedProfileDid(actor, { directRoute: true });
  const profileQuery = useProfileByDid(profileDid, {
    staleTime: DIRECT_ROUTE_STALE_TIME,
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
    queryKey: [...keys.search(scope, term ?? '', 'actors'), 'typeahead'] as const,
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

export function useFollowers(subjectDid: string | undefined) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useInfiniteList({
    queryKey: subjectDid ? keys.followers(scope, subjectDid) : ['followers', 'disabled'],
    enabled: Boolean(
      subjectDid && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.getFollowers({
        actor: subjectDid!,
        limit: 50,
        cursor: pageParam,
      });
      primeProfiles(qc, scope, res.data);
      return {
        items: res.data.followers.map((profile) => profile.did),
        cursor: res.data.cursor,
      };
    },
  });
}

export function useFollows(subjectDid: string | undefined) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useInfiniteList({
    queryKey: subjectDid ? keys.follows(scope, subjectDid) : ['follows', 'disabled'],
    enabled: Boolean(
      subjectDid && (activeDid ? clients.activeAppViewProxyAgent : true),
    ),
    queryFn: async ({ pageParam }) => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      const res = await agent.getFollows({
        actor: subjectDid!,
        limit: 50,
        cursor: pageParam,
      });
      primeProfiles(qc, scope, res.data);
      return {
        items: res.data.follows.map((profile) => profile.did),
        cursor: res.data.cursor,
      };
    },
  });
}

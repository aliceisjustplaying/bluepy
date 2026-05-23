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
  const agent = getReadAgent(clients, feedReadMode(activeDid));
  const res = await agent.getProfile({ actor });
  return res.data;
}

export function useProfile(actor: string | undefined): {
  data?: AppBskyActorDefs.ProfileViewDetailed;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: actor
      ? isDid(actor)
        ? keys.profileByDid(scope, actor)
        : keys.actorResolution(scope, actor)
      : ['profile', 'disabled'],
    enabled: Boolean(actor),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const profile = await fetchProfile(actor!, clients, activeDid);
      primeProfiles(qc, scope, profile);
      if (!isDid(actor!)) {
        qc.setQueryData(keys.actorResolution(scope, actor!), profile.did);
      }
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

export function useProfileRoute(actor: string | undefined): {
  data?: AppBskyActorDefs.ProfileViewDetailed;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const scope = useViewerScope();
  const activeDid = useActiveDid();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: actor
      ? isDid(actor)
        ? keys.profileByDid(scope, actor)
        : keys.actorResolution(scope, actor)
      : ['profile', 'disabled'],
    enabled: Boolean(actor),
    staleTime: DIRECT_ROUTE_STALE_TIME,
    refetchOnMount: 'always',
    queryFn: async () => {
      const profile = await fetchProfile(actor!, clients, activeDid);
      primeProfiles(qc, scope, profile);
      if (!isDid(actor!)) {
        qc.setQueryData(keys.actorResolution(scope, actor!), profile.did);
      }
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

export function useSearchActorsTypeahead(term: string | undefined) {
  const clients = useClients();
  const activeDid = useActiveDid();
  const scope = useViewerScope();
  const qc = useQueryClient();

  return useQuery({
    queryKey: keys.search(scope, term ?? '', 'actors'),
    enabled: Boolean(term && term.length >= 1),
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
    enabled: Boolean(subjectDid),
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
    enabled: Boolean(subjectDid),
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

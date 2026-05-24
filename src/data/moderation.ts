import type {
  AppBskyActorDefs,
  AppBskyFeedDefs,
  AppBskyLabelerDefs,
} from '@atproto/api';
import { interpretLabelValueDefinitions } from '@atproto/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
  useAcceptedLabelerSync,
  useActiveDid,
  useClients,
} from '../contexts/SessionProvider';
import {
  decidePostModeration,
  decideProfileModeration,
  type ModerationContext,
  type PostModerationDecision,
  type ProfileModerationDecision,
} from '../render/moderation-decision';

import { feedReadMode } from './_internal/dispatch';
import {
  baselineAcceptedLabelers,
  getReadAgent,
  resolveAcceptedLabelerDids,
} from './clients';
import { usePreferences } from './preferences';

export type { ModerationContext, PostModerationDecision, ProfileModerationDecision };

async function fetchLabelerViews(
  agent: ReturnType<typeof getReadAgent>,
  dids: readonly string[],
): Promise<AppBskyLabelerDefs.LabelerViewDetailed[]> {
  if (!dids.length) return [];
  const res = await agent.app.bsky.labeler.getServices({
    dids: [...dids],
    detailed: true,
  });
  return res.data.views as AppBskyLabelerDefs.LabelerViewDetailed[];
}

export function useModerationContext(): ModerationContext {
  const clients = useClients();
  const activeDid = useActiveDid();
  const { data: prefs } = usePreferences();
  const syncLabelers = useAcceptedLabelerSync();

  const subscribedDids = useMemo(
    () => prefs?.labelers.map((labeler) => labeler.did) ?? [],
    [prefs?.labelers],
  );
  const acceptedLabelerDids = useMemo(
    () => resolveAcceptedLabelerDids(subscribedDids),
    [subscribedDids],
  );

  useEffect(() => {
    syncLabelers(acceptedLabelerDids);
  }, [acceptedLabelerDids, syncLabelers]);

  const labelerQuery = useQuery({
    queryKey: ['labelers', acceptedLabelerDids],
    enabled:
      acceptedLabelerDids.length > 0 &&
      (activeDid ? Boolean(clients.activeAppViewProxyAgent) : true),
    staleTime: 60_000,
    queryFn: async () => {
      const agent = getReadAgent(clients, feedReadMode(activeDid));
      return fetchLabelerViews(agent, acceptedLabelerDids);
    },
  });

  const labelersByDid = useMemo(() => {
    const map = new Map<string, AppBskyLabelerDefs.LabelerViewDetailed>();
    for (const view of labelerQuery.data ?? []) {
      map.set(view.creator.did, view);
    }
    return map;
  }, [labelerQuery.data]);

  const labelDefs = useMemo(() => {
    const defs: ModerationContext['labelDefs'] = {};
    for (const view of labelerQuery.data ?? []) {
      defs[view.creator.did] = interpretLabelValueDefinitions(view);
    }
    return defs;
  }, [labelerQuery.data]);

  const baselineLabelers = useMemo(
    () =>
      baselineAcceptedLabelers().map((did) => ({
        did: labelersByDid.get(did)?.creator.did ?? did,
      })),
    [labelersByDid],
  );

  const subscribedLabelers = useMemo(
    () =>
      subscribedDids.map((did) => ({
        did: labelersByDid.get(did)?.creator.did ?? did,
      })),
    [labelersByDid, subscribedDids],
  );

  return useMemo(
    () => ({
      baselineLabelers,
      subscribedLabelers,
      acceptedLabelerDids,
      labelDefs,
      contentLabelPrefs: prefs?.contentLabels ?? [],
      adultContent: prefs?.adultContent ?? false,
      mutedWords: prefs?.mutedWords ?? [],
      hiddenPosts: prefs?.hiddenPosts ?? [],
      userDid: activeDid ?? undefined,
    }),
    [
      acceptedLabelerDids,
      activeDid,
      baselineLabelers,
      labelDefs,
      prefs?.adultContent,
      prefs?.contentLabels,
      prefs?.hiddenPosts,
      prefs?.mutedWords,
      subscribedLabelers,
    ],
  );
}

export function usePostModeration(
  post: AppBskyFeedDefs.PostView | undefined,
): PostModerationDecision | undefined {
  const ctx = useModerationContext();
  return useMemo(
    () => (post ? decidePostModeration(post, ctx) : undefined),
    [ctx, post],
  );
}

export function useProfileModeration(
  profile:
    | AppBskyActorDefs.ProfileView
    | AppBskyActorDefs.ProfileViewDetailed
    | undefined,
): ProfileModerationDecision | undefined {
  const ctx = useModerationContext();
  return useMemo(
    () => (profile ? decideProfileModeration(profile, ctx) : undefined),
    [ctx, profile],
  );
}

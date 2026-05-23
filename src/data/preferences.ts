import type { Agent } from '@atproto/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useActiveDid, useClients } from '../contexts/SessionProvider';

import { normalizePreferences, type NormalizedPreferences } from './_internal/normalize-preferences';
import {
  applyPreferenceMutation,
  updatePreferences,
  type PreferenceMutationType,
} from './_internal/preferences-mutations';
import { getWriteAgent } from './clients';
import { keys } from './keys';
import { useAccountScope } from './scope';

export type { NormalizedPreferences, PreferenceMutationType };

export async function fetchPreferences(
  agent: Agent,
): Promise<NormalizedPreferences> {
  const res = await agent.app.bsky.actor.getPreferences({});
  return normalizePreferences(res.data.preferences);
}

export function usePreferences(): {
  data?: NormalizedPreferences;
  isLoading: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const accountScope = useAccountScope();
  const activeDid = useActiveDid();

  const query = useQuery({
    queryKey: accountScope ? keys.preferences(accountScope) : ['preferences', 'disabled'],
    enabled: Boolean(accountScope && activeDid),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      return fetchPreferences(agent);
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}

export function useUpdatePreference(
  type: PreferenceMutationType,
): {
  mutate: (
    value: Parameters<typeof applyPreferenceMutation>[2],
    options?: { onSuccess?: () => void; onError?: (error: Error) => void },
  ) => void;
  mutateAsync: (
    value: Parameters<typeof applyPreferenceMutation>[2],
  ) => Promise<NormalizedPreferences>;
  isPending: boolean;
  error: Error | null;
} {
  const clients = useClients();
  const accountScope = useAccountScope();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (
      value: Parameters<typeof applyPreferenceMutation>[2],
    ) => {
      const agent = getWriteAgent(
        clients,
        'authenticated-active-appview-via-pds',
      );
      const nextPrefs = await updatePreferences(agent, (prefs) =>
        applyPreferenceMutation(prefs, type, value),
      );
      return normalizePreferences(nextPrefs);
    },
    onSuccess: (data) => {
      if (accountScope) {
        qc.setQueryData(keys.preferences(accountScope), data);
      }
    },
  });

  return {
    mutate: (value, options) => {
      mutation.mutate(value, {
        onSuccess: options?.onSuccess,
        onError: (error) => {
          options?.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        },
      });
    },
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error : null,
  };
}

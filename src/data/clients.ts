import {
  Agent,
  AtpAgent,
  BSKY_LABELER_DID,
  type AtprotoServiceType,
} from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';

import {
  createAtprotoOAuthAgent,
  getCachedAtprotoOAuthSession,
  restoreAtprotoOAuthSession,
} from '../utils/atproto-oauth';

import { AppViewNotSupportedError, NotAuthenticatedError } from './errors';

export const BSKY_APPVIEW_URL = 'https://public.api.bsky.app';
export const BSKY_APPVIEW_DID = 'did:web:api.bsky.app';
export const BSKY_APPVIEW_PROXY = `${BSKY_APPVIEW_DID}#bsky_appview`;

export type CallMode =
  | 'public-active-appview'
  | 'authenticated-active-appview-via-pds'
  | 'public-bluesky-appview'
  | 'authenticated-bluesky-appview-via-pds'
  | 'pds-repo-direct';

export interface ClientBundle {
  pdsRepoAgent: Agent | null;
  activeAppViewProxyAgent: Agent | null;
  bskyAppViewProxyAgent: Agent | null;
  publicActiveAppViewAgent: Agent;
  publicBskyAppViewAgent: Agent;
  activeAppViewService: string;
}

export interface CreateClientsOptions {
  session: OAuthSession | null;
  appPasswordAgent?: Agent | null;
  activeAppViewService: string;
  activeAppViewDid: string;
  acceptedLabelerDids: readonly string[];
}

function createPublicAgent(
  service: string,
  acceptedLabelerDids: readonly string[],
): Agent {
  const agent = new AtpAgent({ service });
  agent.configureLabelers([...acceptedLabelerDids]);
  return agent;
}

function withProxyAgent(
  base: Agent,
  proxyDid: string,
  acceptedLabelerDids: readonly string[],
  serviceType: AtprotoServiceType = 'bsky_appview',
): Agent {
  const agent = base.withProxy(serviceType, proxyDid);
  agent.configureLabelers([...acceptedLabelerDids]);
  return agent;
}

export function createClients(opts: CreateClientsOptions): ClientBundle {
  const pdsRepoAgent =
    (opts.session ? createAtprotoOAuthAgent(opts.session) : null) ??
    opts.appPasswordAgent ??
    null;

  const publicActiveAppViewAgent = createPublicAgent(
    opts.activeAppViewService,
    opts.acceptedLabelerDids,
  );
  const publicBskyAppViewAgent = createPublicAgent(
    BSKY_APPVIEW_URL,
    opts.acceptedLabelerDids,
  );

  if (!pdsRepoAgent) {
    return {
      pdsRepoAgent: null,
      activeAppViewProxyAgent: null,
      bskyAppViewProxyAgent: null,
      publicActiveAppViewAgent,
      publicBskyAppViewAgent,
      activeAppViewService: opts.activeAppViewService,
    };
  }

  return {
    pdsRepoAgent,
    activeAppViewProxyAgent: withProxyAgent(
      pdsRepoAgent,
      opts.activeAppViewDid,
      opts.acceptedLabelerDids,
    ),
    bskyAppViewProxyAgent: withProxyAgent(
      pdsRepoAgent,
      BSKY_APPVIEW_DID,
      opts.acceptedLabelerDids,
    ),
    publicActiveAppViewAgent,
    publicBskyAppViewAgent,
    activeAppViewService: opts.activeAppViewService,
  };
}

export function getReadAgent(
  clients: ClientBundle,
  mode: CallMode,
): Agent {
  switch (mode) {
    case 'public-active-appview':
      return clients.publicActiveAppViewAgent;
    case 'authenticated-active-appview-via-pds': {
      if (!clients.activeAppViewProxyAgent) {
        throw new NotAuthenticatedError();
      }
      return clients.activeAppViewProxyAgent;
    }
    case 'public-bluesky-appview':
      return clients.publicBskyAppViewAgent;
    case 'authenticated-bluesky-appview-via-pds': {
      if (!clients.bskyAppViewProxyAgent) {
        throw new NotAuthenticatedError();
      }
      return clients.bskyAppViewProxyAgent;
    }
    case 'pds-repo-direct':
      throw new AppViewNotSupportedError(
        'pds-repo-direct is not a read mode; use getWriteAgent',
      );
    default: {
      const impossibleMode: never = mode;
      throw new AppViewNotSupportedError(String(impossibleMode));
    }
  }
}

export function getWriteAgent(
  clients: ClientBundle,
  mode:
    | 'pds-repo-direct'
    | 'authenticated-active-appview-via-pds'
    | 'authenticated-bluesky-appview-via-pds',
): Agent {
  switch (mode) {
    case 'pds-repo-direct': {
      if (!clients.pdsRepoAgent) {
        throw new NotAuthenticatedError();
      }
      return clients.pdsRepoAgent;
    }
    case 'authenticated-active-appview-via-pds': {
      if (!clients.activeAppViewProxyAgent) {
        throw new NotAuthenticatedError();
      }
      return clients.activeAppViewProxyAgent;
    }
    case 'authenticated-bluesky-appview-via-pds': {
      if (!clients.bskyAppViewProxyAgent) {
        throw new NotAuthenticatedError();
      }
      return clients.bskyAppViewProxyAgent;
    }
    default: {
      const impossibleMode: never = mode;
      throw new AppViewNotSupportedError(String(impossibleMode));
    }
  }
}

export function getPdsRepoAgentFor(
  clients: ClientBundle,
  did: string,
  activeDid: string | null,
): Agent | null {
  if (activeDid === did && clients.pdsRepoAgent) {
    return clients.pdsRepoAgent;
  }
  return createAtprotoOAuthAgent(getCachedAtprotoOAuthSession(did));
}

export async function restorePdsRepoAgentFor(did: string): Promise<Agent> {
  const session =
    getCachedAtprotoOAuthSession(did) ??
    (await restoreAtprotoOAuthSession(did));
  const agent = createAtprotoOAuthAgent(session);
  if (!agent) {
    throw new NotAuthenticatedError();
  }
  return agent;
}

export function baselineAcceptedLabelers(): readonly string[] {
  return [BSKY_LABELER_DID];
}

export function resolveAcceptedLabelerDids(
  subscribedDids: readonly string[],
): readonly string[] {
  return [...new Set([...baselineAcceptedLabelers(), ...subscribedDids])].toSorted();
}

import { AtpAgent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';

export const BSKY_APPVIEW_URL = 'https://public.api.bsky.app';

export interface ClientBundle {
  pdsRepoAgent: AtpAgent | null;
  activeAppViewProxyAgent: AtpAgent | null;
  bskyAppViewProxyAgent: AtpAgent | null;
  publicActiveAppViewAgent: AtpAgent;
  publicBskyAppViewAgent: AtpAgent;
}

export function createClients(opts: {
  session: OAuthSession | null;
  activeAppViewService: string;
}): ClientBundle {
  void opts.session;

  return {
    pdsRepoAgent: null,
    activeAppViewProxyAgent: null,
    bskyAppViewProxyAgent: null,
    publicActiveAppViewAgent: new AtpAgent({
      service: opts.activeAppViewService,
    }),
    publicBskyAppViewAgent: new AtpAgent({ service: BSKY_APPVIEW_URL }),
  };
}

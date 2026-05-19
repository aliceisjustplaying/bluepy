/**
 * @typedef {{
 *   ASSETS: { fetch(request: Request): Promise<Response> };
 *   BLUEPY_BUILD_TIME?: string;
 *   BLUEPY_COMMIT_HASH?: string;
 * }} Env
 */

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}

function oauthMetadata(origin) {
  return {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'Bluepy',
    client_uri: `${origin}/`,
    logo_uri: `${origin}/logo-512.png`,
    policy_uri: 'https://github.com/aliceisjustplaying/bluepy/blob/bluesky/PRIVACY.MD',
    redirect_uris: [`${origin}/`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/oauth-client-metadata.json') {
      return json(oauthMetadata(url.origin));
    }
    if (url.pathname === '/version.json') {
      return json({
        buildTime: env.BLUEPY_BUILD_TIME || null,
        commitHash: env.BLUEPY_COMMIT_HASH || 'unknown',
      });
    }
    return env.ASSETS.fetch(request);
  },
};

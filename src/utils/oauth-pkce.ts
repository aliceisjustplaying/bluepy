function dec2hex(dec: number): string {
  return ('0' + dec.toString(16)).slice(-2);
}
export function verifier(): string {
  var array = new Uint32Array(56 / 2);
  window.crypto.getRandomValues(array);
  return Array.from(array, dec2hex).join('');
}
function sha256(plain: string): Promise<ArrayBuffer> {
  // returns promise ArrayBuffer
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}
function base64urlencode(a: ArrayBuffer): string {
  let str = '';
  const bytes = new Uint8Array(a);
  const len = bytes.byteLength;
  for (var i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function generateCodeChallenge(v: string): Promise<string> {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
}

// If /.well-known/oauth-authorization-server exists and code_challenge_methods_supported includes "S256", means support PKCE
export async function supportsPKCE({
  instanceURL,
}: {
  instanceURL?: string;
}): Promise<boolean> {
  if (!instanceURL) return false;
  try {
    const res = await fetch(
      `https://${instanceURL}/.well-known/oauth-authorization-server`,
    );
    if (!res.ok || res.status !== 200) return false;
    const json: unknown = await res.json();
    if (!json || typeof json !== 'object') return false;
    const methods = (json as { code_challenge_methods_supported?: unknown })
      .code_challenge_methods_supported;
    // Match the original JS: `methods?.includes('S256')` — works for arrays
    // and any other value with an `includes` method (e.g. strings).
    if (
      methods != null &&
      typeof (methods as { includes?: unknown }).includes === 'function' &&
      (methods as { includes: (v: string) => boolean }).includes('S256')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// For debugging
// TODO(oxlint:no-underscore-dangle) Intentional debug global; renaming would
// break existing devtools workflows that rely on `__generateCodeChallenge`.
window.__generateCodeChallenge = generateCodeChallenge;

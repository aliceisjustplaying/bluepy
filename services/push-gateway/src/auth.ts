import { createHash } from 'node:crypto';
import { verifySignatureUtf8 } from '@atproto/crypto';
import { didDocumentSchema, type DidDocument } from '@atproto/did';
import type { Db } from './db.js';

export const LXM = {
  'GET /settings': 'social.bluepy.push.getsettings',
  'PUT /settings': 'social.bluepy.push.putsettings',
  'POST /subscriptions': 'social.bluepy.push.registersubscription',
  'POST /subscriptions/unregister': 'social.bluepy.push.unregistersubscription',
  'POST /subscriptions/delete-all-for-account': 'social.bluepy.push.deleteaccountdata',
} as const;

export type Lxm = (typeof LXM)[keyof typeof LXM];

export interface AuthContext {
  did: string;
  lxm: Lxm;
}

export interface ServiceAuthClaims {
  iss?: string;
  sub?: string;
  aud?: string;
  lxm?: string;
  exp?: number;
  jti?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

export type DidDocumentResolver = (did: string) => Promise<DidDocument>;

function base64urlJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function tokenHash(raw: string, claims: ServiceAuthClaims): string {
  const stable = claims.iss && claims.jti ? `${claims.iss}:${claims.jti}` : raw;
  return createHash('sha256').update(stable).digest('hex');
}

async function resolveDidPlc(did: string): Promise<DidDocument> {
  const res = await fetch(`https://plc.directory/${did}`, {
    headers: { accept: 'application/did+json, application/json' },
    signal: AbortSignal.timeout(2_000),
  });
  if (!res.ok) throw new Error('did_resolution_failed');
  return didDocumentSchema.parse(await res.json());
}

export async function resolveDidDocument(did: string): Promise<DidDocument> {
  if (did.startsWith('did:plc:')) return resolveDidPlc(did);
  throw new Error('unsupported_did_method');
}

function atprotoSigningKey(document: DidDocument): string {
  const method = document.verificationMethod?.find((entry) => {
    const id = entry.id.startsWith('#') ? `${document.id}${entry.id}` : entry.id;
    return id === `${document.id}#atproto`;
  });
  if (!method?.publicKeyMultibase) throw new Error('missing_atproto_signing_key');
  return `did:key:${method.publicKeyMultibase}`;
}

async function verifyJwtSignature(rawToken: string, claims: ServiceAuthClaims, resolver: DidDocumentResolver): Promise<void> {
  const parts = rawToken.split('.');
  const header = base64urlJson(parts[0]) as JwtHeader;
  if (header.alg !== 'ES256K' && header.alg !== 'ES256') throw new Error('unsupported_auth_alg');
  const document = await resolver(claims.iss ?? '');
  if (document.id !== claims.iss) throw new Error('did_document_mismatch');
  const didKey = atprotoSigningKey(document);
  const ok = await verifySignatureUtf8(didKey, `${parts[0]}.${parts[1]}`, parts[2], {
    allowMalleableSig: false,
  });
  if (!ok) throw new Error('invalid_auth_signature');
}

export async function verifyServiceAuth({
  db,
  rawToken,
  expectedAud,
  expectedLxm,
  nowSeconds = Math.floor(Date.now() / 1000),
  allowUnsignedDevTokens = false,
  didDocumentResolver = resolveDidDocument,
}: {
  db: Db;
  rawToken: string;
  expectedAud: string;
  expectedLxm: Lxm;
  nowSeconds?: number;
  allowUnsignedDevTokens?: boolean;
  didDocumentResolver?: DidDocumentResolver;
}): Promise<AuthContext> {
  const parts = rawToken.split('.');
  if (parts.length !== 3) throw new Error('invalid_auth_token');
  const claims = base64urlJson(parts[1]) as ServiceAuthClaims;
  if (!claims.iss || (claims.sub && claims.sub !== claims.iss)) throw new Error('invalid_auth_subject');
  if (claims.aud !== expectedAud) throw new Error('invalid_auth_audience');
  if (claims.lxm !== expectedLxm) throw new Error('invalid_auth_method');
  if (!claims.exp || claims.exp <= nowSeconds) throw new Error('expired_auth_token');
  if (!claims.jti) throw new Error('invalid_auth_token');
  if (!allowUnsignedDevTokens) {
    await verifyJwtSignature(rawToken, claims, didDocumentResolver);
  }
  const hash = tokenHash(rawToken, claims);
  const expiresAt = new Date(claims.exp * 1000).toISOString();
  try {
    db.prepare('INSERT INTO used_auth_tokens (token_hash, did, lxm, expires_at) VALUES (?, ?, ?, ?)').run(
      hash,
      claims.iss,
      expectedLxm,
      expiresAt,
    );
  } catch {
    throw new Error('replayed_auth_token');
  }
  return { did: claims.iss, lxm: expectedLxm };
}

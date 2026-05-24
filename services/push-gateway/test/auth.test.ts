import assert from 'node:assert/strict';
import test from 'node:test';
import { Secp256k1Keypair } from '@atproto/crypto';
import { LXM, resolveDidDocument, verifyServiceAuth } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';

function token(claims: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    '',
  ].join('.');
}

function rawTokenPayload(payload: string) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(payload).toString('base64url'),
    '',
  ].join('.');
}

void test('service auth derives did from token and rejects replay', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const raw = token({
    iss: 'did:plc:user',
    aud: 'did:web:notifications-gateway.bluepy.social',
    lxm: LXM['GET /settings'],
    exp: 2_000_000_000,
    jti: 'one',
  });
  const result = await verifyServiceAuth({
      db,
      rawToken: raw,
      expectedAud: 'did:web:notifications-gateway.bluepy.social',
      expectedLxm: LXM['GET /settings'],
      allowUnsignedDevTokens: true,
    });
  assert.equal(result.did, 'did:plc:user');
  await assert.rejects(
    () => verifyServiceAuth({
      db,
      rawToken: raw,
      expectedAud: 'did:web:notifications-gateway.bluepy.social',
      expectedLxm: LXM['GET /settings'],
      allowUnsignedDevTokens: true,
    }),
    /replayed_auth_token/,
  );
});

void test('service auth verifies DID document signing key', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const keypair = await Secp256k1Keypair.create();
  const header = Buffer.from(JSON.stringify({ alg: keypair.jwtAlg })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'did:plc:user',
      aud: 'did:web:notifications-gateway.bluepy.social',
      lxm: LXM['GET /settings'],
      exp: 2_000_000_000,
      jti: 'signed',
    }),
  ).toString('base64url');
  const signature = Buffer.from(await keypair.sign(Buffer.from(`${header}.${payload}`, 'utf8'))).toString('base64url');
  const rawToken = `${header}.${payload}.${signature}`;
  const result = await verifyServiceAuth({
    db,
    rawToken,
    expectedAud: 'did:web:notifications-gateway.bluepy.social',
    expectedLxm: LXM['GET /settings'],
    didDocumentResolver: async () => ({
      id: 'did:plc:user',
      verificationMethod: [
        {
          id: '#atproto',
          type: 'Multikey',
          controller: 'did:plc:user',
          publicKeyMultibase: keypair.did().slice('did:key:'.length),
        },
      ],
    }),
  });
  assert.equal(result.did, 'did:plc:user');
});

void test('service auth rejects malformed claims payloads', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const options = {
    db,
    expectedAud: 'did:web:notifications-gateway.bluepy.social',
    expectedLxm: LXM['GET /settings'],
    allowUnsignedDevTokens: true,
  };
  await assert.rejects(
    () => verifyServiceAuth({
      ...options,
      rawToken: rawTokenPayload('null'),
    }),
    /invalid_auth_token/,
  );
  await assert.rejects(
    () => verifyServiceAuth({
      ...options,
      rawToken: token({
        iss: 'did:plc:user',
        aud: 'did:web:notifications-gateway.bluepy.social',
        lxm: LXM['GET /settings'],
        exp: 'not-a-number',
        jti: 'bad-exp',
      }),
    }),
    /invalid_auth_token/,
  );
});

void test('default DID resolver rejects unsupported DID methods', async () => {
  await assert.rejects(() => resolveDidDocument('did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme'), /unsupported_did_method/);
});

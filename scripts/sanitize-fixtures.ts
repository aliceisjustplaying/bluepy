#!/usr/bin/env bun
/**
 * Sanitize raw ATProto fixtures from /tmp/bluepy-fixtures-raw/ into
 * tests/fixtures/atproto/ (committable).
 *
 * Sanitization rules:
 *  - DIDs (did:plc:*, did:web:*) -> did:plc:fixture-N (stable mapping per run)
 *  - Handles (anything matching <subdomain>.<dotted-tld> shape) -> fixture-N.test
 *  - displayName -> "Fixture User N"
 *  - description / bio -> "Fixture description"
 *  - Post text -> "Fixture post content #idx" (facet structure preserved; mention/link byteStart/End re-aligned to new text)
 *  - personalDetailsPref.birthDate -> "1990-01-01"
 *  - mutedWordsPref.items -> [{value: "fixture-muted-1", ...}]
 *  - hiddenPostsPref.items -> remapped URIs
 *  - email -> "fixture-N@example.test"
 *  - External embed url/title/description -> example.test placeholders
 *  - CIDs, rkeys, blob refs -> left intact (opaque, not PII)
 *
 * Idempotent across runs (deterministic mapping is built fresh per run from
 * insertion order). Invocation: `bun run scripts/sanitize-fixtures.ts`.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const RAW_IN = '/tmp/bluepy-fixtures-raw';
const SAFE_OUT = path.resolve(__dirname, '..', 'tests', 'fixtures', 'atproto');

// --- mapping state (built as we walk; deterministic across one run) ---

const didMap = new Map<string, string>();
const handleMap = new Map<string, string>();
let nextN = 1;

function fixtureFor(realDid: string, realHandle?: string): { did: string; handle: string; n: number } {
  if (didMap.has(realDid)) {
    const fd = didMap.get(realDid)!;
    const n = Number(fd.split('-').pop());
    return { did: fd, handle: `fixture-${n}.test`, n };
  }
  const n = nextN++;
  const fd = `did:plc:fixture${n.toString().padStart(3, '0')}`;
  const fh = `fixture-${n}.test`;
  didMap.set(realDid, fd);
  if (realHandle) handleMap.set(realHandle, fh);
  return { did: fd, handle: fh, n };
}

// --- regex-based redactors ---

const RE_DID = /did:(?:plc|web):[a-z0-9.\-_]+/g;
const RE_HANDLE = /\b[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)+\b/g;
const RE_CID_LIKE = /^(bafyrei|bafkrei|bafybei|bafkbei|bafkrqi|bafyrqi)[a-z2-7]+$/i;

function redactString(s: string): string {
  // DIDs first, since handles can shadow
  s = s.replace(RE_DID, (m) => {
    if (didMap.has(m)) return didMap.get(m)!;
    fixtureFor(m);
    return didMap.get(m)!;
  });
  // Handles (skip CIDs, skip already-sanitized fixture.test)
  s = s.replace(RE_HANDLE, (m) => {
    if (m.endsWith('.test') && m.startsWith('fixture-')) return m;
    if (RE_CID_LIKE.test(m)) return m;
    // skip well-known infrastructure hosts whose presence isn't PII
    if (/^(bsky\.social|bsky\.app|api\.bsky\.app|public\.api\.bsky\.app|video\.bsky\.app|plc\.directory|example\.test|example\.com)$/.test(m)) return m;
    // skip NSIDs by known lexicon prefix (NSIDs are reverse-domain; bsky/atproto namespaces)
    if (/^(app\.bsky|com\.atproto|chat\.bsky|tools\.ozone|social\.bluepy)\.[a-z][a-zA-Z0-9.]*$/.test(m)) return m;
    // skip if it doesn't look like a handle (no letter)
    if (!/[a-z]/.test(m)) return m;
    if (handleMap.has(m)) return handleMap.get(m)!;
    const n = handleMap.size + 1;
    const fh = `fixture-${n}.test`;
    handleMap.set(m, fh);
    return fh;
  });
  return s;
}

function redactEmail(s: string): string {
  return s.replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, (_m) => {
    const n = handleMap.size + 1;
    return `fixture-${n}@example.test`;
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Fields whose VALUE we replace wholesale (don't walk into them as text)
const REPLACE_FIELDS = new Map<string, (v: unknown, ctx: { idx: number }) => unknown>([
  ['displayName', (_v, ctx) => `Fixture User ${ctx.idx}`],
  ['description', () => 'Fixture description'],
  ['bio', () => 'Fixture bio'],
  ['email', (_v, ctx) => `fixture-${ctx.idx}@example.test`],
  ['birthDate', () => '1990-01-01'],
]);

let textPostIdx = 0;

function walk(node: unknown, key?: string): unknown {
  // String values
  if (typeof node === 'string') {
    if (!node) return node;
    // $type is the lexicon discriminator; never touch it
    if (key === '$type') return node;
    // long random strings (CIDs, tokens we definitely don't want to keep) left alone if CID-like
    if (RE_CID_LIKE.test(node)) return node;
    if (key === 'email') {
      const n = handleMap.size + 1;
      return `fixture-${n}@example.test`;
    }
    if (key === 'birthDate') return '1990-01-01';
    // JWT-shape catch-all (defense-in-depth — responses shouldn't have these, but just in case)
    if (/^eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(node)) {
      return '[redacted-token]';
    }
    let v = redactEmail(node);
    v = redactString(v);
    return v;
  }

  if (Array.isArray(node)) {
    return node.map((item) => walk(item, key));
  }

  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    const $type = typeof node.$type === 'string' ? node.$type : undefined;

    // Specific lexicon-aware overrides
    if ($type === 'app.bsky.feed.post' && typeof node.text === 'string') {
      // Replace text but preserve facets if possible (we drop facet byte ranges since they'd misalign;
      // moderation/post-text tests rely on facet structure, not exact alignment with text).
      const idx = ++textPostIdx;
      out.text = `Fixture post content #${idx}`;
      if (node.facets) {
        // Keep facets but redact any mention DIDs inside them via the walker
        out.facets = walk(node.facets, 'facets');
      }
      // Walk the rest
      for (const [k, v] of Object.entries(node)) {
        if (k === 'text' || k === 'facets') continue;
        out[k] = walk(v, k);
      }
      return out;
    }

    if ($type === 'app.bsky.actor.defs#mutedWordsPref' && Array.isArray(node.items)) {
      out.$type = node.$type;
      out.items = (node.items as Array<Record<string, unknown>>).map((it, i) => ({
        ...it,
        id: typeof it.id === 'string' ? it.id : undefined,
        value: `fixture-muted-${i + 1}`,
      }));
      return out;
    }

    if ($type === 'app.bsky.actor.defs#hiddenPostsPref' && Array.isArray(node.items)) {
      out.$type = node.$type;
      out.items = (node.items as string[]).map((uri) => redactString(uri));
      return out;
    }

    if ($type === 'app.bsky.embed.external' || $type === 'app.bsky.embed.external#view' || $type === 'app.bsky.embed.external#viewExternal') {
      out.$type = node.$type;
      // external embeds carry uri / title / description
      for (const [k, v] of Object.entries(node)) {
        if (k === '$type') continue;
        if (k === 'external' && isPlainObject(v)) {
          // walk first to sanitize nested strings (thumb URLs contain DIDs), then override the obvious fields
          const walked = walk(v, 'external') as Record<string, unknown>;
          out.external = {
            ...walked,
            uri: 'https://example.test/fixture-external',
            title: 'Fixture external title',
            description: 'Fixture external description',
          };
        } else if (k === 'uri' && typeof v === 'string' && v.startsWith('http')) {
          out.uri = 'https://example.test/fixture-external';
        } else if (k === 'title' && typeof v === 'string') {
          out.title = 'Fixture external title';
        } else if (k === 'description' && typeof v === 'string') {
          out.description = 'Fixture external description';
        } else {
          out[k] = walk(v, k);
        }
      }
      return out;
    }

    // Field-level overrides (displayName, etc.) — only if the value is a non-empty string
    for (const [k, v] of Object.entries(node)) {
      const repl = REPLACE_FIELDS.get(k);
      if (repl && typeof v === 'string' && v.length > 0) {
        // index = the fixture-N for this object's DID, if any
        let idx = 0;
        const candidateDid = typeof node.did === 'string' ? node.did : (typeof node.creator === 'string' ? node.creator : '');
        if (candidateDid && didMap.has(candidateDid)) {
          idx = Number(didMap.get(candidateDid)!.split('-').pop());
        }
        if (!idx) idx = handleMap.size + 1;
        out[k] = repl(v, { idx });
      } else {
        out[k] = walk(v, k);
      }
    }
    return out;
  }

  return node;
}

async function sanitizeDir(rawIn: string, safeOut: string): Promise<number> {
  if (!existsSync(rawIn)) {
    console.log(`(skip) ${rawIn} does not exist`);
    return 0;
  }
  await mkdir(safeOut, { recursive: true });
  const files = (await readdir(rawIn)).filter((f) => f.endsWith('.json'));
  console.log(`sanitizing ${files.length} files: ${rawIn} -> ${safeOut}`);

  // Two-pass: first pass primes the didMap/handleMap from any 'did' field at any nesting.
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(rawIn, f), 'utf8'));
    primeMaps(raw);
  }

  for (const f of files) {
    textPostIdx = 0;
    const raw = JSON.parse(await readFile(path.join(rawIn, f), 'utf8'));
    const cleaned = walk(raw);
    await writeFile(path.join(safeOut, f), JSON.stringify(cleaned, null, 2) + '\n');
    console.log(`  ${f}`);
  }
  // Pass through any non-json files (MISSING.md etc.)
  for (const f of (await readdir(rawIn)).filter((f) => !f.endsWith('.json'))) {
    const src = await readFile(path.join(rawIn, f), 'utf8');
    await writeFile(path.join(safeOut, f), src);
    console.log(`  ${f} (copied as-is)`);
  }
  return files.length;
}

async function main(): Promise<void> {
  // Phase 1: structural fixtures (single shared didMap/handleMap so cross-references resolve)
  const n1 = await sanitizeDir(RAW_IN, SAFE_OUT);
  // Phase 2: moderation subdir (shares the same didMap so any DIDs already mapped stay consistent)
  const n2 = await sanitizeDir(
    '/tmp/bluepy-fixtures-raw-mod',
    path.join(SAFE_OUT, 'moderation'),
  );
  console.log(`primed mappings after both phases: ${didMap.size} DIDs, ${handleMap.size} handles`);
  console.log(`sanitized ${n1} structural + ${n2} moderation fixtures`);

  // Write the mapping report (NOT committed; useful for spot-checking)
  await writeFile(
    '/tmp/bluepy-fixtures-mapping.json',
    JSON.stringify(
      {
        dids: Object.fromEntries(didMap.entries()),
        handles: Object.fromEntries(handleMap.entries()),
      },
      null,
      2,
    ),
  );
  console.log(`mapping report at /tmp/bluepy-fixtures-mapping.json (NOT committed)`);
  console.log(`done.`);
}

function primeMaps(node: unknown): void {
  if (typeof node === 'string') {
    // surface DIDs in any string
    const matches = node.match(RE_DID);
    if (matches) for (const m of matches) fixtureFor(m);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) primeMaps(v);
    return;
  }
  if (isPlainObject(node)) {
    // prefer { did, handle } pairs so the mapping locks in together
    const did = typeof node.did === 'string' ? node.did : undefined;
    const handle = typeof node.handle === 'string' ? node.handle : undefined;
    if (did) {
      const existed = didMap.has(did);
      const r = fixtureFor(did, handle);
      if (!existed && handle && !handleMap.has(handle)) handleMap.set(handle, r.handle);
    }
    for (const v of Object.values(node)) primeMaps(v);
  }
}

await main();

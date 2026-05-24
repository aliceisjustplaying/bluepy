#!/usr/bin/env bun
/**
 * Capture one PostView/PostThread per moderation cause for ADR-0019's
 * tests/fixtures/atproto/moderation/ corpus. Writes raw output to
 * /tmp/bluepy-fixtures-raw-mod/; sanitize-fixtures.ts then promotes
 * to tests/fixtures/atproto/moderation/.
 *
 * Causes targeted (ADR-0022):
 *   - label         (PostView.labels.length > 0)
 *   - muted-word    (record.text contains a word in mutedWordsPref)
 *   - hidden-post   (post URI in hiddenPostsPref)
 *   - blocked-by    (author.viewer.blockedBy = true)
 *   - blocking      (author.viewer.blocking = <uri>)
 *   - muted         (author.viewer.muted = true)
 *   - detached      (embed.$type endsWith #viewDetached)
 *   - not-found     (getPosts on a fake URI -> notFoundPost variant)
 *
 * Captures are best-effort: walks the timeline (multiple pages),
 * author feeds for friends-of-friends, and explicit URIs for the
 * hidden-post + not-found cases. Any cause we can't find in the
 * available data is logged as MISSING and we keep going.
 *
 * Invocation: `source ~/.secrets/bluepy/source.env && bun run scripts/capture-moderation-fixtures.ts`
 */
import { AtpAgent } from '@atproto/api';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

type AnyRec = Record<string, unknown>;

const RAW_OUT = '/tmp/bluepy-fixtures-raw-mod';

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}. did you source ~/.secrets/bluepy/source.env?`);
    process.exit(2);
  }
  return v;
}

async function dump(name: string, data: unknown): Promise<void> {
  const p = path.join(RAW_OUT, `${name}.json`);
  await writeFile(p, JSON.stringify(data, null, 2));
  console.log(`  wrote ${name}.json (${JSON.stringify(data).length} bytes)`);
}

async function main(): Promise<void> {
  if (!existsSync(RAW_OUT)) await mkdir(RAW_OUT, { recursive: true });

  const identifier = envOrDie('ATPROTO_PROD_IDENTIFIER');
  const password = envOrDie('ATPROTO_PROD_PASSWORD');

  const agent = new AtpAgent({ service: 'https://bsky.social' });
  console.log('logging in...');
  await agent.login({ identifier, password });
  const did = agent.session?.did;
  if (!did) {
    console.error('login succeeded but no DID on session?');
    process.exit(3);
  }
  console.log('logged in. fetching preferences...');

  const prefsResp = await agent.app.bsky.actor.getPreferences();
  const prefs = prefsResp.data.preferences as AnyRec[];
  const mutedWords: { value: string; targets?: string[] }[] = [];
  const hiddenPostUris: string[] = [];
  for (const p of prefs) {
    if (p.$type === 'app.bsky.actor.defs#mutedWordsPref' && Array.isArray(p.items)) {
      for (const it of p.items as AnyRec[]) {
        if (typeof it.value === 'string') mutedWords.push({ value: it.value, targets: it.targets as string[] | undefined });
      }
    }
    if (p.$type === 'app.bsky.actor.defs#hiddenPostsPref' && Array.isArray(p.items)) {
      for (const u of p.items as unknown[]) if (typeof u === 'string') hiddenPostUris.push(u);
    }
  }
  console.log(`  ${mutedWords.length} muted words, ${hiddenPostUris.length} hidden posts`);

  // --- Walk feeds collecting candidates ---

  const candidates: {
    label?: AnyRec;
    mutedWord?: { post: AnyRec; word: string };
    blockedBy?: AnyRec;
    blocking?: AnyRec;
    muted?: AnyRec;
    detached?: AnyRec;
  } = {};

  let cursor: string | undefined;
  let pages = 0;
  while (pages < 5 && Object.values(candidates).filter(Boolean).length < 6) {
    const tl = await agent.app.bsky.feed.getTimeline({ limit: 100, cursor });
    pages += 1;
    for (const item of tl.data.feed) {
      const post = item.post as unknown as AnyRec;
      const author = post.author as AnyRec;
      const viewer = (author?.viewer ?? {}) as AnyRec;
      const labels = post.labels as unknown[] | undefined;

      if (!candidates.label && Array.isArray(labels) && labels.length > 0) {
        candidates.label = post;
      }
      if (!candidates.blockedBy && viewer.blockedBy === true) candidates.blockedBy = post;
      if (!candidates.blocking && typeof viewer.blocking === 'string') candidates.blocking = post;
      if (!candidates.muted && viewer.muted === true) candidates.muted = post;

      const embed = post.embed as AnyRec | undefined;
      if (!candidates.detached && embed && typeof embed.$type === 'string' && embed.$type.endsWith('#viewDetached')) {
        candidates.detached = post;
      }
      // also check nested embed.record for detached
      const recEmbed = (embed?.record as AnyRec | undefined);
      if (!candidates.detached && recEmbed && typeof recEmbed.$type === 'string' && recEmbed.$type.endsWith('#viewDetached')) {
        candidates.detached = post;
      }

      // muted-word: record.text contains any muted-word value (case-insensitive)
      if (!candidates.mutedWord) {
        const record = post.record as AnyRec | undefined;
        const text = typeof record?.text === 'string' ? record.text.toLowerCase() : '';
        for (const mw of mutedWords) {
          if (text.includes(mw.value.toLowerCase())) {
            candidates.mutedWord = { post, word: mw.value };
            break;
          }
        }
      }
    }
    cursor = tl.data.cursor;
    if (!cursor) break;
  }

  console.log(`  scanned ${pages} timeline pages`);

  // --- Dump candidates we found ---

  if (candidates.label) {
    await dump('label', candidates.label);
  } else {
    console.warn('  MISSING: label (no labeled post in scanned timeline)');
  }
  if (candidates.mutedWord) {
    await dump('muted-word', { post: candidates.mutedWord.post, _captureMeta: { matchedWord: candidates.mutedWord.word } });
  } else {
    console.warn('  MISSING: muted-word (no post matched any mutedWordsPref entry)');
  }
  if (candidates.blockedBy) await dump('blocked-by', candidates.blockedBy);
  else console.warn('  MISSING: blocked-by (no post with author.viewer.blockedBy in scanned timeline)');
  if (candidates.blocking) await dump('blocking', candidates.blocking);
  else console.warn('  MISSING: blocking (no post with author.viewer.blocking in scanned timeline)');
  if (candidates.muted) await dump('muted', candidates.muted);
  else console.warn('  MISSING: muted (no post with author.viewer.muted in scanned timeline)');
  if (candidates.detached) await dump('detached', candidates.detached);
  else console.warn('  MISSING: detached (no #viewDetached embed in scanned timeline)');

  // --- hidden-post: getPosts on a hiddenPostsPref URI ---

  if (hiddenPostUris.length > 0) {
    const uri = hiddenPostUris[0]!;
    try {
      const r = await agent.app.bsky.feed.getPosts({ uris: [uri] });
      await dump('hidden-post', { _captureMeta: { hiddenPostUri: uri }, ...r.data });
    } catch (e) {
      console.warn(`  hidden-post getPosts failed: ${(e as Error).message}`);
    }
  } else {
    console.warn('  MISSING: hidden-post (hiddenPostsPref is empty)');
  }

  // --- not-found: getPosts on a fake URI ---
  // Construct a URI for the logged-in account with a definitely-nonexistent rkey
  const fakeUri = `at://${did}/app.bsky.feed.post/3nonExistentRecord00`;
  try {
    const r = await agent.app.bsky.feed.getPosts({ uris: [fakeUri] });
    // getPosts simply returns an empty posts array for not-found; capture that shape
    await dump('not-found', { _captureMeta: { fakeUri }, ...r.data });
  } catch (e) {
    console.warn(`  not-found capture failed: ${(e as Error).message}`);
  }

  // --- For unrendered viewer-relationship causes, also try searchPosts to broaden the pool ---
  if (!candidates.muted || !candidates.blocking || !candidates.blockedBy) {
    console.log('searching broader pool for missing viewer-relationship causes...');
    try {
      // Search for benign common term to get a diverse author set
      const sr = await agent.app.bsky.feed.searchPosts({ q: 'the', limit: 100 });
      for (const post of sr.data.posts as unknown as AnyRec[]) {
        const author = post.author as AnyRec;
        const viewer = (author?.viewer ?? {}) as AnyRec;
        if (!candidates.blockedBy && viewer.blockedBy === true) { candidates.blockedBy = post; await dump('blocked-by', post); }
        if (!candidates.blocking && typeof viewer.blocking === 'string') { candidates.blocking = post; await dump('blocking', post); }
        if (!candidates.muted && viewer.muted === true) { candidates.muted = post; await dump('muted', post); }
      }
    } catch (e) {
      console.warn(`  searchPosts broaden failed: ${(e as Error).message}`);
    }
  }

  // --- Profile-shape viewer-relationship fixtures ---
  // Posts from blocked/muted users don't typically appear in feeds, but the
  // ProfileView surfaces viewer.blocking / viewer.muted. ADR-0022's
  // decideProfileModeration consumes these. We capture one profile per cause.

  if (!candidates.blocking) {
    try {
      const blocks = await agent.app.bsky.graph.getBlocks({ limit: 5 });
      const first = (blocks.data.blocks as unknown as AnyRec[])[0];
      if (first && typeof first.did === 'string') {
        const prof = await agent.app.bsky.actor.getProfile({ actor: first.did });
        await dump('blocking-profile', prof.data);
        console.log('  captured blocking-profile.json (ProfileView with viewer.blocking)');
      } else {
        console.warn('  MISSING: blocking (no blocks on this account)');
      }
    } catch (e) {
      console.warn(`  blocking-profile capture failed: ${(e as Error).message}`);
    }
  }

  if (!candidates.muted) {
    try {
      const mutes = await agent.app.bsky.graph.getMutes({ limit: 5 });
      const first = (mutes.data.mutes as unknown as AnyRec[])[0];
      if (first && typeof first.did === 'string') {
        const prof = await agent.app.bsky.actor.getProfile({ actor: first.did });
        await dump('muted-profile', prof.data);
        console.log('  captured muted-profile.json (ProfileView with viewer.muted)');
      } else {
        console.warn('  MISSING: muted (no mutes on this account)');
      }
    } catch (e) {
      console.warn(`  muted-profile capture failed: ${(e as Error).message}`);
    }
  }

  // --- hidden-post fixture: any post fixture works; the moderation test sets up
  // ModerationContext.hiddenPosts with the post's URI. We pick the first feed post
  // we encountered above and reuse it under a moderation/ filename.
  // (label candidate is reusable since it's the most likely to have rich shape)
  if (candidates.label) {
    await dump('hidden-post-reuse', candidates.label);
    console.log('  wrote hidden-post-reuse.json (label candidate reused; moderation test puts URI in hiddenPosts)');
  }

  // Document gaps
  const gaps: string[] = [];
  if (!candidates.blockedBy) gaps.push('blocked-by: no post where author.viewer.blockedBy = true (someone-who-blocked-you-replying-in-a-thread fixture would need to be captured separately)');
  if (!candidates.detached) gaps.push('detached: no embed.$type ending in #viewDetached found in 5 timeline pages or searchPosts pool');
  if (hiddenPostUris.length === 0) gaps.push('hidden-post: hiddenPostsPref is empty on this account; we reused the label fixture as the post-shape stand-in (moderation test sets the URI in ModerationContext.hiddenPosts)');

  if (gaps.length > 0) {
    await writeFile(path.join(RAW_OUT, 'MISSING.md'), `# Missing moderation fixtures

These causes could not be captured from the main account's available data:

${gaps.map((g) => '- ' + g).join('\n')}

Agent behavior: \`decidePostModeration\` / \`decideProfileModeration\` tests for these causes either
(a) reuse another captured fixture and set up the appropriate ModerationContext + viewer state at test setup time (allowed: the post is a real capture; the surrounding context is per-test), or
(b) the agent halts at M6 with STUCK-M6-VERIFY.md and we capture the missing fixtures via the test accounts in a follow-up.
`);
    console.log(`  wrote MISSING.md (${gaps.length} gaps)`);
  }

  console.log(`done. raw moderation fixtures at ${RAW_OUT}/`);
}

await main();

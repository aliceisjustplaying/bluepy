#!/usr/bin/env bun
/**
 * Capture raw ATProto API responses from the main account into
 * /tmp/bluepy-fixtures-raw/. This output contains PII and is NEVER committed.
 * Run `bun run scripts/sanitize-fixtures.ts` after this to produce the
 * committable corpus at tests/fixtures/atproto/.
 *
 * Invocation: `source ~/.secrets/bluepy/source.env && bun run scripts/capture-fixtures.ts`
 *
 * Idempotent: re-running overwrites /tmp/bluepy-fixtures-raw/ wholesale.
 */
import { AtpAgent } from '@atproto/api';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const RAW_OUT = '/tmp/bluepy-fixtures-raw';

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}. did you source ~/.secrets/bluepy/source.env?`);
    process.exit(2);
  }
  return v;
}

async function dump(filename: string, data: unknown): Promise<void> {
  const p = path.join(RAW_OUT, filename);
  await writeFile(p, JSON.stringify(data, null, 2));
  console.log(`  wrote ${filename} (${JSON.stringify(data).length} bytes)`);
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
  console.log(`logged in. capturing fixtures...`);

  // --- structural reads ---

  console.log('app.bsky.feed.getTimeline');
  const tl = await agent.app.bsky.feed.getTimeline({ limit: 50 });
  await dump('getTimeline.feed-mixed.json', tl.data);

  console.log('app.bsky.actor.getProfile (self)');
  const myProfile = await agent.app.bsky.actor.getProfile({ actor: did });
  await dump('getProfile.basic.json', myProfile.data);

  // attempt to find a profile with pinned posts in the timeline
  let pinnedActor: string | undefined;
  for (const item of tl.data.feed) {
    const author = item.post.author.did;
    if (author === did) continue;
    try {
      const p = await agent.app.bsky.actor.getProfile({ actor: author });
      if ((p.data as { pinnedPost?: unknown }).pinnedPost) {
        pinnedActor = author;
        await dump('getProfile.with-pinned.json', p.data);
        break;
      }
    } catch {
      // ignore unfetchable profiles
    }
  }
  if (!pinnedActor) {
    console.warn('  no profile with pinned post found; getProfile.with-pinned.json absent');
  }

  // pick a deep thread: walk timeline for a post with replyCount > 2
  let threadUri: string | undefined;
  for (const item of tl.data.feed) {
    if ((item.post.replyCount ?? 0) > 2) {
      threadUri = item.post.uri;
      break;
    }
  }
  if (threadUri) {
    console.log(`app.bsky.feed.getPostThread (${threadUri})`);
    const thread = await agent.app.bsky.feed.getPostThread({ uri: threadUri, depth: 6 });
    await dump('getPostThread.deep.json', thread.data);
  } else {
    console.warn('  no thread with replyCount > 2 in timeline; getPostThread.deep.json absent');
  }

  console.log('app.bsky.feed.getAuthorFeed (self)');
  const authorFeed = await agent.app.bsky.feed.getAuthorFeed({ actor: did, limit: 30, filter: 'posts_and_author_threads' });
  await dump('getAuthorFeed.with-pins.json', authorFeed.data);

  console.log('app.bsky.feed.getActorLikes (self)');
  try {
    const likes = await agent.app.bsky.feed.getActorLikes({ actor: did, limit: 20 });
    await dump('getActorLikes.json', likes.data);
  } catch (e) {
    console.warn(`  getActorLikes failed: ${(e as Error).message}`);
  }

  console.log('app.bsky.feed.searchPosts (query: "test")');
  const search = await agent.app.bsky.feed.searchPosts({ q: 'test', limit: 25 });
  await dump('searchPosts.json', search.data);

  console.log('app.bsky.actor.getPreferences');
  const prefs = await agent.app.bsky.actor.getPreferences();
  await dump('getPreferences.full.json', prefs.data);
  // synth a variant with an unknown $type entry, per ADR-0019 preserve-unknown test
  const withUnknown = structuredClone(prefs.data);
  withUnknown.preferences.push({
    $type: 'app.bsky.actor.defs#someFuturePref',
    futureField: 'fixture-future-value',
  } as (typeof withUnknown.preferences)[number]);
  await dump('getPreferences.with-unknown.json', withUnknown);

  console.log('app.bsky.notification.listNotifications');
  const notifs = await agent.app.bsky.notification.listNotifications({ limit: 40 });
  await dump('getNotifications.grouped.json', notifs.data);

  console.log('app.bsky.graph.getFollows (self)');
  const follows = await agent.app.bsky.graph.getFollows({ actor: did, limit: 30 });
  await dump('getFollows.json', follows.data);

  console.log('app.bsky.graph.getFollowers (self)');
  const followers = await agent.app.bsky.graph.getFollowers({ actor: did, limit: 30 });
  await dump('getFollowers.json', followers.data);

  console.log(`done. raw fixtures at ${RAW_OUT}/`);
}

await main();

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileCredentialStore, metaAuthFile, metaSignedIn, metaSignOut } from '../src/agent/meta-auth.js';
import { createModelChain } from '../src/agent/brain.js';

const fakeCredential = { type: 'oauth', access: 'minted-key', refresh: 'identity', expires: Date.now() + 3_600_000 };

test('meta sign-in: the credential file round-trips, serializes writes and disappears on sign-out', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bd-meta-'));
  const store = createFileCredentialStore(metaAuthFile(dir));
  assert.equal(await store.read('meta'), undefined);
  await Promise.all([store.modify('meta', async () => fakeCredential), store.modify('other', async () => ({ type: 'api_key', key: 'x' }))]);
  assert.deepEqual(await store.read('meta'), fakeCredential);
  assert.deepEqual((await store.list()).map((c) => c.providerId).sort(), ['meta', 'other']);
  assert.equal(metaSignedIn(dir), true);
  metaSignOut(dir);
  assert.equal(metaSignedIn(dir), false);
  assert.equal(existsSync(metaAuthFile(dir)), false);
});

test('meta sign-in: once signed in, Muse Spark goes first and Llama on this PC is the backup', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bd-meta-'));
  const env = { BD_LLAMA_URL: 'http://127.0.0.1:18091/v1' };
  assert.deepEqual((await createModelChain(env, { dataDir: dir })).map((h) => h.model.id), ['llama-3.2-3b']);
  await createFileCredentialStore(metaAuthFile(dir)).modify('meta', async () => fakeCredential);
  const chain = await createModelChain(env, { dataDir: dir });
  assert.deepEqual(chain.map((h) => `${h.model.provider}/${h.model.id}`), ['meta/muse-spark-1.3', 'llama-local/llama-3.2-3b']);
});

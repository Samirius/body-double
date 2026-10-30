import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createWatcher, normalizeSample } from '../src/core/watcher.js';

// A fake helper process. `behaviour` decides what happens on each request.
function fakeHelper(behaviour) {
  const c = new EventEmitter();
  c.stdout = new PassThrough();
  c.stdin = new PassThrough();
  c.killed = false;
  c.kill = () => { c.killed = true; c.emit('exit', 1); };
  let n = 0;
  c.stdin.on('data', (buf) => {
    for (const line of String(buf).split('\n').filter(Boolean)) {
      if (line !== 'next') continue;
      const action = behaviour(n++);
      if (action === 'die') setImmediate(() => c.emit('exit', 1));
      else if (action === 'hang') { /* never answers */ }
      else if (action === 'garbage') c.stdout.write('not json\n');
      else c.stdout.write(`${JSON.stringify(action)}\n`);
    }
  });
  return c;
}

test('watcher: normal samples are normalised', async () => {
  const w = createWatcher({ spawnHelper: () => fakeHelper(() => ({ title: 'Doc', app: 'WINWORD', idleMs: 2600 })) });
  assert.deepEqual({ ...(await w.sample()), at: 0 }, { title: 'Doc', app: 'winword', idleSeconds: 3, at: 0 });
  w.stop();
});

test('watcher: a helper that dies is replaced on the next sample', async () => {
  let spawned = 0;
  const restarts = [];
  const w = createWatcher({
    spawnHelper: () => { spawned++; return fakeHelper((n) => (spawned === 1 && n === 1 ? 'die' : { title: `t${spawned}`, app: 'code', idleMs: 0 })); },
    onRestart: (count) => restarts.push(count),
  });
  assert.equal((await w.sample()).title, 't1');
  assert.equal(await w.sample(), null); // helper died mid-request
  assert.equal((await w.sample()).title, 't2'); // fresh helper
  assert.equal(spawned, 2);
  assert.deepEqual(restarts, [1]);
  assert.equal(w.stats().restarts, 1);
  w.stop();
});

test('watcher: a hung helper times out, is killed, and replaced', async () => {
  const helpers = [];
  const w = createWatcher({ sampleTimeoutMs: 50, spawnHelper: () => { const h = fakeHelper(() => (helpers.length === 1 ? 'hang' : { title: 'ok', app: 'code', idleMs: 0 })); helpers.push(h); return h; } });
  assert.equal(await w.sample(), null);
  assert.ok(helpers[0].killed);
  assert.equal((await w.sample()).title, 'ok');
  w.stop();
});

test('watcher: malformed output becomes a null sample, not a crash', async () => {
  const w = createWatcher({ spawnHelper: () => fakeHelper((n) => (n === 0 ? 'garbage' : { title: 'x', app: 'a', idleMs: 0 })) });
  assert.equal(await w.sample(), null);
  assert.equal((await w.sample()).title, 'x');
  w.stop();
});

test('watcher: after stop, samples resolve null and nothing respawns', async () => {
  let spawned = 0;
  const w = createWatcher({ spawnHelper: () => { spawned++; return fakeHelper(() => ({ title: 'x', app: 'a', idleMs: 0 })); } });
  await w.sample();
  w.stop();
  assert.equal(await w.sample(), null);
  assert.equal(spawned, 1);
  assert.equal(normalizeSample(null), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deciderFiles, ensureDeciderServer } from '../src/core/decider-server.js';

test('decider server: missing files mean nothing is started', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bd-dec-'));
  assert.equal(deciderFiles(root, 'kev-4b'), null);
  assert.equal(deciderFiles(root, 'no-such-model'), null);
  assert.equal(await ensureDeciderServer({ root, port: 18999 }), null);
});

test('decider server: an already running server is reused, not started twice', async () => {
  const srv = http.createServer((req, res) => res.end(req.url === '/v1/models' ? JSON.stringify({ data: [{ id: 'C:\\x\\Julia-1-Q8_0.gguf' }] }) : ''));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const r = await ensureDeciderServer({ root: mkdtempSync(path.join(tmpdir(), 'bd-dec-')), name: 'kev', port: srv.address().port });
  srv.close();
  // It reports what really runs (a hand-started Julia), not what was asked for.
  assert.deepEqual({ ...r, url: undefined }, { name: 'julia', url: undefined, child: null });
});

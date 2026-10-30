// Local client for the background service, shared by the MCP server and the
// pet. Finds the service through daemon.json, starts it (detached) when it
// is not running, and retries once.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDataDir } from './core/store.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ env = process.env, nodePath = process.execPath } = {}) {
  const infoFile = path.join(env.BD_DATA_DIR || defaultDataDir(env), 'daemon.json');
  const readInfo = () => { try { return JSON.parse(readFileSync(infoFile, 'utf8')); } catch { return null; } };

  async function alive(info) {
    if (!info) return false;
    try {
      const r = await fetch(`http://127.0.0.1:${info.port}/status`, { headers: { 'x-bd-token': info.token }, signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch { return false; }
  }

  // One shared start attempt: concurrent callers (event stream + first action)
  // wait on the same promise, and success means "a service answers", so a
  // second spawn that loses the port race cannot make us wait forever.
  let starting = null;
  function ensureService() {
    if (starting) return starting;
    starting = (async () => {
      const current = readInfo();
      if (await alive(current)) return current;
      // Under Electron, process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE
      // makes it behave as plain Node for the service.
      const child = spawn(nodePath, [path.join(ROOT, 'src', 'daemon.js')], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore', env: { ...env, ELECTRON_RUN_AS_NODE: '1' } });
      child.unref();
      for (let i = 0; i < 60; i++) {
        await sleep(250);
        const info = readInfo();
        if (await alive(info)) return info;
      }
      throw new Error('companion service did not start (run npm install in the body-double folder)');
    })().finally(() => { starting = null; });
    return starting;
  }

  async function call(method, route, body, { retried = false } = {}) {
    const info = readInfo();
    try {
      if (!info) throw new Error('not running');
      const res = await fetch(`http://127.0.0.1:${info.port}${route}`, { method, headers: { 'content-type': 'application/json', 'x-bd-token': info.token }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
      const json = await res.json();
      if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { fromService: true });
      return json;
    } catch (e) {
      if (e.fromService || retried) throw e;
      await ensureService();
      return call(method, route, body, { retried: true });
    }
  }

  // Server-sent events from /events. Reconnects (and restarts the service if
  // needed) until stop() is called.
  function subscribe(onEvent, { onState = () => {} } = {}) {
    let stopped = false, controller = null;
    (async () => {
      while (!stopped) {
        try {
          let info = readInfo();
          try {
            controller = new AbortController();
            const res = await fetch(`http://127.0.0.1:${info?.port}/events`, { headers: { 'x-bd-token': info?.token || '' }, signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            onState('connected');
            const decoder = new TextDecoder();
            let buf = '';
            for await (const chunk of res.body) {
              buf += decoder.decode(chunk, { stream: true });
              let i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                const frame = buf.slice(0, i); buf = buf.slice(i + 2);
                const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
                if (data) { try { onEvent(JSON.parse(data)); } catch { /* skip bad frame */ } }
              }
            }
          } catch (e) {
            if (stopped) return;
            onState('disconnected');
            if (!info || /ECONNREFUSED|fetch failed|HTTP 401/.test(String(e.cause?.code || e.message))) await ensureService().catch(() => null);
          }
        } catch { /* keep looping */ }
        if (!stopped) await sleep(1500);
      }
    })();
    return () => { stopped = true; controller?.abort(); };
  }

  return { call, subscribe, readInfo, ensureService };
}

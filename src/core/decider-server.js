// Starts the local decision model (llama.cpp server + a Kev/Julia GGUF from
// vendor/) together with the background service, so nothing has to be typed.
// Listens on 127.0.0.1 only. If the files are missing it does nothing and the
// companion keeps its keyword judge.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const DECIDER_MODELS = { 'kev-4b': 'Kev-4B-Q4_K_M.gguf', kev: 'Kev-0.8B-Q8_0.gguf', julia: 'Julia-1-Q8_0.gguf' };

export function deciderFiles(root, name) {
  const server = path.join(root, 'vendor', 'llama', 'llama-server.exe');
  const file = DECIDER_MODELS[name];
  const model = file && path.join(root, 'vendor', 'models', file);
  return file && existsSync(server) && existsSync(model) ? { server, model } : null;
}

// Name of the model a running server serves (our alias, or its file name
// when someone started it by hand), or null when nothing answers.
async function served(url) {
  try {
    const r = await fetch(`${url}/models`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const id = String((await r.json()).data?.[0]?.id || 'unknown');
    if (DECIDER_MODELS[id]) return id;
    const file = id.split(/[\\/]/).pop();
    return Object.keys(DECIDER_MODELS).find((k) => DECIDER_MODELS[k] === file) || file;
  } catch { return null; }
}

// Returns { name, url, child } (child is null when a server was already up;
// name is then what that server really runs), or null when there is nothing.
export async function ensureDeciderServer({ root, name = 'kev-4b', port = 18090, log = () => {} }) {
  const url = `http://127.0.0.1:${port}/v1`;
  const running = await served(url);
  if (running) {
    if (running !== name) log('decider-server-mismatch', { wanted: name, running });
    return { name: running, url, child: null };
  }
  const files = deciderFiles(root, name);
  if (!files) return null;
  const child = spawn(files.server, ['-m', files.model, '--alias', name, '--host', '127.0.0.1', '--port', String(port), '-t', '4', '--log-disable'], { windowsHide: true, stdio: 'ignore' });
  child.on('error', (e) => log('decider-server-error', { error: e.message }));
  child.on('exit', (code) => log('decider-server-exit', { code }));
  log('decider-server-start', { name, pid: child.pid });
  return { name, url, child };
}

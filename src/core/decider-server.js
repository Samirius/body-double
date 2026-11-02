// Starts the local models together with the background service, so nothing
// has to be typed: llama.cpp's server with
//   - a decision model (Kev/Julia, /v1/systemone) on port 18090, and
//   - Meta's Llama 3.2 3B (writes the nudges, /v1/chat/completions) on 18091.
// Both listen on 127.0.0.1 only. A missing file means that part is skipped and
// the companion keeps its keyword judge / templates.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const DECIDER_MODELS = { 'kev-4b': 'Kev-4B-Q4_K_M.gguf', kev: 'Kev-0.8B-Q8_0.gguf', julia: 'Julia-1-Q8_0.gguf' };
export const WRITER_MODELS = { 'llama-3.2-3b': 'Llama-3.2-3B-Instruct-Q4_K_M.gguf' };
const ALL = { ...DECIDER_MODELS, ...WRITER_MODELS };

export function deciderFiles(root, name) {
  const server = path.join(root, 'vendor', 'llama', 'llama-server.exe');
  const file = ALL[name];
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
    if (ALL[id]) return id;
    const file = id.split(/[\\/]/).pop();
    return Object.keys(ALL).find((k) => ALL[k] === file) || file;
  } catch { return null; }
}

// Returns { name, url, child } (child is null when a server was already up;
// name is then what that server really runs), or null when there is nothing.
export async function ensureModelServer({ root, name, port, args = [], log = () => {} }) {
  const url = `http://127.0.0.1:${port}/v1`;
  const running = await served(url);
  if (running) {
    if (running !== name) log('model-server-mismatch', { wanted: name, running, port });
    return { name: running, url, child: null };
  }
  const files = deciderFiles(root, name);
  if (!files) return null;
  const child = spawn(files.server, ['-m', files.model, '--alias', name, '--host', '127.0.0.1', '--port', String(port), '-t', '4', '--log-disable', ...args], { windowsHide: true, stdio: 'ignore' });
  child.on('error', (e) => log('model-server-error', { name, error: e.message }));
  child.on('exit', (code) => log('model-server-exit', { name, code }));
  log('model-server-start', { name, pid: child.pid });
  return { name, url, child };
}

// --sleep-idle-seconds: llama.cpp frees the model's memory after 5 idle minutes
// and reloads it (a few seconds) on the next request, so an always-on
// companion doesn't hold gigabytes while you work.
const SLEEP = ['--sleep-idle-seconds', '300'];
export const ensureDeciderServer = ({ name = 'kev-4b', port = 18090, ...o }) => ensureModelServer({ name, port, args: SLEEP, ...o });
// --jinja: the model's own chat template, which carries Llama's tool calling.
export const ensureWriterServer = ({ name = 'llama-3.2-3b', port = 18091, ...o }) => ensureModelServer({ name, port, args: ['--jinja', '-c', '4096', ...SLEEP], ...o });

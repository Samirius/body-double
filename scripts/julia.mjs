#!/usr/bin/env node
// Starts the local decision model: llama.cpp's server with Julia-1 on
// 127.0.0.1 only. Run it yourself (it is a downloaded program):
//   npm run julia                 (uses vendor/llama + vendor/models)
// Then set BD_JUDGE=local (or BD_DECIDER_URL=http://127.0.0.1:18090/v1) in .env.
// Downloads, if missing (official sources):
//   llama.cpp b11701  github.com/ggml-org/llama.cpp/releases  llama-b11701-bin-win-cpu-x64.zip
//   Julia-1-Q8_0.gguf huggingface.co/ggml-org/Julia-1-GGUF   sha256 1ea6a7e87156eeeda88cb7a36a61265b37ba7b993897b7289b99aea5b5e47069
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = process.env.BD_LLAMA_SERVER || path.join(root, 'vendor', 'llama', 'llama-server.exe');
const model = process.env.BD_DECIDER_GGUF || path.join(root, 'vendor', 'models', 'Julia-1-Q8_0.gguf');
const port = process.env.BD_DECIDER_PORT || '18090';
for (const f of [server, model]) if (!existsSync(f)) { console.error(`missing ${f} (see the download notes at the top of this script)`); process.exit(1); }

console.log(`local decider: ${path.basename(model)} on http://127.0.0.1:${port}/v1 (Ctrl+C to stop)`);
const child = spawn(server, ['-m', model, '--host', '127.0.0.1', '--port', port, '-t', '4', '--log-disable'], { stdio: 'inherit', windowsHide: false });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());

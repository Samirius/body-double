#!/usr/bin/env node
// Downloads the local models into vendor/ (git-ignored) from their official
// sources and checks every file against a pinned SHA-256. Run it once:
//   npm run setup:models          llama.cpp + Meta Llama 3.2 3B (words and judging), ~2 GB
//   npm run setup:models -- --all  also the decision models Kev and Julia (for the decider eval)
// It only downloads and unpacks; the service starts the models itself.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor');
const hf = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;

const FILES = [
  { name: 'llama.cpp b11701 (Windows CPU)', file: 'llama-b11701-bin-win-cpu-x64.zip', url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11701/llama-b11701-bin-win-cpu-x64.zip', sha256: '2cf9ad0c3bb449386ccae1b31ed091821a9aa773def9dbb94569deaed51d6dfe', unzipTo: 'llama' },
  { name: 'Kev-0.8B (decision model, off by default: it measured at chance)', file: 'models/Kev-0.8B-Q8_0.gguf', url: hf('ggml-org/Kev-0.8B-GGUF', 'Kev-0.8B-Q8_0.gguf'), sha256: '27278f34eb3273bceea4c053dc50dd61a5161da21a718c4aacdf8fd5830771d0', optional: true },
  { name: 'Llama 3.2 3B Instruct (Meta, Llama 3.2 Community License)', file: 'models/Llama-3.2-3B-Instruct-Q4_K_M.gguf', url: hf('bartowski/Llama-3.2-3B-Instruct-GGUF', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'), sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff' },
  { name: 'Kev-4B (bigger decision model)', file: 'models/Kev-4B-Q4_K_M.gguf', url: hf('ggml-org/Kev-4B-GGUF', 'Kev-4B-Q4_K_M.gguf'), sha256: '33ae6b18926502b2209a1bf7d3b61a350d65938441515c686bb87d226a19eff9', optional: true },
  { name: 'Julia-1 (small decision model)', file: 'models/Julia-1-Q8_0.gguf', url: hf('ggml-org/Julia-1-GGUF', 'Julia-1-Q8_0.gguf'), sha256: '1ea6a7e87156eeeda88cb7a36a61265b37ba7b993897b7289b99aea5b5e47069', optional: true },
];

const sha256 = async (f) => { const h = createHash('sha256'); await pipeline(createReadStream(f), h); return h.digest('hex'); };

const all = process.argv.includes('--all');
for (const f of FILES.filter((x) => all || !x.optional)) {
  const dest = path.join(vendor, f.file);
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest) && (await sha256(dest)) === f.sha256) { console.log(`ok       ${f.name}`); }
  else {
    console.log(`download ${f.name} ...`);
    const res = await fetch(f.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`);
    const tmp = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    const got = await sha256(tmp);
    if (got !== f.sha256) { rmSync(tmp); throw new Error(`${f.file}: SHA-256 mismatch (got ${got}); nothing kept`); }
    renameSync(tmp, dest);
    console.log(`verified ${f.name}`);
  }
  if (f.unzipTo && !existsSync(path.join(vendor, f.unzipTo, 'llama-server.exe'))) {
    // Paths travel through environment variables, never spliced into the script.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:BD_ZIP -DestinationPath $env:BD_TO -Force'], { env: { ...process.env, BD_ZIP: dest, BD_TO: path.join(vendor, f.unzipTo) }, stdio: 'inherit' });
    console.log(`unpacked into vendor/${f.unzipTo}`);
  }
}
console.log('Done. Start Nudgling (Desktop icon or npm run pet); it starts the models itself.');

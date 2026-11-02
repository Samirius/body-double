#!/usr/bin/env node
// postinstall: newer npm versions skip dependencies' install scripts, which
// leaves Electron without its app binary. Run Electron's own installer if the
// binary is missing (it downloads from Electron's release, checksum-verified).
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'electron');
const binary = () => { try { return path.join(dir, 'dist', readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()); } catch { return null; } };
if (existsSync(dir) && !(binary() && existsSync(binary()))) {
  console.log('Fetching the Electron app binary...');
  const r = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit', cwd: dir });
  process.exit(r.status ?? 1);
}

#!/usr/bin/env node
// Starts the pet (and with it the service) when you log in to Windows, via a
// shortcut in your Startup folder. Run it yourself:
//   node scripts/autostart.mjs   |   node scripts/autostart.mjs --remove
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lnk = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Focus companion.lnk');

if (process.argv.includes('--remove')) {
  if (existsSync(lnk)) rmSync(lnk);
  console.log(`Removed ${lnk}`);
} else {
  const electron = createRequire(import.meta.url)('electron');
  // Paths travel through environment variables, never spliced into the script.
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:BD_LNK)',
    '$s.TargetPath = $env:BD_TARGET',
    '$s.Arguments = [char]34 + $env:BD_MAIN + [char]34',
    '$s.WorkingDirectory = $env:BD_ROOT',
    "$s.Description = 'Focus companion pet'",
    '$s.Save()',
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, BD_LNK: lnk, BD_TARGET: electron, BD_MAIN: path.join(root, 'src', 'pet', 'main.js'), BD_ROOT: root },
    stdio: 'inherit',
  });
  console.log(`Created ${lnk}. The pet starts at your next login.`);
}

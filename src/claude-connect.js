// Adds (or removes) the "nudgling" MCP server in the user-level Claude Code
// config (~/.claude.json), so Claude can run the companion from any chat.
// Makes a timestamped backup first and only touches that one entry. Used by
// scripts/register-mcp.mjs and by the HUD's "Connect Claude" button.
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'nudgling';
const mcpScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mcp.js');
const skillSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', NAME, 'SKILL.md');
const configFile = (home) => path.join(home, '.claude.json');

export function claudeConnected({ home = homedir() } = {}) {
  try { return !!JSON.parse(readFileSync(configFile(home), 'utf8')).mcpServers?.[NAME]; } catch { return false; }
}

export function connectClaude({ remove = false, home = homedir(), execPath = process.execPath, electron = !!process.versions.electron } = {}) {
  const file = configFile(home);
  const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const backup = existsSync(file) ? `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}` : null;
  if (backup) copyFileSync(file, backup);
  config.mcpServers ||= {};
  if (remove) delete config.mcpServers[NAME];
  // Inside the pet, execPath is Electron; this flag makes it run as plain Node.
  else config.mcpServers[NAME] = { type: 'stdio', command: execPath, args: [mcpScript], env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
  writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2));
  renameSync(`${file}.tmp`, file);
  // The skill teaches Claude when to use the tools (~/.claude/skills/nudgling).
  const skillDir = path.join(home, '.claude', 'skills', NAME);
  if (remove) rmSync(skillDir, { recursive: true, force: true });
  else { mkdirSync(skillDir, { recursive: true }); copyFileSync(skillSource, path.join(skillDir, 'SKILL.md')); }
  return { connected: !remove, file, backup, servers: Object.keys(config.mcpServers), skill: remove ? null : skillDir };
}

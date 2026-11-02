// Connects Nudgling to AI agents: adds its MCP server (the companion_* tools)
// to each agent's config and copies the skill (skills/nudgling/SKILL.md) where
// that agent looks for skills. Every config file is backed up before it is
// changed, only the "nudgling" entry is touched, and --remove undoes it.
// Agents without MCP (or not listed) use the command line: bin/nudgling.mjs.
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'nudgling';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MCP_SCRIPT = path.join(ROOT, 'src', 'mcp.js');
const SKILL = path.join(ROOT, 'skills', NAME, 'SKILL.md');

// The command an agent runs to start the MCP server.
export function serverSpec({ execPath = process.execPath, electron = !!process.versions.electron } = {}) {
  // Inside the pet, execPath is Electron; this flag makes it run as plain Node.
  return { command: execPath, args: [MCP_SCRIPT], env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

const backup = (file) => { if (!existsSync(file)) return null; const b = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`; copyFileSync(file, b); return b; };
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file); };
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});

// JSON configs with a map of servers at `keyPath` (e.g. ['mcpServers'] or ['mcp', 'servers']).
function jsonClient(file, keyPath, entry = (s) => ({ type: 'stdio', ...s })) {
  return {
    file,
    connected: () => { try { return !!keyPath.reduce((o, k) => o?.[k], readJson(file))?.[NAME]; } catch { return false; } },
    apply(remove, spec) {
      const config = readJson(file); // a config that isn't plain JSON throws: we never guess
      const b = backup(file);
      let node = config;
      for (const k of keyPath) node = (node[k] ||= {});
      if (remove) delete node[NAME]; else node[NAME] = entry(spec);
      write(file, JSON.stringify(config, null, 2));
      return b;
    },
  };
}

// Codex: TOML. Our table is one self-contained block we add or cut out.
function codexClient(file) {
  const strip = (t) => t.replace(/\n?\[mcp_servers\.nudgling\][\s\S]*?(?=\n\[|$)/, '');
  const q = (s) => JSON.stringify(s); // TOML basic strings share JSON's escaping for paths
  return {
    file,
    connected: () => existsSync(file) && /\[mcp_servers\.nudgling\]/.test(readFileSync(file, 'utf8')),
    apply(remove, spec) {
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      const b = backup(file);
      const block = `\n[mcp_servers.nudgling]\ncommand = ${q(spec.command)}\nargs = [${spec.args.map(q).join(', ')}]\n${Object.keys(spec.env).length ? `env = { ${Object.entries(spec.env).map(([k, v]) => `${k} = ${q(v)}`).join(', ')} }\n` : ''}`;
      write(file, remove ? strip(text) : `${strip(text).trimEnd()}\n${block}`);
      return b;
    },
  };
}

// Hermes: YAML, servers under a top-level `mcp_servers:` map (2-space indent).
function hermesClient(file) {
  const ours = /\n {2}nudgling:\n(?: {4}.*\n?)*/;
  return {
    file,
    connected: () => existsSync(file) && /\n {2}nudgling:\n/.test(`\n${readFileSync(file, 'utf8')}`),
    apply(remove, spec) {
      let text = `\n${existsSync(file) ? readFileSync(file, 'utf8') : ''}`.replace(ours, '\n');
      const b = backup(file);
      if (!remove) {
        const q = (s) => JSON.stringify(s);
        const entry = `  nudgling:\n    command: ${q(spec.command)}\n    args: [${spec.args.map(q).join(', ')}]\n${Object.keys(spec.env).length ? `    env:\n${Object.entries(spec.env).map(([k, v]) => `      ${k}: ${q(v)}\n`).join('')}` : ''}`;
        text = /\nmcp_servers:[^\n]*\n/.test(text) ? text.replace(/\nmcp_servers:[^\n]*\n/, (m) => `${m}${entry}`) : `${text.trimEnd()}\nmcp_servers:\n${entry}`;
      }
      write(file, `${text.replace(/^\n/, '').trimEnd()}\n`);
      return b;
    },
  };
}

// Where each agent keeps its MCP config and its skills.
export function clients(home = homedir(), env = process.env) {
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return {
    'claude-code': { label: 'Claude Code', mcp: jsonClient(path.join(home, '.claude.json'), ['mcpServers']), skills: path.join(home, '.claude', 'skills') },
    'claude-desktop': { label: 'Claude Desktop', mcp: jsonClient(path.join(appData, 'Claude', 'claude_desktop_config.json'), ['mcpServers'], (s) => s), skills: null },
    codex: { label: 'Codex CLI', mcp: codexClient(path.join(home, '.codex', 'config.toml')), skills: path.join(home, '.agents', 'skills') },
    cursor: { label: 'Cursor', mcp: jsonClient(path.join(home, '.cursor', 'mcp.json'), ['mcpServers'], (s) => s), skills: null },
    openclaw: { label: 'OpenClaw', mcp: jsonClient(path.join(home, '.openclaw', 'openclaw.json'), ['mcp', 'servers'], (s) => s), skills: path.join(home, '.openclaw', 'skills') },
    hermes: { label: 'Hermes Agent', mcp: hermesClient(path.join(home, '.hermes', 'config.yaml')), skills: path.join(home, '.hermes', 'skills') },
    // pi talks MCP only through an adapter; its skill drives the command line instead.
    pi: { label: 'pi', mcp: jsonClient(path.join(home, '.pi', 'agent', 'mcp.json'), ['mcpServers'], (s) => s), skills: path.join(home, '.pi', 'agent', 'skills') },
  };
}

export function isConnected(client, { home = homedir(), env = process.env } = {}) {
  const c = clients(home, env)[client];
  return !!c && c.mcp.connected();
}

export function connect(client, { remove = false, home = homedir(), env = process.env, spec = serverSpec() } = {}) {
  const c = clients(home, env)[client];
  if (!c) throw new Error(`unknown agent "${client}"; use one of: ${Object.keys(clients(home, env)).join(', ')}`);
  const backupFile = c.mcp.apply(remove, spec);
  let skill = null;
  if (c.skills) {
    const dir = path.join(c.skills, NAME);
    if (remove) rmSync(dir, { recursive: true, force: true });
    else { mkdirSync(dir, { recursive: true }); copyFileSync(SKILL, path.join(dir, 'SKILL.md')); skill = dir; }
  }
  return { client, label: c.label, connected: !remove, config: c.mcp.file, backup: backupFile, skill };
}

// Agents that look installed (their config folder exists).
export function detectClients({ home = homedir(), env = process.env } = {}) {
  // The config file, or the agent's own folder (never just the home folder).
  const installed = (file) => existsSync(file) || (path.dirname(file) !== home && existsSync(path.dirname(file)));
  return Object.entries(clients(home, env)).filter(([, c]) => installed(c.mcp.file)).map(([k]) => k);
}

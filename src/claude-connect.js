// The HUD's "Connect Claude" button: Claude Code's MCP entry plus the skill.
// (All agents: src/connect.js and `nudgling connect <agent>`.)
import { homedir } from 'node:os';
import { connect, isConnected, serverSpec } from './connect.js';

export const claudeConnected = ({ home = homedir() } = {}) => isConnected('claude-code', { home });

export function connectClaude({ remove = false, home = homedir(), execPath = process.execPath, electron = !!process.versions.electron } = {}) {
  const r = connect('claude-code', { remove, home, spec: serverSpec({ execPath, electron }) });
  return { connected: r.connected, file: r.config, backup: r.backup, skill: r.skill };
}

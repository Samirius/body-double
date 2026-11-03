# AGENTS.md — set up Nudgling for your user

You are an AI agent (Claude Code, Codex, OpenClaw, Hermes, pi, Cursor, or any agent with a shell) and your user
gave you this repository. Nudgling is a focus companion for ADHD: a pixel creature on their Windows desktop that
speaks first when they drift. Set it up, connect yourself to it, then use it while you work with them.

## 1. Install (Windows, Node 22+; about 5 minutes plus a 3 GB download)

Run these in order. Each one is safe to repeat.

```bash
git clone https://github.com/Samirius/body-double.git nudgling
cd nudgling
npm install
npm run setup:models          # local models from official sources, SHA-256 checked (~3 GB). Ask the user first if their connection is slow; it works without them.
node scripts/autostart.mjs    # starts with Windows + a Desktop icon (--remove undoes it)
npm run pet                   # the creature appears now; it starts its service and models itself
```

No account and no API key are needed. Optional: `META_API_KEY=...` in `.env`, or the user clicks
**Sign in with Meta** in the creature's HUD.

## 2. Connect yourself (one command)

```bash
node bin/nudgling.mjs connect <your-agent>   # claude-code | claude-desktop | codex | cursor | openclaw | hermes | pi
node bin/nudgling.mjs connect all            # every agent installed on this PC
node bin/nudgling.mjs agents                 # what is installed / connected
```

Each connect adds the `nudgling` MCP server (the `companion_*` tools) to that agent's config and copies the
skill (`skills/nudgling/SKILL.md`) to where that agent loads skills. It backs up every file it changes, touches
only the `nudgling` entry, and `--remove` undoes it. Restart or reload your MCP servers afterwards (Hermes:
`/reload-mcp`).

| Agent | MCP config it edits | Skill goes to |
|---|---|---|
| Claude Code | `~/.claude.json` → `mcpServers` | `~/.claude/skills/nudgling` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | – |
| Codex CLI | `~/.codex/config.toml` → `[mcp_servers.nudgling]` | `~/.agents/skills/nudgling` |
| Cursor | `~/.cursor/mcp.json` | – |
| OpenClaw | `~/.openclaw/openclaw.json` → `mcp.servers` (refuses JSON5 with comments: then run `openclaw mcp set` yourself with the command below) | `~/.openclaw/skills/nudgling` |
| Hermes Agent | `~/.hermes/config.yaml` → `mcp_servers` | `~/.hermes/skills/nudgling` |
| pi | `~/.pi/agent/mcp.json` (needs an MCP adapter) | `~/.pi/agent/skills/nudgling` |

**Not listed, or no MCP?** Use the command line; it does the same things and prints JSON:

```bash
node bin/nudgling.mjs start "Fix the checkout bug" --steps "Reproduce it; Find the line; Fix; Test" --repo .
node bin/nudgling.mjs scope "also add a dark mode"   # is this new request scope creep?
node bin/nudgling.mjs done
node bin/nudgling.mjs park "dark mode idea"
node bin/nudgling.mjs focus 25
node bin/nudgling.mjs status
```

The MCP server by hand: `command` = path to `node`, `args` = [`<repo>/src/mcp.js`].

## 3. Use it while you work with the user

Read `skills/nudgling/SKILL.md`. The short version:

- When the user starts something, start a quest with tiny steps (the first under 2 minutes). For coding, pass
  `--repo` / `repo` = the working folder, so Nudgling notices when uncommitted changes pile up.
- **Before you act on a new request in the middle of a quest, run a scope check.** If it says "creep", say so in
  one line, then offer three options: finish and commit first, park it, or start it as a new quest.
- When a step is done, mark it done and read back the XP/combo it returns.
- Never invent XP, levels or streaks; the app owns them.

## Checking it works

```bash
npm test          # 107 tests, no key or model needed
npm run test:pet  # launches the real app, drives it, checks 16 screenshots
```

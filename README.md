# body-double (working name)

A proactive focus companion for ADHD brains, built on the [pi](https://github.com/earendil-works/pi) agent runtime.
It watches which window you're in (titles never stored), notices when you drift, speaks first with ONE next action
under two minutes, and turns finished steps into XP, levels, titles and boss fights. A pixel pet comes next.

Status: day 1 of the hackathon build. Terminal companion + Windows notifications work; the desktop pet is next.

## Run (Windows, Node 22+)
```bash
npm install
npm test        # 13 tests, no keys needed
npm start       # terminal companion; template nudges until a model key is set
```
Optional model (`.env`): `META_API_KEY=...` (Muse Spark via pi-ai's Meta provider) or `ZAI_API_KEY=...` with `BD_PROVIDER=zai`.
Tuning: `BD_DRIFT_SECONDS` (default 180), `BD_SAMPLE_SECONDS` (default 15).

## Commands
`add <title> | <step>; <step> | allow: kw, kw | tag: <skill> | deadline: YYYY-MM-DD`, `d` done, `s` status, `p` pause,
`w` last nudge was wrong, `m` I drifted and you missed it, `r` kill-test report, `x` exit.

## Privacy
Only the app name and the rule that fired are logged. Window titles and screenshots are never stored.
Data lives in `%APPDATA%\body-double\state.json`.

## Talk to it through Claude (no terminal needed)
The companion runs as a background service (`npm run daemon`, 127.0.0.1 only, token in `%APPDATA%\body-double\daemon.json`).
An MCP server (`src/mcp.js`) gives Claude tools: `companion_status`, `companion_add_quest`, `companion_complete_step`,
`companion_activate_quest`, `companion_add_steps`, `companion_pause`, `companion_feedback`, `companion_report`,
`companion_import_jarvis`. It starts the background service automatically when needed.

Register it once (backs up `~/.claude.json`, adds one entry): `node scripts/register-mcp.mjs` (remove with `--remove`).
Then just tell Claude: "I'm starting Banafah, steps are…", "done with that", "how am I doing?".

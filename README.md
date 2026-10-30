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

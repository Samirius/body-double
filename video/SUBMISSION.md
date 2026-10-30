# Submission answers (draft — fill the two placeholders after the first real session)

**Project name:** (working name: body-double — final name and lore still to choose)
**Track:** Indie Developer · **Theme:** Build for Your World
**Repository:** https://github.com/Samirius/body-double (currently private — make public before submitting)
**Video:** <upload video/out/demo.mp4 after re-recording the narration in your own voice>

**One line:** A proactive focus companion for ADHD brains: it speaks first when you drift, gives one next action under two minutes, learns from your feedback, and turns finished work into a game with a pixel familiar that evolves.

**What it does**
I have ADHD, and every focus tool I've tried waits for me to open it. This one watches which window I'm in (titles stay in memory, never on disk) and, when I drift for a few minutes, the familiar on my screen speaks up with my quest and one tiny next action. "Wrong nudge" and "you missed it" teach it per quest (YouTube can be fine for one quest and a trap for another) and tune how long it waits. When it can't tell whether a site fits, it asks the model once and remembers; if I'm stuck on a step for 25 minutes it offers a smaller one; it opens the day with a plan and closes it with what I won. Progress is the game: XP only for finished steps, deadlines as bosses with HP bars, streaks that forgive a missed day, titles, and a familiar that grows an antenna, wings and a crown. I don't type commands: I tell Claude "I'm starting the Banafah verification" or "done with that", and it drives the companion through MCP tools.

**How it's built**
pi agent runtime (`@earendil-works/pi-agent-core` + `pi-ai`): one agent writes nudges through `nudge` / `split_step` tools, another judges unclear windows through a `verdict` tool; both fall back to templates without a model. Meta models through pi-ai's Meta provider (Muse Spark; `META_API_KEY`). Local background service (127.0.0.1, token), MCP server for Claude, Electron pet with procedural pixel art, deterministic game rules (the model never awards XP), 47 automated tests plus an end-to-end pet self-test that launches the real app.

**Honest status**
- Meta API credits ran out during the event; without a key the companion runs on templates and the judge is off. <say which model the final session used>
- Evidence from real use: <numbers from `npm run stats` after the first full session — or "pending">.
- Windows only.

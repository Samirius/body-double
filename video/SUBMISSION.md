# Submission answers (copy into the hackathon form)

**Project name:** Nudgling
**Tagline:** The body double that speaks first.
**Track:** Indie Developer · **Theme:** Build for Your World
**Repository:** https://github.com/Samirius/body-double
**Video:** upload `video/out/demo.mp4` (about 2 min; rebuild any time with `npm run video`)

**One line**
A proactive focus companion for ADHD brains: a pixel creature on your screen that speaks first when you drift,
gives one next action under two minutes, learns from your feedback, and turns finished work into a game.

**Inspiration**
I have ADHD. Every focus tool I've tried waits for me to open it, which is exactly what an ADHD brain doesn't do.
A body double, someone next to you while you work, is one of the few things that reliably helps. I wanted one
that is always there and starts the conversation itself.

**What it does**
Nudgling watches which window is in front (titles stay in memory, never on disk). When I drift for a few minutes,
the creature on the bottom of my screen names my quest and gives one tiny next action: Done, Park it (save the
distraction for later), Snooze, or Wrong. "Wrong" and "you missed it" teach it per quest: YouTube can be research
for one quest and a trap for another. It also tunes how long it waits. Clicking the creature starts a focus
session: a ring counts down around it, then it sends me on a 5-minute break and stays quiet. When I'm stuck on a
step for 25 minutes it offers a smaller one. It opens the day with a plan and closes it with what I won. Progress
is the game: XP only for finished steps, deadlines as bosses with HP bars, streaks that forgive a missed day, and a
creature that evolves. I don't type commands: I tell Claude "I'm starting the Banafah verification" or "done with
that", and Claude drives it through MCP tools. It starts with Windows; there is nothing to run.

**How we built it (Meta AI)**
- A **pi agent** (`@earendil-works/pi-agent-core` + `pi-ai`) writes every nudge through `nudge` / `split_step`
  tools.
- The writing models form a chain:
  1. **Muse Spark** through pi-ai's Meta provider, when a Meta key or Muse sign-in is set.
  2. **Llama 3.2 3B Instruct running on the user's own PC** (llama.cpp, 127.0.0.1), offline and free.
  3. Built-in templates.

  A failed model falls through to the next one, so the companion never goes silent.
- A small local decision model (Kev) answers one question with probabilities: "does this window fit the quest?"
  It stays quiet unless it is at least 75% sure.
- Window contents never leave the machine.
- The background service listens on 127.0.0.1 only and requires a token.
- The creature, bubble, ring and HUD are an Electron overlay with procedural pixel art.
- The game rules are deterministic: the model never awards XP.

**Challenges**
- **The first local decision model failed my own test.** I scored it on 40 labelled window titles, and it called
  Netflix and Steam "work" with near certainty, catching 0 of 15 drifts at a safe threshold. Two fixes came from
  measuring:
  - Switching to a binary question took accuracy from 18% to 71%.
  - Dropping one extra input field stopped clear drifts from flipping to "work".
  - Then I replaced the model.
- **My Meta API credits ran out mid-event.** That is why Llama now runs on-device as part of the design, not as
  an afterthought.

**Accomplishments**
- 63 automated tests, passing from a clean clone.
- An end-to-end self-test that launches the real app and checks its screenshots.
- A 20-minute soak test with zero errors and no memory growth.
- Everything on the evaluation page is real, including the failure.

**What we learned**
- For ADHD, the ask has to be tiny and the timing gentle. A wrong nudge costs more trust than a missed one, so the
  local model only speaks when it is sure.

**What's next**
- A richer character with its own story.
- macOS support.
- A shared "co-working" mode where two people's creatures keep each other company.

**Honest status**
- Windows only.
- Real-use evidence is one person (n = 1); see docs/EVIDENCE.md.
- Muse Spark is wired in through pi-ai's Meta provider. This demo runs on Llama on-device because my Meta credits
  ran out.

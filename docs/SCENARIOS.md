# Scenarios

How Nudgling behaves in real days. Each scenario says what you do, what it does, and which test covers it.

## 1. Coding with an AI agent: the bug fix that grew

**You:** "Claude, the checkout button throws on submit, fix it."

1. Claude starts a quest through the skill: *Fix the checkout bug*, steps *Reproduce it → Find the line → Fix →
   Test*, `repo` = the project folder.
2. Ten minutes in: "while you're at it, also add a dark mode toggle." Before touching it, Claude runs the
   **scope check** → `creep`. The creature turns to you with "!", and the bubble says **"That's new scope, not
   'Fix the checkout bug'. Finish and commit this first, then park the new idea."** Claude offers the same
   three choices in one line: finish and commit, park it, or start it as its own quest.
3. You keep adding things anyway. 45 minutes later the repo has 10 changed files and no commit. **"10 files
   changed, no commit for 60 min. The scope is growing. Commit what works now, then park the rest."**
4. You commit, mark the step done: +10 XP, sparkles, "wee-oo".

*Tests:* `scope-guard.test.js` (scope creep, git pile-up), `rhythm-scope.test.js` (creep words, git limits),
`cli.test.js` (the same flow through the command line).

## 2. WordPress: same site, different job

**Quest:** *Edit the Elementor home page* (allow: `wordpress`, `my shop`).

1. You're in *Edit Page "Home" ‹ My Shop — Elementor*: on task. Every 5 focused minutes adds to the flow
   combo; an aura grows behind the creature (**FLOW ×3** at 15 min).
2. A customer emails about an order. You open *Orders ‹ My Shop — WooCommerce*, then an order, then the
   checkout settings. It's still "WordPress", so a keyword blocker would say you're working.
3. *Orders* wasn't among the pages of the quest's first 10 minutes, and you've stayed on it for 6 minutes:
   **"Side task? This looks like 'orders', not 'Edit the Elementor home page'."**
   Buttons: **Park it** (saved to the vault) or **Part of it** (that page joins this quest's scope and is never
   asked again).

*Tests:* `scope-guard.test.js` (Elementor → orders, "part of it" learning), `rhythm-scope.test.js` (page keys
merge "Order #1043" and "Order #1044"). No model needed: pages from the quest's first 10 minutes are its
scope, and a new page held 6+ minutes gets one question; your answer teaches it.

## 3. No agent at all: studying or writing

1. Morning: the creature wakes up and asks **"What are you working on right now?"** You type *Chapter 3
   summary*; it becomes the quest, and the model splits it into tiny steps (or asks for the first one).
2. You click the creature → **FOCUS 25**. A ring counts down around it.
3. You drift to YouTube for 3 minutes: "!" + "hm?", and the bubble shows the quest and one next step. If you
   ignore it twice more, there's fire, then a pixel bomb across the screen (2 s, click-through).
4. You go back within a minute: **QUICK RETURN // 40S** with a heart.
5. The ring ends with no drift at all: **PERFECT SESSION**, with gold rain across the screen.
6. Evening: "what you won today".

*Tests:* `pet-selftest` (question, plan, ring, bomb, rage, flow aura, side-task bubble: 12 screenshots),
`session.test.js`, `scope-guard.test.js` (perfect session), `feelings.test.js`.

## 4. Calls, meetings, presenting

You join a Zoom/Teams/Meet call, present slides, or share your screen. Nudgling goes **completely quiet**: no
nudges, no sounds, no full-screen effects, until 2 minutes after the call. Drift doesn't build up meanwhile, so
the first nudge after the call is not delayed by a cooldown. Over any fullscreen app (a video, a game, a slide
show) sounds and effects are off too.

*Tests:* `scope-guard.test.js` (Zoom scenario), `watcher.test.js` (fullscreen detection).

## 5. Hyperfocus

You've been at the screen for 90 minutes without a real break (5+ minutes away). **"90 minutes straight. Your
brain needs a refill. Stand up, drink water, look out a window for 2 min."** It says this once, and a focus
session's break counts as rest.

*Tests:* `rhythm-scope.test.js`.

## 6. Several AI agents at once

Claude Code in one window, Codex in another, Hermes on a server, the HUD on the desktop: they all talk to the
same local service, so there's one quest list, one combo, one game. Connect each with
`nudgling connect <agent>` (or `connect all`). Agents without MCP use the `nudgling` command line.

*Tests:* `connect.test.js` (7 agents' config formats), `integration.test.js` (MCP end to end).

## 7. A snooze-heavy day

The 1st and 2nd snooze get a sigh. The 3rd within an hour gets **"SNOOZE #3. I'M NOT MAD."** in giant glitch
text, with "One tiny step, then snooze all you want." It's never louder than that, and FX/SOUND switches are
in the creature's menu.

*Tests:* `feelings.test.js`, `pet-selftest` (8-fx-rage).

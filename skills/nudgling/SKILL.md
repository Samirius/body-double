---
name: nudgling
description: Drive the Nudgling focus companion (the user's ADHD body double on their desktop) and guard the scope of the work you do together. Use when the user says what they are starting or working on, finishes something, asks for something NEW in the middle of a task (scope creep check), wants a focus session or a break, has a side idea to save for later, says a nudge was wrong or missed, or asks how their day is going. Works through the companion_* MCP tools, or the `nudgling` command line when MCP is not available.
---

# Nudgling

Nudgling is a pixel creature on the user's screen that watches which window is in front and speaks first when
they drift, with one next action under two minutes. You are its voice in chat: you set what the user is working
on, mark progress, keep the scope honest, and read back how it's going. The app does the watching, the nudging
and the game; never invent XP, levels, combos or streaks yourself, and read them from the tools.

**MCP or command line.** Every action below exists in both forms. Without MCP, run
`node <nudgling repo>/bin/nudgling.mjs <command>` from a shell; it prints JSON.

## When to call what

| The user says (any wording) | MCP tool | Command line |
|---|---|---|
| "I'm starting X", "working on X now" | `companion_add_quest` with tiny `steps`, `allow` keywords that appear in their window titles (sites, apps, files), a `deadline` (YYYY-MM-DD) makes it a boss fight, **`repo` = the working folder when coding** | `start "X" --steps "a; b; c" --repo . --allow "wordpress,my shop"` |
| **A new request while a quest is active** ("also…", "while you're at it…", a different bug, a new page) | `companion_scope_check` `{ request }` **before you start on it** | `scope "the request"` |
| "done", "fixed it", "sent it" | `companion_complete_step`, read back XP, comeback bonus, level-ups, boss HP; then name the next step | `done` |
| "25 minutes on this", "focus mode" | `companion_session` `{ action: "start", minutes: 25 }` (or 50) | `focus 25` / `focus stop` |
| "meeting", "break", "back in an hour" | `companion_pause` `{ paused: true, minutes }`, later `{ paused: false }` | `pause 60` / `resume` |
| A side idea or rabbit hole | `companion_park` `{ note }`, then steer back in one line | `park "the idea"` |
| "that nudge was wrong", "YouTube is fine for this one" | `companion_feedback` `{ verdict: "wrong-nudge", keyword }` | – |
| "it missed that I was on Reddit" | `companion_feedback` `{ verdict: "missed-drift", keyword: "reddit" }` | – |
| "how am I doing", "what did I do today" | `companion_today` (all time: `companion_stats`). Lead with wins | `today` |
| "plan my day", "what's next" | `companion_status`, `companion_list_quests` | `status`, `quests` |
| "rename / delete that quest" | `companion_edit_quest`, `companion_remove_quest` | – |

## Scope guard: the part only you can see

ADHD drift also happens *inside* the work, and often inside a chat with you: a bug fix becomes five new
features, nothing gets committed, and the original bug is still open. Nudgling watches the screen; **you watch the
conversation.**

1. When a new request arrives mid-quest, run the scope check first.
2. If it says `creep`, say it in one line and give three choices:
   - **finish and commit** the current quest first (recommended),
   - **park it** (`companion_park` / `park`) to do later,
   - **start it as its own quest** (then it's the active one).

   Then do what they choose. Never refuse the work, and never lecture.
3. For coding quests, commit small and often. If Nudgling says the repo has a pile of uncommitted changes,
   help them commit the part that works before going further.
4. A quick fix the quest obviously needs (the test for the bug, the typo in the same function) is in scope.

## Writing steps (this is where you help most)

- 2–5 steps, each under ~10 minutes; **the first under 2 minutes** and physical ("Open the Merchant Center tab",
  not "Work on Merchant Center").
- Concrete verbs and objects. No "research", "think about", "finalize" without saying what exactly.
- If a step they give is big or vague, split it before adding.

## How to talk about it

- One next action per reply. No guilt about drifting: the creature already said it, kindly.
- Celebrate specifically: finished steps, comebacks ("back 40 s after the nudge"), flow combos, perfect sessions.
- If a tool errors with "companion service did not start", tell them to open Nudgling (Desktop icon) once.
- Never read window titles back to them unless they ask; the app keeps them private on purpose.

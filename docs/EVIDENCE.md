# Evidence

Everything here was measured on Samir's PC (Windows 10, AMD Ryzen 5 2400G, 14 GB RAM, CPU only). Raw files are
in `eval/`. Where something failed, it says so.

## 1. Automated tests: 63 pass
`npm test` covers the core rules, the brain and its model chain, learning from feedback, focus sessions, the
vault, the local decision model, the background service end to end, and the pet's behaviour. No key or model is
needed: models are replaced by pi-ai's faux provider or by a stand-in OpenAI-compatible server.

`npm run test:pet` launches the real Electron app, drives it (a nudge, cheering, sleeping, the HUD, adding a
quest, starting a focus session from the creature's own menu) and checks the six screenshots. The images in
`docs/screens/` come from this run.

## 2. Soak test: 20 minutes, no leaks, no errors
`npm run soak` ran the real service with the real window watcher, sampling every 2 s
(`eval/soak/soak-2026-11-01.json`):

| | Result |
|---|---|
| Service memory | 63 MB → 26 MB (no growth) |
| Watcher helper processes | always 1 |
| Tick errors | 0 |
| Watcher restarts | 0 |

## 3. Local decision model: the first one failed, so it was replaced
The decision model only answers "does this window fit the quest?" for windows the rules can't place. It has to be
**quiet when unsure** (a wrong nudge costs trust) and still catch real drift. It is scored on 40 labelled window
titles (`eval/decider/cases.json`): 25 on-task, 15 drifts across five quests, including Arabic titles.

**Julia-1 (144M), 2026-11-01** (`eval/decider/results-julia-1.json`). Median 349 ms per decision.

| Threshold | Accuracy | False nudges | Missed drifts (of 15) |
|---|---|---|---|
| 0.50 | 71% | 0 | 10 |
| 0.75 (default) | 56% | 0 | **15** |

It never nudged wrongly, but it called Netflix, Steam and a cat-video compilation "work" with near certainty, so
at a safe threshold it caught **no** drifts. Two findings shaped the code:
- A third "unsure" answer option absorbed 29 of 40 answers (18% accuracy), so the question is now binary and
  uncertainty comes from the probability.
- Adding "minutes in this window" as an extra field flipped clear drifts to "work", so it is not sent.

**Kev (0.8B / 4B):** <!-- KEV --> pending the first run with the models on (see the README).

## 4. Nudge writer: Llama 3.2 3B on this PC
<!-- WRITER --> pending the first run with the models on. `npm run eval:writer` runs eight fixed events (drift, second
drift, return, stuck, morning, evening, no quest, off-topic chat) and checks that Llama calls the nudge tool,
stays short, names the quest and never invents XP.

## 5. Real use (n = 1)
<!-- REAL --> pending: one normal work hour with Nudgling on. The kill test is passed if it catches at least 4 of 5
real drifts with at most 1 wrong nudge. `npm run stats` turns the log into a page.

# Submission video — storyboard and narration (target 2:45)

Rule for every frame: **real renders and real numbers only.** The pet, bubble and panel shots come from
`npm run test:pet` (the real app). The evidence slide is built from your real `state.json`; until the kill test has
run it says "pending", never a made-up number.

Build a draft any time: `npm run video` → `video/out/demo.mp4` + `.srt` (computer voice). For the final cut,
record yourself reading the narration below (your voice is the story) and re-run with `--voice <your.wav>` per
slide, or just replace the audio track.

| # | Time | On screen | Narration (read it in your own words) |
|---|---|---|---|
| 1 | 0:00 | Title + the familiar | I have ADHD. Every focus app I've tried waits for me to open it. I never do. So I built one that speaks first. |
| 2 | 0:12 | Sprite sheet (6 poses × 4 stages) | Meet the familiar. It lives along the bottom of my screen, it sleeps when I'm away, it worries when I drift, and it celebrates when I finish something. |
| 3 | 0:27 | Real nudge bubble | When I drift for a few minutes, it doesn't lecture me. It names my quest and gives me one next action I can do in under two minutes. Done, snooze, or "wrong nudge". |
| 4 | 0:45 | Learning diagram | Wrong nudges and missed drifts teach it. YouTube can be fine for one quest and a trap for another, and it learns how long to wait before speaking up. |
| 5 | 1:02 | Smarter watching | When it can't tell, it asks the model once and remembers. If I'm stuck on a step for 25 minutes, it offers a smaller one. It opens my day with a plan and closes it with what I won. |
| 6 | 1:22 | Real cheer + panel | Progress is the game: XP for finished steps, never for time. Deadlines are bosses with health bars. Streaks forgive a missed day. The familiar evolves as I level up. |
| 7 | 1:44 | MCP tools | I don't type commands anywhere. I tell Claude "I'm starting the Banafah verification" or "done with that", and it drives the companion through MCP tools. |
| 8 | 2:00 | Built on pi + privacy | It's built on the pi agent runtime with Meta's models through pi's Meta provider. Window titles stay in memory, nothing is screenshotted unless I turn it on, and it runs locally. |
| 9 | 2:18 | Evidence (real numbers or "pending") | Here is what actually happened when I used it: drifts caught, how fast I came back, steps finished. One person, honest numbers. |
| 10 | 2:36 | Close | It's not a productivity app. It's a body double that speaks first. |

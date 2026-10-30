#!/usr/bin/env node
// Builds the submission video draft from REAL material only:
//  - pet/bubble/panel shots from the real app (npm run test:pet),
//  - the sprite sheet (docs/sprites.png),
//  - evidence numbers from your real state.json ("pending" when there are none).
// Steps: frames (HTML -> PNG via Electron) -> narration (Windows TTS) -> ffmpeg.
//   npm run video            -> video/out/demo.mp4 + demo.srt
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { defaultDataDir } from '../src/core/store.js';
import { buildStats } from '../src/stats.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, 'out');
const shots = path.join(out, 'shots');
const frames = path.join(out, 'frames');
mkdirSync(frames, { recursive: true });
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`); };

// 1. Real app screenshots.
if (!process.argv.includes('--reuse-shots') || !existsSync(path.join(shots, '4-panel.png'))) run(process.execPath, ['scripts/pet-selftest.mjs', shots]);
if (!existsSync(path.join(root, 'docs', 'sprites.png'))) run(process.execPath, ['scripts/sprite-sheet.mjs', 'docs/sprites.png', '6']);
const img = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
// The pet shots are full-width strips; crop to the area around the pet.
const strip = (name) => img(path.join(shots, `${name}.png`));

// 2. Real evidence (or an explicit "pending").
let evidence = null;
try {
  const st = JSON.parse(readFileSync(path.join(process.env.BD_DATA_DIR || defaultDataDir(), 'state.json'), 'utf8'));
  const s = buildStats(st);
  // Only a real session counts: at least one finished step (a quest was in play).
  if (s.totals.steps > 0) evidence = s.totals;
} catch { /* no real data yet */ }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const slides = [];
const add = (body, say) => slides.push({ body, say });
// The pet shots are 260 px tall full-width strips; show the right-hand part, scaled.
const cropStrip = (src, w = 900, h = 390) => `<div class="crop" style="width:${w}px;height:${h}px"><img src="${src}"></div>`;

add(`<div class="center"><div class="kicker">Meta Global AI Developer Hackathon · Indie · Build for Your World</div><h1>A body double<br>that speaks first</h1><p class="lead">A proactive focus companion for ADHD brains, built on the pi agent runtime.</p></div>`,
  'I have ADHD. Every focus app I have tried waits for me to open it. I never do. So I built one that speaks first.');
add(`<h2>Meet the familiar</h2><img class="sheet" src="${img(path.join(root, 'docs', 'sprites.png'))}"><p class="note">Six moods, four evolution stages. Procedural pixel art, drawn by code.</p>`,
  'Meet the familiar. It lives along the bottom of my screen. It sleeps when I am away, it worries when I drift, and it celebrates when I finish something.');
add(`<h2>When I drift, it speaks first</h2>${cropStrip(strip('2-pet-nudge'))}<div class="chips"><span>Names the quest, never lectures</span><span><b>One next action</b> under 2 min</span><span>Done · Snooze · Wrong nudge</span></div>`,
  'When I drift for a few minutes, it does not lecture me. It names my quest and gives me one next action I can do in under two minutes. Done, snooze, or wrong nudge.');
add(`<h2>It learns from me</h2><div class="flow"><div>Wrong nudge<small>that site is fine for this quest · wait 30 s longer</small></div><div>Missed drift<small>block what I was on · react 30 s sooner</small></div><div>Every rule<small>can be listed and undone</small></div></div>`,
  'Wrong nudges and missed drifts teach it. YouTube can be fine for one quest and a trap for another, and it learns how long to wait before speaking up.');
add(`<h2>Smarter than a blocklist</h2><ul class="big"><li><b>Unclear for 6 min?</b> It asks the model once and remembers</li><li><b>Stuck 25 min?</b> It offers a smaller step</li><li><b>Morning plan, evening summary</b></li></ul>`,
  'When it cannot tell, it asks the model once and remembers. If I am stuck on a step for twenty five minutes, it offers a smaller one. It opens my day with a plan and closes it with what I won.');
add(`<h2>Progress is the game</h2><div class="pair">${cropStrip(strip('1-pet-cheer'), 600, 390)}<img class="panel" src="${strip('4-panel')}"></div><p class="note">XP for finished steps, never time · deadlines are bosses · streaks forgive a missed day · the familiar evolves</p>`,
  'Progress is the game. XP for finished steps, never for time. Deadlines are bosses with health bars. Streaks forgive a missed day, and the familiar evolves as I level up.');
add(`<h2>I just talk to Claude</h2><pre class="code">"I'm starting the Banafah verification:
 store hours, photo, request review. Due Nov 6."
  → companion_add_quest   (boss fight, 3 steps)
"done with that"
  → companion_complete_step  (+15 XP, comeback bonus)
"that nudge was wrong"
  → companion_feedback       (learned: youtube is fine here)</pre>`,
  'I do not type commands anywhere. I tell Claude what I am starting, or that I am done, and it drives the companion through M C P tools.');
add(`<h2>Built on pi · private by default</h2><ul class="big"><li>pi agent runtime; Meta models via pi's Meta provider</li><li>Window titles stay in memory, never on disk</li><li>No screenshots unless you turn them on</li><li>Local service, 127.0.0.1 only</li></ul>`,
  'It is built on the pi agent runtime, with Meta models through pi\'s Meta provider. Window titles stay in memory, nothing is screenshotted unless I turn it on, and it all runs locally.');
if (evidence) {
  const e = evidence;
  add(`<h2>What actually happened</h2><div class="tiles"><div><b>${e.driftNudges}</b>drift nudges</div><div><b>${e.returns}</b>turned around</div><div><b>${e.medianReturnSeconds == null ? '–' : `${Math.round(e.medianReturnSeconds / 60) || '<1'} min`}</b>median time back</div><div><b>${e.steps}</b>steps finished</div><div><b>${e.wrongNudges}</b>wrong nudges</div><div><b>${e.missedDrifts}</b>missed drifts</div></div><p class="note">One person's real use (n = 1). Not a study.</p>`,
    `Here is what actually happened when I used it. ${e.driftNudges} drift nudges, ${e.returns} of them turned around, and ${e.steps} steps finished. One person, honest numbers.`);
} else {
  add(`<h2>What actually happened</h2><p class="lead pending">Real-use numbers: pending the first full work session.</p>`, 'Real use numbers will go here after my first full session with it.');
}
add(`<div class="center"><h1>Not a productivity app.</h1><p class="lead">A body double that speaks first.</p></div>`, 'It is not a productivity app. It is a body double that speaks first.');

const css = `*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;background:#0b1220;color:#e6edf7;font-family:'Segoe UI',system-ui,sans-serif;position:relative;overflow:hidden}
.wrap{position:absolute;inset:0 0 120px 0;padding:44px 64px}h1{font-size:62px;margin:10px 0;line-height:1.1}h2{font-size:38px;margin:0 0 22px;color:#fff}
.center{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}.kicker{color:#6ee7b7;font-size:20px}
.lead{font-size:26px;color:#cbd5e1;line-height:1.5}.note{color:#94a3b8;font-size:20px;margin-top:14px}.pending{color:#fcd34d}
.big li{font-size:27px;margin:14px 0}b{color:#fff}.sheet{height:400px;image-rendering:pixelated;border-radius:12px}
.crop{position:relative;overflow:hidden;border-radius:12px;background:#f8fafc}.crop img{position:absolute;right:0;bottom:0;height:100%;image-rendering:pixelated}
.chips{display:flex;gap:12px;margin-top:18px}.chips span{background:#15213a;border:1px solid #27406b;border-radius:99px;padding:10px 18px;font-size:21px}
.pair{display:flex;gap:24px;align-items:flex-start}.panel{height:390px;border-radius:12px}
.flow{display:flex;gap:16px;margin-top:30px}.flow div{flex:1;background:#15213a;border:1px solid #27406b;border-radius:14px;padding:22px;font-size:26px;font-weight:700}.flow small{display:block;font-size:18px;font-weight:400;color:#94a3b8;margin-top:8px}
.code{background:#020617;border-radius:12px;padding:22px;font-size:22px;line-height:1.5;color:#a7f3d0}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.tiles div{background:#15213a;border-radius:12px;padding:18px;font-size:18px;color:#94a3b8}.tiles b{display:block;font-size:44px}
.cap{position:absolute;left:0;right:0;bottom:0;height:120px;background:#020617;border-top:1px solid #1e293b;padding:16px 64px;font-size:22px;line-height:1.4;color:#f1f5f9;display:flex;align-items:center}`;

// 3. Frame HTML per narrated sentence; Electron renders them to PNG.
const manifest = [];
slides.forEach((s, i) => s.say.split(/(?<=[.!?])\s+(?=[A-Z])/).forEach((sentence, j, arr) => {
  const n = `${String(i + 1).padStart(2, '0')}-${String(j + 1).padStart(2, '0')}`;
  writeFileSync(path.join(frames, `frame${n}.html`), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="wrap">${s.body}</div><div class="cap">${esc(sentence)}</div></body></html>`);
  manifest.push({ n, last: j === arr.length - 1, say: sentence });
}));
writeFileSync(path.join(frames, 'manifest.json'), JSON.stringify(manifest, null, 2));
const electron = createRequire(import.meta.url)('electron');
run(electron, [path.join(here, 'render-frames.mjs'), frames]);

// 4. Narration + assembly.
run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'render.ps1'), '-Dir', frames, '-OutFile', path.join(out, 'demo.mp4')]);
console.log(`video: ${path.join(out, 'demo.mp4')}  (evidence slide: ${evidence ? 'real numbers' : 'pending'})`);

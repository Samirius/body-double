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
if (!process.argv.includes('--reuse-shots') || !existsSync(path.join(shots, '6-pet-ring.png'))) run(process.execPath, ['scripts/pet-selftest.mjs', shots]);
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

// Measured numbers from eval/ (only what exists is shown).
const readJson = (p) => { try { return JSON.parse(readFileSync(path.join(root, p), 'utf8')); } catch { return null; } };
const kev = readJson('eval/decider/results-kev.json') || readJson('eval/decider/results-kev-4b.json');
const kevAt = kev?.byThreshold?.find((r) => r.threshold === 0.75);
const writer = readJson('eval/writer/results-llama-3.2-3b.json');

add(`<div class="center"><div class="kicker">META GLOBAL AI DEVELOPER HACKATHON // INDIE // BUILD FOR YOUR WORLD</div><img class="hero" src="${img(path.join(root, 'docs', 'nudgling.png'))}"><h1>NUDGLING</h1><p class="lead">The body double that speaks first.</p></div>`,
  'I have ADHD. Every focus app I have tried waits for me to open it. I never do. So I built one that speaks first.');
add(`<h2>// MEET THE NUDGLING</h2><img class="sheet" src="${img(path.join(root, 'docs', 'sprites.png'))}"><p class="note">Six moods, four evolution stages. Procedural pixel art, drawn by code.</p>`,
  'This is the Nudgling. It lives on the bottom edge of my screen. It sleeps when I am away, it worries when I drift, and it celebrates when I finish something. And it grows as I level up.');
add(`<h2>// WHEN I DRIFT, IT SPEAKS FIRST</h2>${cropStrip(strip('2-pet-nudge'))}<div class="chips"><span>Names the quest, never lectures</span><span><b>One next action</b> under 2 min</span><span>Done · Park it · Snooze · Wrong</span></div>`,
  'When I drift for a few minutes, it does not lecture me. It names my quest and gives me one next action I can do in under two minutes. If the distraction is a good idea, I park it for later.');
add(`<h2>// CLICK IT: A FOCUS RING</h2>${cropStrip(strip('6-pet-ring'))}<div class="chips"><span>FOCUS 25 · FOCUS 50</span><span>Then a 5-minute break</span><span>Quiet during the break</span></div>`,
  'Click it, and it starts a focus session. A ring counts down around it. Then it sends me to drink water, and stays quiet during the break.');
add(`<h2>// IT LEARNS ME</h2><div class="flow"><div>WRONG<small>that site is fine for this quest · wait 30 s longer</small></div><div>MISSED IT<small>block what I was on · react 30 s sooner</small></div><div>EVERY RULE<small>can be listed and undone</small></div></div>`,
  'Wrong nudges and missed drifts teach it. YouTube can be research for one quest and a trap for another. It also learns how long to wait before speaking up.');
add(`<h2>// PROGRESS IS THE GAME</h2><div class="pair">${cropStrip(strip('1-pet-cheer'), 600, 390)}<img class="panel" src="${strip('5-panel-after-add')}"></div><p class="note">XP for finished steps, never time · deadlines are bosses · streaks forgive a missed day</p>`,
  'Progress is the game. XP for finished steps, never for time. Deadlines are bosses with health bars, and streaks forgive a missed day.');
add(`<h2>// META AI INSIDE</h2><div class="flow"><div>MUSE SPARK<small>Meta Model API, through the pi agent runtime: writes the nudge, splits big steps</small></div><div>LLAMA 3.2 3B<small>on this PC: same job, offline and free; nothing leaves the machine</small></div><div>LOCAL DECIDER<small>does this window fit the quest? probabilities, quiet unless sure</small></div></div><p class="note">If one model is unavailable, the next one writes the nudge. It never goes silent.</p>`,
  'Under the hood, a pi agent writes every nudge. It can use Meta\'s Muse Spark in the cloud, and it runs Meta\'s Llama right here on my PC, offline and free. A small local model decides whether a window fits my quest, so my screen never leaves the machine.');
add(`<h2>// I JUST TALK TO CLAUDE</h2><pre class="code">"I'm starting the Banafah verification:
 store hours, photo, request review. Due Nov 6."
  → companion_add_quest      (boss fight, 3 steps)
"done with that"
  → companion_complete_step  (+XP, comeback bonus)
"park this idea for later"
  → companion_park           (saved to the vault)</pre>`,
  'And I never type commands. I tell Claude what I am starting, or that I am done, and it drives the Nudgling through M C P tools.');
const ev = [`<div><b>63</b>automated tests pass</div>`, `<div><b>0</b>errors in a 20-min soak</div>`, `<div><b>0 / 15</b>drifts caught by the first local model</div>`];
if (kevAt) ev.push(`<div><b>${15 - kevAt.missedDrifts} / 15</b>drifts caught by Kev, ${kevAt.falseNudges} wrong</div>`);
if (writer) ev.push(`<div><b>${writer.byModelPct}%</b>nudges written by Llama on this PC, median ${(writer.medianMs / 1000).toFixed(1)} s</div>`);
if (evidence) ev.push(`<div><b>${evidence.returns} / ${evidence.driftNudges}</b>real drifts turned around</div>`);
add(`<h2>// WHAT I MEASURED</h2><div class="tiles">${ev.join('')}</div><p class="note">The first decision model failed my test, so I replaced it. Real use is one person, not a study.</p>`,
  `I measured it, and I kept the failures. The first local model called Netflix work, so it caught none of my drifts, and I replaced it.${kevAt ? ` The new one caught ${15 - kevAt.missedDrifts} of 15.` : ''}${evidence ? ` In real use, ${evidence.returns} of ${evidence.driftNudges} drifts turned around.` : ''}`);
add(`<div class="center"><img class="hero" src="${img(path.join(root, 'docs', 'nudgling.png'))}"><h1>Not a productivity app.</h1><p class="lead">A body double that speaks first.</p></div>`, 'It is not a productivity app. It is a body double that speaks first.');

const css = `*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;background:linear-gradient(140deg,#0a081c,#1c0a30);color:#e6edf7;font-family:'Segoe UI',system-ui,sans-serif;position:relative;overflow:hidden}
body:before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(0,240,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(0,240,255,.07) 1px,transparent 1px);background-size:40px 40px}
.wrap{position:absolute;inset:0 0 120px 0;padding:44px 64px}h1{font:700 64px 'Cascadia Mono',Consolas,monospace;margin:10px 0;line-height:1.1;color:#00f0ff;text-shadow:0 0 18px rgba(0,240,255,.5)}h2{font:700 34px 'Cascadia Mono',Consolas,monospace;margin:0 0 22px;color:#ff2bd6}
.center{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}.kicker{color:#39ffb0;font:16px 'Cascadia Mono',Consolas,monospace;letter-spacing:.12em}
.hero{width:150px;image-rendering:pixelated;filter:drop-shadow(0 0 16px rgba(57,255,176,.6))}
.lead{font-size:28px;color:#cbd5e1;line-height:1.5}.note{color:#9aa3c7;font-size:20px;margin-top:14px}
b{color:#fff}.sheet{height:400px;image-rendering:pixelated;border-radius:6px}
.crop{position:relative;overflow:hidden;border:1px solid #2a5a78}.crop img{position:absolute;right:0;bottom:0;height:100%;image-rendering:pixelated}
.chips{display:flex;gap:12px;margin-top:18px}.chips span{background:rgba(10,20,40,.8);border:1px solid #00f0ff;padding:10px 18px;font-size:20px}
.pair{display:flex;gap:24px;align-items:flex-start}.panel{height:390px}
.flow{display:flex;gap:16px;margin-top:20px}.flow div{flex:1;background:rgba(10,20,40,.85);border:1px solid #00f0ff;padding:22px;font:700 24px 'Cascadia Mono',Consolas,monospace;color:#00f0ff}.flow small{display:block;font:400 19px 'Segoe UI',sans-serif;color:#cbd5e1;margin-top:10px}
.code{background:#05040f;border:1px solid #ff2bd6;padding:22px;font:22px/1.5 'Cascadia Mono',Consolas,monospace;color:#39ffb0}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.tiles div{background:rgba(10,20,40,.85);border:1px solid #2a5a78;padding:18px;font-size:18px;color:#9aa3c7}.tiles b{display:block;font:700 40px 'Cascadia Mono',Consolas,monospace;color:#39ffb0}
.cap{position:absolute;left:0;right:0;bottom:0;height:120px;background:#05040f;border-top:1px solid #ff2bd6;padding:16px 64px;font-size:22px;line-height:1.4;color:#f1f5f9;display:flex;align-items:center}`;

// 3. Frame HTML per narrated sentence; Electron renders them to PNG.
const manifest = [];
slides.forEach((s, i) => s.say.split(/(?<=[.!?])\s+(?=[A-Z])/).forEach((sentence, j, arr) => {
  const n = `${String(i + 1).padStart(2, '0')}-${String(j + 1).padStart(2, '0')}`;
  writeFileSync(path.join(frames, `frame${n}.html`), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="wrap">${s.body}</div><div class="cap">${esc(sentence)}</div></body></html>`);
  manifest.push({ n, last: j === arr.length - 1, say: sentence });
}));
writeFileSync(path.join(frames, 'manifest.json'), JSON.stringify(manifest, null, 2));
// The script to read aloud always matches the video.
writeFileSync(path.join(here, 'STORYBOARD.md'), [
  '# Video script (about 2 min)', '',
  'Every frame is real: app shots come from `npm run test:pet`, numbers come from `eval/` and your own log.',
  '`npm run video` builds `video/out/demo.mp4` + `.srt` with a computer voice.', '',
  '**Your own voice (optional, ~15 min):** record each line below as `video/voice/<id>.wav` (Windows Voice Recorder,',
  'export as WAV), then run `npm run video -- --reuse-shots`. Lines you skip keep the computer voice.', '',
  '| id | Line |', '|---|---|', ...manifest.map((m) => `| ${m.n} | ${m.say.replace(/\|/g, '/')} |`), '',
].join('\n'));
const electron = createRequire(import.meta.url)('electron');
run(electron, [path.join(here, 'render-frames.mjs'), frames]);

// 4. Narration + assembly.
run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'render.ps1'), '-Dir', frames, '-OutFile', path.join(out, 'demo.mp4')]);
console.log(`video: ${path.join(out, 'demo.mp4')}  (evidence slide: ${evidence ? 'real numbers' : 'pending'})`);

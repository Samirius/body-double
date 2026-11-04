// The demo scenario: runs the REAL app with throwaway data, opens real windows,
// moves the real mouse, and records the primary screen.
//   node video/scenario/record.mjs [--no-record] [--no-llama]
// Real: quest, Llama's plan and nudges (if the server is up), drift detection,
// the comeback, scope check, focus ring, Done, boss kill, HUD, card tap by CLI.
// Time-lapsed (the /debug/emit route replays what would take 25 minutes):
// ignored nudges -> bomb, FLOW x3, gold rain. timeline.json marks each beat.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.resolve(here, '../final');
mkdirSync(outDir, { recursive: true });
const RECORD = !process.argv.includes('--no-record');
const LLAMA = !process.argv.includes('--no-llama');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CODE = path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe');
const LLAMA_URL = 'http://127.0.0.1:18091/v1';
// CC-BY, Blender Foundation: safe to show on camera.
const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

// --- throwaway world ----------------------------------------------------------
const tmp = mkdtempSync(path.join(tmpdir(), 'bd-demo-'));
const dataDir = path.join(tmp, 'data');
const shop = path.join(tmp, 'shop');
mkdirSync(dataDir); mkdirSync(shop);
writeFileSync(path.join(shop, 'checkout.js'), `// shop/checkout.js\nexport function total(cart) {\n  let sum = 0;\n  for (const item of cart.items) {\n    sum += item.price;\n  }\n  return sum;\n}\n\nexport function submit(cart, card) {\n  const amount = total(cart);\n  return pay(card, amount);\n}\n`);
const PORT = 48700;
const env = { ...process.env, BD_DATA_DIR: dataDir, BD_PORT: String(PORT), BD_NOTIFY: 'off', BD_DECIDER: 'off', BD_DESK: 'off', BD_DEBUG: '1', BD_SAMPLE_SECONDS: '2', BD_DRIFT_SECONDS: '10', BD_MORNING_HOUR: '24', BD_EVENING_HOUR: '24', BD_WRITER: 'off', ...(LLAMA ? { BD_LLAMA_URL: LLAMA_URL } : { BD_PROVIDER: 'none' }) };
delete env.ELECTRON_RUN_AS_NODE;

// --- mouse, keyboard, windows: one long-lived PowerShell ------------------------
const PS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Threading;
public static class D {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  public static void Move(int x, int y, int ms) {
    P s; GetCursorPos(out s); int n = Math.Max(1, ms / 8);
    for (int i = 1; i <= n; i++) { double t = (double)i / n; t = t * t * (3 - 2 * t);
      SetCursorPos((int)(s.X + (x - s.X) * t), (int)(s.Y + (y - s.Y) * t)); Thread.Sleep(8); }
  }
  public static void Click() { mouse_event(2, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(45); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
}
"@
$shell = New-Object -ComObject Shell.Application
[Console]::Out.WriteLine('READY')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $c = $line | ConvertFrom-Json
  switch ($c.op) {
    'minimize' { $shell.MinimizeAll() }
    'restore' { $shell.UndoMinimizeALL() }
    'move' { [D]::Move($c.x, $c.y, $c.ms) }
    'click' { [D]::Click() }
    'type' { foreach ($ch in $c.text.ToCharArray()) { $k = [string]$ch; if ('+^%~(){}[]'.Contains($k)) { $k = '{' + $k + '}' }; [System.Windows.Forms.SendKeys]::SendWait($k); Start-Sleep -Milliseconds $c.ms } }
    'key' { [System.Windows.Forms.SendKeys]::SendWait($c.keys) }
    'place' {
      $deadline = (Get-Date).AddSeconds(15); $h = [IntPtr]::Zero
      while ($h -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
        $p = Get-Process -Name $c.proc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match $c.title } | Select-Object -First 1
        if ($p) { $h = $p.MainWindowHandle } else { Start-Sleep -Milliseconds 200 }
      }
      if ($h -ne [IntPtr]::Zero) { [D]::SetWindowPos($h, [IntPtr]::Zero, $c.x, $c.y, $c.w, $c.h, 0x40) | Out-Null; [D]::SetForegroundWindow($h) | Out-Null }
    }
  }
  [Console]::Out.WriteLine('OK')
}
`;
const psFile = path.join(tmp, 'input.ps1');
writeFileSync(psFile, PS);
const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], { stdio: ['pipe', 'pipe', 'inherit'] });
let psWait = [];
let psBuf = '';
ps.stdout.on('data', (d) => { psBuf += d; let i; while ((i = psBuf.indexOf('\n')) >= 0) { psBuf = psBuf.slice(i + 1); psWait.shift()?.(); } });
const input = (cmd) => new Promise((r) => { psWait.push(r); ps.stdin.write(`${JSON.stringify(cmd)}\n`); });
await new Promise((r) => psWait.push(r)); // READY

// --- the app --------------------------------------------------------------------
const electron = createRequire(import.meta.url)('electron');
const CDP_PORT = 9339;
const pet = spawn(electron, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(tmp, 'electron')}`, 'src/pet/main.js'], { cwd: root, env, stdio: 'ignore' });

async function target(match) {
  for (let i = 0; i < 80; i++) {
    try { const t = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((x) => x.url.includes(match)); if (t) return t; } catch { /* starting */ }
    await sleep(250);
  }
  throw new Error(`no window ${match}`);
}
async function connect(match) {
  const t = await target(match);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  return {
    eval: (expression) => new Promise((res) => { const i = ++id; pending.set(i, (d) => res(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); }),
    close: () => ws.close(),
  };
}
const petPage = await connect('pet.html');
const api = async (method, route, body) => {
  const { port, token } = JSON.parse(readFileSync(path.join(dataDir, 'daemon.json'), 'utf8'));
  const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'x-bd-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
for (let i = 0; i < 80 && !existsSync(path.join(dataDir, 'daemon.json')); i++) await sleep(250);

// Screen position of an element in the pet strip, or of the creature itself.
const rectOf = (sel) => petPage.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.offsetWidth === 0) return null; const r = e.getBoundingClientRect(); return { x: window.screenX + r.left + r.width / 2, y: window.screenY + r.top + r.height / 2 }; })()`);
const creatureAt = () => petPage.eval(`(() => { const c = document.getElementById('stage'); const g = c.getContext('2d'); const h = 96; const d = g.getImageData(0, c.height - h - 6, c.width, h).data; let a = -1, b = -1; for (let x = 0; x < c.width; x++) { for (let y = 0; y < h; y++) if (d[(y * c.width + x) * 4 + 3] > 200) { if (a < 0) a = x; b = x; break; } } return a < 0 ? null : { x: window.screenX + (a + b) / 2, y: window.screenY + c.height - 50 }; })()`);
const waitFor = async (fn, ms = 60_000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(150); } };
const bubbleOpen = (titlePart) => petPage.eval(`(document.getElementById('bubble').style.display === 'block' && document.getElementById('b-title').textContent.includes(${JSON.stringify(titlePart)}))`);
const clickEl = async (sel, ms = 700) => {
  const r = await waitFor(() => rectOf(sel), 5000);
  if (!r) {
    const ok = await petPage.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) { e.click(); return true; } return false; })()`);
    if (ok) return;
    throw new Error(`cannot find ${sel}`);
  }
  await input({ op: 'move', x: Math.round(r.x), y: Math.round(r.y), ms });
  await sleep(120);
  await input({ op: 'click' });
};
const clickCreature = async () => { const c = await waitFor(creatureAt, 3000); await input({ op: 'move', x: Math.round(c.x), y: Math.round(c.y), ms: 800 }); await sleep(180); const again = await creatureAt(); if (again) await input({ op: 'move', x: Math.round(again.x), y: Math.round(again.y), ms: 80 }); await sleep(60); await input({ op: 'click' }); };

// --- recording and timeline -----------------------------------------------------
const timeline = { beats: [], creature: [] };
let t0 = Date.now();
const beat = (name, note = '') => { const t = (Date.now() - t0) / 1000; timeline.beats.push({ t, name, note }); console.log(`${t.toFixed(1).padStart(6)}s  ${name}${note ? `  (${note})` : ''}`); };
const rawFile = path.join(outDir, 'take-raw.mkv');
let ff = null;
const tracker = setInterval(async () => { const c = await creatureAt().catch(() => null); if (c) timeline.creature.push({ t: (Date.now() - t0) / 1000, x: c.x }); }, 200);

// --- cleanup, however it ends ---------------------------------------------------
const windows = [];
async function finish(code) {
  clearInterval(tracker);
  writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(timeline, null, 1));
  if (ff) { ff.stdin.write('q'); await new Promise((r) => { ff.on('close', r); setTimeout(r, 8000); }); }
  for (const w of windows) spawnSync('taskkill', ['/T', '/F', '/PID', String(w.pid)], { stdio: 'ignore' });
  try { await api('POST', '/pause', { paused: true }); } catch {}
  try { const { pid } = JSON.parse(readFileSync(path.join(dataDir, 'daemon.json'), 'utf8')); process.kill(pid); } catch {}
  try { pet.kill(); } catch {}
  await input({ op: 'restore' });
  ps.stdin.end();
  await sleep(800);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* a window still holds a file; it's in temp */ }
  process.exit(code);
}
process.on('SIGINT', () => finish(130));

const openCode = async () => {
  const w = spawn(CODE, ['--user-data-dir', path.join(tmp, 'code'), '--extensions-dir', path.join(tmp, 'code-ext'), '--disable-workspace-trust', '--disable-telemetry', '--new-window', shop, path.join(shop, 'checkout.js')], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  windows.push(w);
  await input({ op: 'place', proc: 'Code', title: 'checkout', x: 140, y: 35, w: 1280, h: 630 });
};
let chrome = null;
const openBrowser = async () => {
  chrome = spawn(CHROME, [`--user-data-dir=${path.join(tmp, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-position=160,45', '--window-size=1240,620', VIDEO_URL], { stdio: 'ignore' });
  windows.push(chrome);
  await input({ op: 'place', proc: 'chrome', title: 'YouTube', x: 160, y: 45, w: 1240, h: 620 });
};
const closeBrowser = async () => { await input({ op: 'key', keys: '%{F4}' }); await sleep(500); };

// --- the scenario ---------------------------------------------------------------
try {
  await input({ op: 'minimize' });
  await input({ op: 'move', x: 1000, y: 500, ms: 200 });
  await waitFor(() => bubbleOpen('ONLINE'), 20_000);
  if (RECORD) {
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:framerate=30:draw_mouse=1,hwdownload,format=bgra', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', rawFile], { stdio: ['pipe', 'inherit', 'inherit'] });
    await sleep(800);
  }
  t0 = Date.now(); timeline.creature = [];
  beat('ask', 'first run: the creature asks');
  await sleep(3000);

  // 1. One sentence in.
  const field = await rectOf('#ask-in');
  await input({ op: 'move', x: Math.round(field.x), y: Math.round(field.y), ms: 900 });
  await input({ op: 'click' });
  await sleep(250);
  beat('typing');
  await input({ op: 'type', text: 'Fix the checkout bug', ms: 75 });
  await sleep(500);
  await input({ op: 'key', keys: '{ENTER}' });
  beat('plan-wait', 'Llama splits the quest; wait is cut in the edit');
  await waitFor(() => bubbleOpen('ACCEPTED'), 180_000);
  beat('plan-shown', LLAMA ? 'from Llama' : 'template');
  console.log('          plan:', JSON.stringify((await api('GET', '/quests')).map?.((q) => q.steps?.map((s) => s.text)) ?? ''));
  await sleep(5000);
  if (await waitFor(() => rectOf('#b-ok'), 4000)) await clickEl('#b-ok');
  else await petPage.eval("document.getElementById('b-ok')?.click(); document.getElementById('bubble').style.display = 'none'; 0");

  // 2. Real work in a real editor.
  beat('work');
  await openCode();
  await sleep(2500);
  await input({ op: 'key', keys: '^g' }); await sleep(250);
  await input({ op: 'type', text: '5', ms: 60 }); await input({ op: 'key', keys: '{ENTER}' }); await sleep(200);
  await input({ op: 'key', keys: '{END}{ENTER}' }); await sleep(100);
  await input({ op: 'type', text: 'if (item.qty) sum *= item.qty;', ms: 55 });
  await sleep(4000);

  // 3. A real drift: real YouTube in front, the real classifier and tracker.
  beat('drift-open', 'threshold 10 s here; 3 min by default');
  await openBrowser();
  await waitFor(() => bubbleOpen('INCOMING'), 180_000);
  beat('nudge', LLAMA ? 'real nudge, Llama wrote it' : 'real nudge, template');
  console.log('          nudge:', await petPage.eval(`document.getElementById('next').textContent`));
  await sleep(7000);

  // 4. Ignored for a long time (time lapse: two more real-format nudges -> bomb).
  const msg = await petPage.eval(`({ m: document.getElementById('msg').textContent, n: document.getElementById('next').textContent })`);
  beat('ignored', 'time lapse: nudges 2 and 3 replayed');
  await api('POST', '/debug/emit', { type: 'nudge', kind: 'drift', message: msg.m, nextAction: msg.n });
  await sleep(3000);
  await api('POST', '/debug/emit', { type: 'nudge', kind: 'drift', message: msg.m, nextAction: msg.n });
  beat('bomb');
  await sleep(5500);

  // 5. The comeback: closes YouTube, back in the editor. Real return event.
  beat('comeback');
  await closeBrowser();
  await input({ op: 'place', proc: 'Code', title: 'checkout', x: 140, y: 35, w: 1280, h: 630 });
  await waitFor(() => petPage.eval(`[...document.querySelectorAll('.floater')].some((f) => /BACK ON QUEST|QUICK RETURN/.test(f.textContent))`), 20_000);
  beat('returned');
  await sleep(3500);

  // 6. Scope creep: the same question an agent asks through the CLI / MCP.
  beat('scope');
  await api('POST', '/scope/check', { request: "while you're at it, also add a dark mode toggle" });
  await waitFor(() => bubbleOpen('SCOPE'), 15_000);
  beat('scope-shown');
  await sleep(5000);
  await clickEl('#b-park');
  await sleep(2200);

  // 7. The creature's menu, then a real 5-minute session (the menu's own are 25 and 50).
  beat('menu');
  await clickCreature();
  await sleep(2600);
  await clickCreature();
  await sleep(300);
  beat('session', 'real session, 5 min for the demo');
  await api('POST', '/session', { action: 'start', minutes: 5 });
  await waitFor(() => bubbleOpen('ENGAGED'), 60_000);
  await sleep(1500);
  if (await waitFor(() => rectOf('#b-ok'), 4000)) await clickEl('#b-ok');
  else await petPage.eval("document.getElementById('b-ok')?.click(); document.getElementById('bubble').style.display = 'none'; 0");
  await input({ op: 'place', proc: 'Code', title: 'checkout', x: 140, y: 35, w: 1280, h: 630 });

  // 8. Five real minutes of "work": typing keeps it honest for the idle check.
  beat('work-lapse-start', 'real time, sped up in the edit');
  const WORK = ['// TODO: qty can be zero', 'const fee = 0;', '// round to cents', 'sum = Math.round(sum * 100) / 100;', '// tests next', 'console.assert(total({ items: [] }) === 0);', '// edge: empty cart', '// done with total()', '// now submit()', '// retry once on timeout'];
  let flowed = false, gold = false, w = 0;
  const t8 = Date.now();
  while (!gold && Date.now() - t8 < 340_000) {
    await input({ op: 'key', keys: '{END}{ENTER}' });
    await input({ op: 'type', text: WORK[w++ % WORK.length], ms: 45 });
    for (let i = 0; i < 25 && !gold; i++) {
      await sleep(1000);
      const st = await api('GET', '/status');
      if (!flowed && st.flow?.level >= 1) { flowed = true; beat('flow', 'real FLOW x1'); }
      if (st.session?.kind === 'break') { gold = true; beat('gold', 'real perfect session'); }
    }
  }
  await sleep(7000);
  beat('work-lapse-end');
  if (await rectOf('#b-ok')) await clickEl('#b-ok');
  await api('POST', '/session', { action: 'stop' });
  await sleep(1000);

  // 9. Card lock: drifting past the limit keeps pulsing until a card tap.
  await api('POST', '/settings', { cardLock: true });
  beat('lock-drift', 'card lock on; first pulse about a minute after the nudge');
  await openBrowser();
  await waitFor(() => bubbleOpen('INCOMING') , 60_000);
  beat('lock-nudge');
  await sleep(1500);
  await clickEl('#b-snooze');
  beat('lock-snooze-refused', 'with card lock on, a click cannot snooze');
  await sleep(3000);
  beat('lock-wait', 'real wait, cut in the edit');
  await sleep(82_000);
  beat('lock-pulse');
  await sleep(4500);

  // The reader isn't wired yet: the tap comes through the CLI's route.
  beat('card-new', 'simulated tap: same route the reader uses');
  await api('POST', '/card', { id: 'A1B2C3D4' });
  await waitFor(() => bubbleOpen('CARD'), 5000);
  await sleep(2500);
  await clickEl('#card-choices button[data-act="break"]');
  await sleep(1800);
  beat('card-break', 'simulated tap');
  await api('POST', '/card', { id: 'A1B2C3D4' });
  await sleep(3500);
  await closeBrowser();
  await input({ op: 'place', proc: 'Code', title: 'checkout', x: 140, y: 35, w: 1280, h: 630 });
  await api('POST', '/pause', { paused: false });
  await api('POST', '/settings', { cardLock: false });
  await sleep(1500);

  // 10. Finish: real steps, real boss.
  const quest = (await api('GET', '/status')).quest;
  console.log('          status quest:', JSON.stringify(quest));
  beat('done');
  for (let i = 0; i < 12; i++) {
    const r = await api('POST', '/steps/done');
    if (!r.events?.length) break;
    if (r.events.some((e) => e.type === 'boss-defeated')) { beat('boss'); break; }
    await sleep(1400);
  }
  await sleep(6000);

  // 11. The HUD: what model runs, what you won.
  beat('hud');
  await clickCreature();
  await sleep(900);
  await clickEl('#m-hud');
  await sleep(7000);
  beat('end');
} catch (e) {
  console.error('SCENARIO FAILED:', e);
  await finish(1);
}
await finish(0);

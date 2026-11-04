// Renders a scene of motion.html frame by frame in headless Chrome (nothing on
// screen, a throwaway profile) and pipes the frames into ffmpeg.
//   node video/motion/render.mjs <scene> <out.mp4> [--t=4.5 single frame to out.png] [--fps=30]
//   node video/motion/render.mjs wallpaper <out.png>
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const [scene, out] = args.filter((a) => !a.startsWith('--'));
const FPS = Number(flag('fps')) || 30, ONE = flag('t');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  let body;
  try { body = readFileSync(file); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(path.join(tmpdir(), 'bd-motion-'));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1920,1080', '--force-device-scale-factor=1', '--hide-scrollbars', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) throw new Error('chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const finish = (code) => { try { ws.close(); } catch {} chrome.kill(); server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 500); };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${base}/video/motion/motion.html?scene=${scene}` });
  for (let i = 0; i < 120 && !(await evaluate('!!window.ready').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  const dur = await evaluate('window.ready && window.sceneDuration');
  if (dur == null) throw new Error('scene did not load');
  const shot = async (format = 'jpeg') => Buffer.from((await cdp('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 96 } : {}), captureBeyondViewport: false })).data, 'base64');

  if (ONE != null || scene === 'wallpaper') {
    await evaluate(`window.renderAt(${Number(ONE) || 0})`);
    writeFileSync(out, await shot('png'));
    console.log('wrote', out);
    finish(0);
  } else {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const frames = Math.round(dur * FPS), t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      await evaluate(`window.renderAt(${f / FPS})`);
      const jpg = await shot();
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 60 === 0) console.log(`${scene} ${f}/${frames} ${((Date.now() - t0) / Math.max(1, f)).toFixed(0)} ms/frame`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('wrote', out);
    finish(0);
  }
} catch (e) { console.error(e); finish(1); }

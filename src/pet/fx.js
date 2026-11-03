// Full-screen effects (a transparent, click-through window over the work
// area, shown only while an effect plays, about 2-3 s):
//   bomb      the Nudgling lobs a pixel bomb that explodes across the screen
//   rage      a red pulse and giant glitch text ("SNOOZE #3. I'M NOT MAD.")
//   confetti  pixel confetti for level-ups, bosses and evolutions
import { play } from './voice.js';

const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');
const MONO = '"Cascadia Mono", Consolas, monospace';
let raf = 0;

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; ctx.imageSmoothingEnabled = false; }
addEventListener('resize', resize);
resize();

const ease = (x) => 1 - (1 - x) ** 3;
const rnd = (a, b) => a + Math.random() * (b - a);

function bigText(text, sub, t, { color = '#00f0ff', glitch = false, y = innerHeight * 0.45 } = {}) {
  const a = Math.min(1, t * 4) * Math.min(1, (1 - t) * 5); // fade in fast, out at the end
  if (a <= 0) return;
  const size = Math.min(140, innerWidth / Math.max(8, text.length * 0.62));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${size}px ${MONO}`;
  const pop = 1 + 0.25 * (1 - ease(Math.min(1, t * 3)));
  ctx.translate(innerWidth / 2, y); ctx.scale(pop, pop);
  if (glitch) {
    const j = () => rnd(-6, 6);
    ctx.fillStyle = 'rgba(255, 43, 214, .85)'; ctx.fillText(text, j() - 4, j());
    ctx.fillStyle = 'rgba(0, 240, 255, .85)'; ctx.fillText(text, j() + 4, j());
  }
  // Dark outline first, then the glowing fill on top (no inner contour lines).
  ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = '#07070d'; ctx.strokeText(text, 0, 0);
  ctx.shadowColor = color; ctx.shadowBlur = 28;
  ctx.fillStyle = color; ctx.fillText(text, 0, 0);
  ctx.shadowBlur = 0;
  if (sub) { ctx.font = `700 ${Math.round(size * 0.26)}px ${MONO}`; ctx.fillStyle = '#e8ecff'; ctx.fillText(sub, 0, size * 0.85); }
  ctx.restore();
}

function pixelBomb(x, y, s, t) {
  const B = ['..kk.y', '.k..ky', 'kkkk..', 'kkkkk.', 'kwkkk.', 'kkkkk.', '.kkk..'];
  const pal = { k: '#1a1530', w: '#8a8fbf', y: t % 0.2 < 0.1 ? '#ffe23b' : '#ff8a1e' };
  B.forEach((row, r) => [...row].forEach((c, i) => { if (c !== '.') { ctx.fillStyle = pal[c]; ctx.fillRect(x + i * s, y + r * s, s, s); } }));
}

const EFFECTS = {
  bomb({ text, sub, x, sound }) {
    const from = { x: x ?? innerWidth - 120, y: innerHeight - 60 }, to = { x: innerWidth / 2, y: innerHeight * 0.45 };
    const parts = [];
    return (t, dt) => {
      const FLY = 0.32; // share of the effect spent in the air
      if (t < FLY) {
        const k = t / FLY;
        const px = from.x + (to.x - from.x) * k, py = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * innerHeight * 0.35;
        pixelBomb(px - 36, py - 42, 12, t);
        return;
      }
      if (!parts.length) {
        if (sound) play('boom');
        for (let i = 0; i < 320; i++) { const a = rnd(0, Math.PI * 2), v = rnd(250, 1500); parts.push({ x: to.x, y: to.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: rnd(12, 30), c: ['#ff3b3b', '#ff8a1e', '#ffe23b', '#ffffff'][i % 4] }); }
      }
      const k = (t - FLY) / (1 - FLY);
      if (k < 0.08) { ctx.fillStyle = `rgba(255, 255, 255, ${0.55 * (1 - k / 0.08)})`; ctx.fillRect(0, 0, innerWidth, innerHeight); }
      const shake = k < 0.3 ? (1 - k / 0.3) * 18 : 0;
      ctx.save(); ctx.translate(rnd(-shake, shake), rnd(-shake, shake));
      for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; p.vx *= 0.985; ctx.globalAlpha = Math.max(0, 1 - k * k * 1.15); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s); }
      ctx.globalAlpha = 1;
      bigText(text, sub, k, { color: '#ffe23b' });
      ctx.restore();
    };
  },
  // Card lock: a red pulse with the drift's site and minutes; longer the longer it runs.
  pulse(fx) { return EFFECTS.rage(fx); },
  rage({ text, sub }) {
    return (t) => {
      const pulse = 0.35 + 0.25 * Math.sin(t * Math.PI * 6);
      const g = ctx.createRadialGradient(innerWidth / 2, innerHeight / 2, innerHeight * 0.25, innerWidth / 2, innerHeight / 2, innerHeight * 0.95);
      g.addColorStop(0, 'rgba(255, 30, 60, 0)'); g.addColorStop(1, `rgba(255, 30, 60, ${pulse * Math.min(1, (1 - t) * 4)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, innerWidth, innerHeight);
      bigText(text, sub, t, { color: '#ff3b5c', glitch: true });
    };
  },
  confetti({ text, sub }, colors = ['#00f0ff', '#ff2bd6', '#39ff9a', '#ffe23b'], color = '#39ff9a') {
    const bits = Array.from({ length: 220 }, (_, i) => ({ x: rnd(0, innerWidth), y: rnd(-innerHeight, 0), v: rnd(250, 600), w: rnd(-3, 3), s: rnd(6, 12), c: colors[i % colors.length] }));
    return (t, dt) => {
      for (const b of bits) { b.y += b.v * dt; b.x += Math.sin(t * 8 + b.w) * 40 * dt; ctx.globalAlpha = Math.min(1, (1 - t) * 4); ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.s, b.s * 0.6); }
      ctx.globalAlpha = 1;
      bigText(text, sub, t, { color });
    };
  },
  // A perfect focus session: gold rain.
  gold(fx) { return EFFECTS.confetti(fx, ['#ffe23b', '#ffc400', '#fff3a0', '#ffb000'], '#ffe23b'); },
};
const DURATION = { bomb: 3.2, rage: 2.6, confetti: 3, gold: 3, pulse: 2.2 };

window.bd.onFx((fx) => {
  const make = EFFECTS[fx.kind];
  if (!make) return window.bd.fxDone();
  cancelAnimationFrame(raf);
  const frame = make(fx), dur = fx.kind === 'pulse' ? Math.min(5, 2.2 + (Number(fx.minutes) || 0) / 5) : DURATION[fx.kind], start = performance.now();
  let last = start;
  const step = (now) => {
    const t = (now - start) / 1000 / dur, dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (t >= 1) { window.bd.fxDone(); return; }
    frame(t, dt);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
});

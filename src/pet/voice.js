// The Nudgling's voice: tiny wordless robot sounds made with WebAudio (no
// audio files). "hm?" when it notices, "urghh" when it's annoyed, "wee-oo"
// when you're back, a fanfare for wins, "whoaaa" at the screen edge.
// Quiet by design (master volume 0.08); the menu's SOUND switch mutes it.
let ac = null;
const audio = () => (ac ||= new AudioContext());
// The video build renders the same sounds into an OfflineAudioContext.
export function useAudioContext(context) { ac = context; }
// Volume setting 0-100; 60 is the designed level.
let level = 1;
export function setVolume(v) { level = Math.max(0, Math.min(100, Number(v) || 0)) / 60; }

// One gliding tone: frequency moves f0 -> f1 (-> f2) over `dur` seconds.
function tone({ type = 'sine', f0, f1 = f0, f2 = null, dur = 0.15, at = 0, vol = 1, vibrato = 0, tremolo = 0, lowpass = 0 }) {
  const a = audio(), t = a.currentTime + at;
  const osc = a.createOscillator(), gain = a.createGain(), master = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f2) { osc.frequency.linearRampToValueAtTime(f1, t + dur * 0.45); osc.frequency.linearRampToValueAtTime(f2, t + dur); }
  else osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  // Soft attack and release so nothing clicks.
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.02);
  gain.gain.setValueAtTime(vol, t + dur * 0.7);
  gain.gain.linearRampToValueAtTime(0, t + dur);
  master.gain.value = 0.08 * level;
  let node = osc;
  if (lowpass) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node.connect(f); node = f; }
  node.connect(gain).connect(master).connect(a.destination);
  const lfo = (rate, depth, target) => { const l = a.createOscillator(), g = a.createGain(); l.frequency.value = rate; g.gain.value = depth; l.connect(g).connect(target); l.start(t); l.stop(t + dur); };
  if (vibrato) lfo(vibrato, f0 * 0.06, osc.frequency);
  if (tremolo) lfo(tremolo, vol * 0.6, gain.gain);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.6, at = 0, from = 2400, to = 120 }) {
  const a = audio(), t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'lowpass';
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.value = 0.12 * level;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const SOUNDS = {
  hm: () => { tone({ type: 'triangle', f0: 480, f1: 720, dur: 0.12 }); tone({ type: 'triangle', f0: 760, f1: 700, dur: 0.1, at: 0.13 }); },
  angry: () => tone({ type: 'sawtooth', f0: 170, f1: 105, dur: 0.5, tremolo: 22, lowpass: 900, vol: 0.9 }),
  happy: () => { tone({ f0: 620, f1: 940, dur: 0.1 }); tone({ f0: 940, f1: 1400, dur: 0.14, at: 0.11 }); },
  sigh: () => tone({ type: 'triangle', f0: 720, f1: 280, dur: 0.55, vibrato: 5 }),
  whoa: () => tone({ f0: 380, f1: 1050, f2: 460, dur: 0.7, vibrato: 7 }),
  ooh: () => tone({ f0: 300, f1: 520, f2: 430, dur: 0.38 }),
  celebrate: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'square', f0: f, f1: f, dur: 0.09, at: i * 0.075, vol: 0.55 })),
  chime: () => { tone({ f0: 1318, f1: 1318, dur: 0.35, vol: 0.5 }); tone({ f0: 1976, f1: 1976, dur: 0.5, at: 0.09, vol: 0.35 }); },
  boom: () => { noise({ dur: 0.9 }); tone({ type: 'sine', f0: 140, f1: 40, dur: 0.6, vol: 1 }); },
};

export function play(name) {
  try { SOUNDS[name]?.(); } catch { /* audio unavailable: stay silent */ }
}

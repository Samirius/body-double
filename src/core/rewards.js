// Rewards for the good part, on top of XP (pure and deterministic, like game.js):
//  - happiness 0-100: rises with finished steps, flow, quick returns, perfect
//    sessions and bosses; slowly settles back toward 50. It never drops below
//    50 by itself and nothing you do makes it sad: low is only "content".
//  - achievements for good habits (parking ideas, clean sessions, comebacks,
//    flow), each unlocking something the creature can wear
//  - weekly recap from the log
import { dayKey } from './game.js';

export const COSMETICS = {
  shades: 'Pixel shades', cap: 'Comeback cap', headphones: 'Flow headphones', bow: 'Idea bow', halo: 'Laser halo', crown: 'Boss crown',
};

export const ACHIEVEMENTS = [
  { id: 'first-park', name: 'Parked, not chased', desc: 'Park a distraction instead of following it', test: (c) => c.parks >= 1 },
  { id: 'idea-keeper', name: 'Idea Keeper', desc: 'Park 5 ideas for later', test: (c) => c.parks >= 5, unlocks: 'bow' },
  { id: 'clean-run', name: 'Clean Run', desc: 'A focus session with zero drift', test: (c) => c.perfect >= 1, unlocks: 'shades' },
  { id: 'laser', name: 'Laser', desc: '10 perfect sessions', test: (c) => c.perfect >= 10, unlocks: 'halo' },
  { id: 'boomerang', name: 'Boomerang', desc: 'Back within a minute of a nudge, 5 times', test: (c) => c.quick >= 5, unlocks: 'cap' },
  { id: 'in-the-zone', name: 'In the Zone', desc: '30 minutes of unbroken flow', test: (c) => c.flowBest >= 6, unlocks: 'headphones' },
  { id: 'deep-diver', name: 'Deep Diver', desc: '90 minutes of unbroken flow', test: (c) => c.flowBest >= 18 },
  { id: 'triple-play', name: 'Triple Play', desc: '3 focus sessions in one day', test: (c) => Math.max(0, ...Object.values(c.sessionsByDay)) >= 3 },
  { id: 'trophy-hunter', name: 'Trophy Hunter', desc: 'Beat a deadline boss', test: (c) => c.bosses >= 1, unlocks: 'crown' },
  { id: 'centurion-steps', name: 'Hundred Small Steps', desc: 'Finish 100 steps', test: (c) => c.steps >= 100 },
];

const GAIN = { step: 8, park: 2, perfect: 10, quick: 5, flow: 3, session: 4, boss: 15 };

export function newRewards() {
  return { happiness: 60, counters: { steps: 0, parks: 0, perfect: 0, quick: 0, flowBest: 0, bosses: 0, sessionsByDay: {} }, achievements: [], unlocked: [], equipped: null, trophies: [] };
}

export const mood = (h) => (h >= 90 ? 'glowing' : h >= 70 ? 'happy' : 'content');

// event: { type: 'step'|'park'|'perfect'|'quick'|'flow'|'session'|'boss', level?, quest? }
export function applyReward(r0, event, at) {
  const r = structuredClone(r0 || newRewards());
  const c = r.counters;
  switch (event.type) {
    case 'step': c.steps++; break;
    case 'park': c.parks++; break;
    case 'perfect': c.perfect++; break;
    case 'quick': c.quick++; break;
    case 'flow': c.flowBest = Math.max(c.flowBest, event.level || 0); break;
    case 'session': { const d = dayKey(at); c.sessionsByDay = { ...c.sessionsByDay, [d]: (c.sessionsByDay[d] || 0) + 1 }; break; }
    case 'boss': c.bosses++; r.trophies = [...r.trophies, { quest: event.quest || 'Boss', at }].slice(-50); break;
    default: return { rewards: r, events: [] };
  }
  r.happiness = Math.min(100, r.happiness + (GAIN[event.type] || 0));
  const events = [];
  for (const a of ACHIEVEMENTS) {
    if (r.achievements.includes(a.id) || !a.test(c)) continue;
    r.achievements.push(a.id);
    if (a.unlocks && !r.unlocked.includes(a.unlocks)) r.unlocked.push(a.unlocks);
    events.push({ type: 'achievement', id: a.id, name: a.name, unlocks: a.unlocks ? COSMETICS[a.unlocks] : null, cosmetic: a.unlocks || null });
  }
  return { rewards: r, events };
}

// Settles back toward 50 by 2 points an hour, never below it.
export function settle(r, hours) {
  if (!r || r.happiness <= 50) return r;
  return { ...r, happiness: Math.max(50, r.happiness - Math.floor(hours * 2)) };
}

export function equip(r, item) {
  if (item != null && !r.unlocked.includes(item)) throw new Error(`"${item}" is not unlocked yet`);
  return { ...r, equipped: item ?? null };
}

// The last 7 days from the log (wins only).
export function weekRecap(log, now = Date.now()) {
  const since = now - 7 * 86_400_000;
  const e = log.filter((x) => x.at >= since);
  const steps = e.filter((x) => x.type === 'step-done');
  const byDay = {};
  for (const s of steps) byDay[dayKey(s.at)] = (byDay[dayKey(s.at)] || 0) + 1;
  const best = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    from: dayKey(since + 86_400_000), to: dayKey(now),
    steps: steps.length,
    xp: steps.reduce((n, x) => n + (x.xp || 0), 0),
    flowMinutes: e.filter((x) => x.type === 'flow-banked').reduce((n, x) => n + (x.minutes || 0), 0),
    sessions: e.filter((x) => x.type === 'session-done').length,
    perfectSessions: e.filter((x) => x.type === 'session-done' && x.perfect).length,
    comebacks: e.filter((x) => x.type === 'returned').length,
    parked: e.filter((x) => x.type === 'parked').length,
    bosses: steps.filter((x) => (x.events || []).includes('boss-defeated')).length,
    bestDay: best ? { day: best[0], steps: best[1] } : null,
  };
}

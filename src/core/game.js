// Game rules. Deterministic on purpose: the model never awards XP, so
// progress always means finished work, never a persuasive chat.
// All functions take state and return { state, events } without mutating.

export const XP = { step: 10, comebackMultiplier: 1.5, comebackWindowSeconds: 300, bossKill: 50 };
export const PET_STAGES = [1, 5, 10, 20]; // pet evolves when the overall level reaches these

// Cumulative XP needed to reach a level: 100 * (L-1)^1.5 (level 1 at 0 XP).
export const xpForLevel = (level) => Math.round(100 * Math.pow(Math.max(0, level - 1), 1.5));
export function levelFromXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}
export function levelProgress(xp) {
  const level = levelFromXp(xp);
  const from = xpForLevel(level), to = xpForLevel(level + 1);
  return { level, into: xp - from, needed: to - from, fraction: (xp - from) / (to - from) };
}
export const petStage = (level) => PET_STAGES.filter((s) => level >= s).length; // 1..4

export const TITLES = [
  { id: 'first-step', name: 'First Step', test: (s) => s.stats.stepsDone >= 1 },
  { id: 'comeback-kid', name: 'Comeback Kid', test: (s, day) => (s.stats.comebacksByDay[day] || 0) >= 5 },
  { id: 'boss-slayer', name: 'Boss Slayer', test: (s) => s.stats.bossesDefeated >= 1 },
  { id: 'on-a-roll', name: 'On a Roll', test: (s) => s.streak.days >= 3 },
  { id: 'deadline-hunter', name: 'Deadline Hunter', test: (s) => s.stats.bossesDefeated >= 3 },
  { id: 'centurion', name: 'Centurion', test: (s) => s.stats.stepsDone >= 100 },
];

export const dayKey = (at) => new Date(at).toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

export function newGameState() {
  return {
    xp: { total: 0, skills: {} },
    titles: [],
    streak: { days: 0, lastDay: null, shields: 1, shieldWeek: null },
    stats: { stepsDone: 0, bossesDefeated: 0, comebacksByDay: {} },
  };
}

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86_400_000);
const isoWeek = (day) => { const d = new Date(day); const onejan = new Date(d.getFullYear(), 0, 1); return `${d.getFullYear()}-${Math.ceil(((d - onejan) / 86_400_000 + onejan.getDay() + 1) / 7)}`; };

// Streak: a day counts when at least one step is done. One shield per week
// covers one missed day; with no shield the streak restarts at 1, never 0.
function touchStreak(streak, day) {
  const s = { ...streak };
  const week = isoWeek(day);
  if (s.shieldWeek !== week) { s.shields = Math.max(s.shields, 1); s.shieldWeek = week; }
  if (s.lastDay === day) return { streak: s, events: [] };
  const events = [];
  if (!s.lastDay) s.days = 1;
  else {
    const gap = daysBetween(s.lastDay, day);
    if (gap === 1) s.days += 1;
    else if (gap === 2 && s.shields > 0) { s.shields -= 1; s.days += 1; events.push({ type: 'shield-used' }); }
    else s.days = 1;
  }
  s.lastDay = day;
  return { streak: s, events };
}

// Complete one step of a quest. `lastNudgeAt` (ms) enables the comeback bonus.
export function completeStep(game, { quest, stepId, at, lastNudgeAt = null }) {
  const events = [];
  const step = quest.steps.find((x) => x.id === stepId);
  if (!step || step.done) return { game, quest, events };
  const day = dayKey(at);
  const comeback = lastNudgeAt != null && at - lastNudgeAt <= XP.comebackWindowSeconds * 1000;
  let gained = Math.round(XP.step * (comeback ? XP.comebackMultiplier : 1));

  const nextQuest = { ...quest, steps: quest.steps.map((x) => (x.id === stepId ? { ...x, done: true, doneAt: at } : x)) };
  const stats = { ...game.stats, stepsDone: game.stats.stepsDone + 1, comebacksByDay: { ...game.stats.comebacksByDay } };
  if (comeback) { stats.comebacksByDay[day] = (stats.comebacksByDay[day] || 0) + 1; events.push({ type: 'comeback-bonus' }); }

  const bossDown = quest.boss && nextQuest.steps.every((x) => x.done);
  if (bossDown) { gained += XP.bossKill; stats.bossesDefeated += 1; events.push({ type: 'boss-defeated', quest: quest.title }); }

  const skill = quest.tag || 'General';
  const before = game.xp.total, skillBefore = game.xp.skills[skill] || 0;
  const xp = { total: before + gained, skills: { ...game.xp.skills, [skill]: skillBefore + gained } };
  events.unshift({ type: 'xp', amount: gained, skill, reason: step.text });
  if (levelFromXp(xp.total) > levelFromXp(before)) {
    const level = levelFromXp(xp.total);
    events.push({ type: 'level-up', level });
    if (petStage(level) > petStage(levelFromXp(before))) events.push({ type: 'pet-evolved', stage: petStage(level) });
  }
  if (levelFromXp(xp.skills[skill]) > levelFromXp(skillBefore)) events.push({ type: 'skill-up', skill, level: levelFromXp(xp.skills[skill]) });

  const { streak, events: streakEvents } = touchStreak(game.streak, day);
  events.push(...streakEvents);
  let next = { ...game, xp, stats, streak };
  const titles = [...game.titles];
  for (const t of TITLES) {
    if (!titles.includes(t.id) && t.test(next, day)) { titles.push(t.id); events.push({ type: 'title', id: t.id, name: t.name }); }
  }
  next = { ...next, titles };
  return { game: next, quest: nextQuest, events };
}

// Boss HP: remaining steps out of total, for deadline quests.
export function bossHp(quest) {
  const total = quest.steps.length || 1;
  return { hp: quest.steps.filter((x) => !x.done).length, max: total };
}

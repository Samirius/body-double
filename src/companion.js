// The heartbeat: sample the foreground window, classify it, feed the drift
// tracker, and react. UI-agnostic: the terminal and the desktop pet both
// plug in through `ui` ({ nudge, gameEvents, status }).
//
// Beyond plain rules it also:
//  - judges long 'unclear' stretches with the model (title only by default),
//  - notices "stuck" (long on-task time without finishing the step),
//  - opens and closes the day (morning plan, evening summary),
//  - tunes how soon it nudges from your feedback.
import { classify, siteKey, DEFAULT_RULES } from './core/classifier.js';
import { createDriftTracker } from './core/drift.js';
import { completeStep, bossHp, levelProgress, dayKey, TITLES } from './core/game.js';
import { newId } from './core/store.js';
import { createRhythm } from './core/rhythm.js';
import { gitScope, tooMuchUncommitted, pageKey, scopeHint } from './core/scope.js';
import { newRewards, applyReward, settle, equip, mood, weekRecap, ACHIEVEMENTS, COSMETICS } from './core/rewards.js';

export const DEFAULT_TIMING = {
  unclearMinutes: 6, // same unclear site/app this long -> ask the judge
  judgeCacheMinutes: 30, // a verdict holds this long for that site/app
  stuckMinutes: 25, // on task this long without finishing the step -> offer to split
  commAllowanceMinutes: 10,
  breakMinutes: 5, // after a focus session // messaging apps count as drift only after this much continuous time
  morningHour: 6, eveningHour: 19,
  driftAfterSeconds: 180, minDriftAfter: 90, maxDriftAfter: 600, driftStep: 30,
};

const titleName = Object.fromEntries(TITLES.map((t) => [t.id, t.name]));
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// `makeBrain({ onNudge, onSplit, log })` builds the brain (see agent/brain.js);
// the companion owns the callbacks so nudge stats live in one place.
export function createCompanion({ store, watcher, makeBrain, ui, judge = null, captureScreen = null, rules = DEFAULT_RULES, driftOptions = {}, timing = {}, sampleEverySeconds = 15, now = Date.now }) {
  // Every log entry uses the companion's clock, so day summaries and replays agree.
  const log = (type, data = {}) => store.log(type, data, now());
  const T = { ...DEFAULT_TIMING, ...timing, ...(driftOptions.driftAfterSeconds ? { driftAfterSeconds: driftOptions.driftAfterSeconds } : {}) };
  const driftAfter = () => store.get().settings?.driftAfterSeconds ?? T.driftAfterSeconds;
  // User settings (HUD Settings card, creature menu, agents): one place, the store.
  const SETTINGS = { driftAfterSeconds: 180, quietFrom: null, quietTo: null, morningHour: T.morningHour, eveningHour: T.eveningHour, sound: true, fx: true, volume: 60 };
  const setting = (k) => store.get().settings?.[k] ?? SETTINGS[k];
  // Quiet hours (e.g. 22 -> 7): nothing speaks unless you asked for it.
  const inQuietHours = (at) => {
    const from = setting('quietFrom'), to = setting('quietTo');
    if (from == null || to == null || from === to) return false;
    const h = new Date(at).getHours();
    return from < to ? h >= from && h < to : h >= from || h < to;
  };
  const drift = createDriftTracker({ ...driftOptions, driftAfterSeconds: driftAfter });
  let lastLabel = null, lastNudgeAt = null, timer = null, busy = false, lastTickAt = null;
  // Recent samples, in memory only (titles never reach disk): used to learn
  // from "you missed my drift" feedback. Last nudge context: for "wrong nudge".
  const RECENT_MS = 15 * 60_000;
  let recent = [];
  let lastNudgeContext = null;
  const verdicts = new Map(); // site key -> { label, until, reason } (judge cache)
  let unclearRun = null; // { key, since }
  let commRun = null; // { since, lastAt } continuous messaging time
  let onTaskMs = 0; // on-task time since the last finished step (for "stuck")
  let lastChatNudgeAt = 0; // chat-drift nudges at most every 30 min
  // Rhythm: call quiet, flow combo, hyperfocus guard (see core/rhythm.js).
  const rhythm = createRhythm(timing.rhythm);
  let quiet = false, fullscreen = false;
  // Scope guard (see core/scope.js): git pile-ups and same-site side tasks.
  let gitCheckedAt = 0, lastScopeWarnAt = 0;
  let sideRun = null; // { key, since } current page context of the active quest
  const sideVerdicts = new Map(); // "<questId>|<page key>" -> 'in-scope' | 'side-task'
  let lastSide = null; // { questId, key } the side task last pointed out (for "it's part of it")

  const nextStep = (q) => q?.steps.find((s) => !s.done) || null;
  // Rewards for good habits (see core/rewards.js): happiness, achievements, cosmetics.
  const rewardsNow = () => store.get().rewards || newRewards();
  const rewardSummary = (r = rewardsNow()) => ({ happiness: r.happiness, mood: mood(r.happiness), equipped: r.equipped, achievements: r.achievements.length, total: ACHIEVEMENTS.length });
  function reward(type, extra = {}) {
    const { rewards, events } = applyReward(rewardsNow(), { type, ...extra }, now());
    store.update((st) => ({ ...st, rewards }));
    for (const e of events) log('achievement', { id: e.id });
    if (events.length) ui.gameEvents?.(events);
    ui.status?.({ label: lastLabel, rewards: rewardSummary(rewards) });
  }
  const lower = (x) => String(x || '').trim().toLowerCase();
  function updateQuest(id, fn) { store.update((st) => ({ ...st, quests: st.quests.map((q) => (q.id === id ? fn(q) : q)) })); }

  let currentNudgeKind = 'drift';
  async function showNudge(nudge, source) {
    // The comeback bonus rewards turning a drift around (or getting unstuck),
    // not reacting to the morning plan or evening summary.
    if (currentNudgeKind === 'drift' || currentNudgeKind === 'stuck') lastNudgeAt = now();
    store.update((st) => ({ ...st, nudges: { ...st.nudges, sent: st.nudges.sent + (currentNudgeKind === 'drift' ? 1 : 0) } }));
    log('nudge', { kind: currentNudgeKind, source, message: nudge.message, nextAction: nudge.nextAction });
    await ui.nudge({ ...nudge, kind: currentNudgeKind });
  }

  async function splitStep(steps) {
    store.update((st) => ({
      ...st,
      quests: st.quests.map((q) => {
        if (q.id !== st.activeQuestId) return q;
        const idx = q.steps.findIndex((s) => !s.done);
        const fresh = steps.map((text) => ({ id: newId('s'), text, done: false }));
        return { ...q, steps: idx < 0 ? [...q.steps, ...fresh] : [...q.steps.slice(0, idx), ...fresh, ...q.steps.slice(idx + 1)] };
      }),
    }));
    log('split', { steps });
  }

  function adjustDriftAfter(delta, reason) {
    const before = driftAfter();
    const after = Math.max(T.minDriftAfter, Math.min(T.maxDriftAfter, before + delta));
    if (after !== before) {
      store.update((st) => ({ ...st, settings: { ...(st.settings || {}), driftAfterSeconds: after } }));
      log('timing-adjusted', { from: before, to: after, reason });
    }
    return after;
  }

  // Turn feedback into a per-quest rule (and tune timing). Returns what was
  // learned so the user (or Claude) can confirm it or undo it with forgetRule().
  function learnFromFeedback(verdict, { keyword } = {}) {
    const quest = store.activeQuest();
    let learned = null;
    if (verdict !== 'wrong-nudge' && verdict !== 'missed-drift') throw new Error('verdict must be wrong-nudge or missed-drift');
    if (!quest) learned = { learned: null, why: 'no active quest to attach a rule to' };
    else if (verdict === 'wrong-nudge') {
      const ctx = lastNudgeContext && now() - lastNudgeContext.at <= 30 * 60_000 ? lastNudgeContext : null;
      const kw = lower(keyword) || ctx?.match?.keyword || ctx?.key;
      if (!kw) learned = { learned: null, why: 'no recent nudge with a known trigger' };
      else if (ctx?.match?.list === 'deny' && !keyword) {
        updateQuest(quest.id, (q) => ({ ...q, deny: (q.deny || []).filter((d) => lower(d) !== kw) }));
        learned = { learned: 'removed-distraction', keyword: kw, quest: quest.title };
      } else {
        updateQuest(quest.id, (q) => ({ ...q, allow: [...new Set([...(q.allow || []), kw])], deny: (q.deny || []).filter((d) => lower(d) !== kw) }));
        learned = { learned: 'allow', keyword: kw, quest: quest.title };
      }
      if (kw) verdicts.delete(kw);
    } else {
      let kw = lower(keyword);
      if (!kw) {
        // Most frequent site/app among recent unclear (non-neutral) samples.
        const counts = new Map();
        for (const r of recent.filter((x) => x.label === 'unclear' && !x.neutral && now() - x.at <= 10 * 60_000)) {
          const k = siteKey(r);
          if (k && !(quest.allow || []).some((a) => lower(a) === k)) counts.set(k, (counts.get(k) || 0) + 1);
        }
        kw = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      }
      if (!kw) learned = { learned: null, why: 'could not tell which app or site it was; tell me the name' };
      else {
        updateQuest(quest.id, (q) => ({ ...q, deny: [...new Set([...(q.deny || []), kw])], allow: (q.allow || []).filter((a) => lower(a) !== kw) }));
        learned = { learned: 'deny', keyword: kw, quest: quest.title };
        verdicts.delete(kw);
      }
    }
    // Timing learns too: wrong nudges -> wait longer; missed drifts -> react sooner.
    const driftAfterSeconds = adjustDriftAfter(verdict === 'wrong-nudge' ? T.driftStep : -T.driftStep, verdict);
    log('feedback', { verdict, ...learned, driftAfterSeconds });
    return { verdict, ...learned, driftAfterSeconds };
  }

  const brain = makeBrain({ onNudge: showNudge, onSplit: splitStep, log });

  // Things the user asked for themselves still answer during a call; nothing else interrupts it.
  const ASKED_FOR = new Set(['plan', 'session-start', 'session-end', 'scope']);
  async function speak(kind, event) {
    if ((quiet || inQuietHours(now())) && !ASKED_FOR.has(kind)) { log('quiet-skip', { kind }); return; }
    const quest = store.activeQuest();
    currentNudgeKind = kind;
    try { await brain.handle({ quest, nextStep: nextStep(quest), event, stats: store.get().nudges }); } finally { currentNudgeKind = 'drift'; }
  }

  async function react(event) {
    log(event.type, { ...event, at: undefined });
    if (event.type === 'drift') {
      if (onBreak()) return; // breaks are allowed to wander
      const s = sessionNow();
      if (s?.kind === 'focus') store.update((st) => ({ ...st, session: { ...s, drifts: (s.drifts || 0) + 1 } }));
      const quest = store.activeQuest();
      const last = recent.at(-1);
      lastNudgeContext = { at: now(), match: event.match || null, key: last ? siteKey(last) || last.app : null, questId: quest?.id || null };
      await speak('drift', event);
    } else if (event.type === 'returned') {
      store.update((s) => ({ ...s, nudges: { ...s.nudges, returned: s.nudges.returned + 1, returnSeconds: [...s.nudges.returnSeconds, event.secondsAfterNudge].slice(-200) } }));
      ui.gameEvents?.([{ type: 'returned', secondsAfterNudge: event.secondsAfterNudge }]);
      if (event.secondsAfterNudge != null && event.secondsAfterNudge <= 60) reward('quick');
    }
  }

  // --- day summaries --------------------------------------------------------
  function dayActivity(day = dayKey(now())) {
    const entries = store.get().log.filter((e) => dayKey(e.at) === day);
    const steps = entries.filter((e) => e.type === 'step-done');
    const returns = entries.filter((e) => e.type === 'returned').map((e) => e.secondsAfterNudge).filter((x) => x != null);
    return {
      day,
      steps: steps.length,
      xp: steps.reduce((n, e) => n + (e.xp || 0), 0),
      titles: steps.flatMap((e) => e.titles || []),
      driftNudges: entries.filter((e) => e.type === 'nudge' && (e.kind || 'drift') === 'drift').length,
      returns: returns.length,
      medianReturnSeconds: median(returns),
      bossesDefeated: steps.filter((e) => (e.events || []).includes('boss-defeated')).length,
      parked: entries.filter((e) => e.type === 'parked').length,
    };
  }

  // --- focus sessions (timer ring) -------------------------------------------
  // A visible countdown against time blindness. Focus ends in a short break
  // (no drift nudges during it), then a call back to the next step.
  const sessionNow = () => store.get().session || null;
  function setSession(session) { store.update((st) => ({ ...st, session })); ui.status?.({ label: lastLabel, session }); }
  async function startSession({ minutes = 25 } = {}) {
    const m = Math.max(5, Math.min(120, Math.round(Number(minutes) || 25)));
    const at = now();
    const session = { kind: 'focus', minutes: m, startAt: at, endAt: at + m * 60_000, questId: store.activeQuest()?.id || null };
    setSession(session);
    log('session-start', { minutes: m });
    await speak('session-start', { type: 'session-start', minutes: m });
    return session;
  }
  // A quest was just named (e.g. in the pet's first-run question): the brain
  // breaks it into tiny steps when it has none, and points at the first one.
  async function planQuest() {
    if (!store.activeQuest()) throw new Error('no active quest to plan');
    log('plan', {});
    await speak('plan', { type: 'plan' });
  }

  function stopSession() { const s = sessionNow(); setSession(null); log('session-stop', {}); return { stopped: !!s }; }
  async function checkSession(at, label) {
    const s = sessionNow();
    if (!s || at < s.endAt) return;
    if (s.kind === 'focus') {
      // Perfect session: not one drift nudge while the ring ran.
      const perfect = !s.drifts;
      log('session-done', { minutes: s.minutes, perfect });
      ui.gameEvents?.([{ type: 'session-done', minutes: s.minutes }, ...(perfect ? [{ type: 'perfect-session', minutes: s.minutes }] : [])]);
      reward('session');
      if (perfect) reward('perfect');
      rhythm.rested();
      setSession({ kind: 'break', minutes: T.breakMinutes, startAt: at, endAt: at + T.breakMinutes * 60_000, questId: s.questId });
      await speak('session-end', { type: 'session-end', minutes: s.minutes, breakMinutes: T.breakMinutes });
    } else {
      setSession(null);
      log('break-done', {});
      if (label !== 'away') await speak('break-end', { type: 'break-end' });
    }
  }
  const onBreak = () => sessionNow()?.kind === 'break';

  // --- vault ("park it"): a distraction is saved for later, not blocked ------
  // Parking is an explicit user action, so the parked item may keep its page
  // title or note (unlike passive watching, which never stores titles).
  function park({ note = '' } = {}) {
    const last = [...recent].reverse().find((r) => !r.neutral);
    const fromWindow = !note && last;
    const item = {
      id: newId('v'), at: now(),
      key: fromWindow ? siteKey(last) || last.app : null,
      title: fromWindow ? String(last.title || '').replace(/\s*[-—|]\s*(brave|google chrome|chrome|microsoft edge|firefox|opera)\s*$/i, '').slice(0, 120) : null,
      note: String(note || '').slice(0, 300) || null,
      quest: store.activeQuest()?.title || null,
    };
    if (!item.title && !item.note) throw new Error('nothing to park: no recent window and no note');
    store.update((st) => ({ ...st, vault: [item, ...(st.vault || [])].slice(0, 200) }));
    log('parked', { key: item.key });
    reward('park');
    ui.gameEvents?.([{ type: 'parked', label: item.note || item.key || item.title }]);
    return item;
  }

  function morningSummary() {
    const st = store.get();
    const today = new Date(now());
    const dated = st.quests.filter((q) => q.deadline && nextStep(q)).map((q) => ({ q, days: Math.ceil((new Date(`${q.deadline}T23:59:59`) - today) / 86_400_000) })).sort((a, b) => a.days - b.days).slice(0, 2);
    const parts = dated.map(({ q, days }) => `${q.title} (${days <= 0 ? 'due today' : `${days} day${days === 1 ? '' : 's'} left`})`);
    return parts.length ? `Good morning. Up first: ${parts.join(', then ')}.` : 'Good morning. Pick one quest and start tiny.';
  }

  function eveningSummary(a) {
    if (!a.steps && !a.driftNudges) return null;
    const bits = [`${a.steps} step${a.steps === 1 ? '' : 's'} done`, a.xp ? `+${a.xp} XP` : null];
    if (a.driftNudges) bits.push(`${a.returns}/${a.driftNudges} drifts turned around${a.medianReturnSeconds != null ? ` (back in ~${Math.max(1, Math.round(a.medianReturnSeconds / 60))} min)` : ''}`);
    if (a.titles.length) bits.push(`new title: ${a.titles.map((t) => titleName[t] || t).join(', ')}`);
    if (a.bossesDefeated) bits.push(`${a.bossesDefeated} boss${a.bossesDefeated === 1 ? '' : 'es'} defeated`);
    if (a.parked) bits.push(`${a.parked} thing${a.parked === 1 ? '' : 's'} parked for later (in your vault)`);
    return `Today: ${bits.filter(Boolean).join(' · ')}. Streak ${store.get().game.streak.days} day${store.get().game.streak.days === 1 ? '' : 's'}.`;
  }

  async function bookends(at, label) {
    if (label === 'away') return;
    const d = new Date(at), today = dayKey(at), hour = d.getHours();
    const b = store.get().bookends || {};
    if (hour >= setting('morningHour') && hour < 12 && b.morning !== today) {
      store.update((st) => ({ ...st, bookends: { ...(st.bookends || {}), morning: today } }));
      await speak('morning', { type: 'morning', summary: morningSummary() });
    }
    if (hour >= setting('eveningHour') && b.evening !== today) {
      const summary = eveningSummary(dayActivity(today));
      store.update((st) => ({ ...st, bookends: { ...(st.bookends || {}), evening: today } }));
      if (summary) await speak('evening', { type: 'evening', summary });
    }
  }

  // --- judging unclear stretches -------------------------------------------
  async function maybeJudge(sample, c, at) {
    // Messaging: a deterministic allowance, never sent to the judge. Short
    // hops away (< 2 min) do not reset the clock.
    if (c.comm) {
      if (!commRun || at - commRun.lastAt > 2 * 60_000) commRun = { since: at, lastAt: at };
      commRun.lastAt = at;
      unclearRun = null;
      if (at - commRun.since >= T.commAllowanceMinutes * 60_000) return { label: 'drift', reason: `messaging (${c.comm}) for ${T.commAllowanceMinutes}+ min`, match: { list: 'communication', keyword: c.comm } };
      return c;
    }
    if (c.label !== 'unclear' || c.neutral || !sample) { unclearRun = null; return c; }
    const key = siteKey(sample) || lower(sample.app);
    if (!key) return c;
    const v = verdicts.get(key);
    if (v && at < v.until) return v.label === 'unclear' ? c : { label: v.label, reason: `judged: ${v.reason}`, match: { list: 'judged', keyword: key } };
    if (!unclearRun || unclearRun.key !== key) unclearRun = { key, since: at };
    if (!judge || judge.mode === 'off' || at - unclearRun.since < T.unclearMinutes * 60_000) return c;
    const quest = store.activeQuest();
    const screenshot = judge.mode === 'screenshot' && captureScreen ? await captureScreen() : null;
    const r = await judge.judge({ quest, nextStep: nextStep(quest), sample, minutes: Math.round((at - unclearRun.since) / 60_000), screenshot });
    const label = r.verdict === 'on-task' ? 'on-task' : r.verdict === 'off-task' ? 'drift' : 'unclear';
    verdicts.set(key, { label, until: at + T.judgeCacheMinutes * 60_000, reason: r.reason || r.verdict });
    log('judged', { key, verdict: r.verdict, reason: r.reason, source: r.source });
    unclearRun = null;
    return label === 'unclear' ? c : { label, reason: `judged: ${r.reason || r.verdict}`, match: { list: 'judged', keyword: key } };
  }

  // --- rhythm: call quiet, flow combo, hyperfocus ----------------------------
  async function keepRhythm(sample, c, at, gapMs) {
    const events = rhythm.push({ at, label: c.label, quiet: !!c.quiet, gapMs });
    const q = rhythm.isQuiet(at), full = !!sample?.fullscreen;
    if (q !== quiet || full !== fullscreen) {
      if (q !== quiet) log(q ? 'quiet-start' : 'quiet-end', { reason: c.quiet ? c.reason : '' });
      quiet = q; fullscreen = full;
      ui.status?.({ label: lastLabel, quiet, fullscreen });
    }
    for (const e of events) {
      if (e.type === 'flow') { log('flow', { level: e.level, minutes: e.minutes }); ui.gameEvents?.([e]); reward('flow', { level: e.level }); }
      if (e.type === 'flow-banked') {
        store.update((st) => {
          const f = st.flow || { totalMinutes: 0, bestMinutes: 0, byDay: {} }, day = dayKey(at);
          return { ...st, flow: { totalMinutes: f.totalMinutes + e.minutes, bestMinutes: Math.max(f.bestMinutes, e.minutes), byDay: { ...f.byDay, [day]: (f.byDay[day] || 0) + e.minutes } } };
        });
        log('flow-banked', { minutes: e.minutes });
        ui.gameEvents?.([e]);
      }
      if (e.type === 'hyperfocus' && !onBreak()) { log('hyperfocus', { minutes: e.minutes }); await speak('hyperfocus', { type: 'hyperfocus', minutes: e.minutes }); }
    }
  }

  // --- scope guard: drifting inside the work -----------------------------------
  async function guardScope(sample, c, at, quest) {
    if (!quest || quiet || onBreak()) { sideRun = null; return; }
    // 1. A git pile-up for quests tied to a repo (checked every 5 min, warned at most every 30).
    if (quest.repo && at - gitCheckedAt >= 5 * 60_000 && c.label !== 'away') {
      gitCheckedAt = at;
      const g = await gitScope(quest.repo, at);
      if (tooMuchUncommitted(g) && at - lastScopeWarnAt >= 30 * 60_000) {
        lastScopeWarnAt = at;
        log('scope-uncommitted', { files: g.files, lines: g.lines, lastCommitMinutes: g.lastCommitMinutes });
        await speak('scope', { type: 'scope', reason: 'uncommitted', files: g.files, lines: g.lines, minutes: g.lastCommitMinutes });
      }
    }
    // 2. Same site, different job: 4+ minutes on a page context the decider says isn't this quest.
    if (c.label !== 'on-task' || !judge || judge.mode === 'off') { sideRun = null; return; }
    const key = pageKey(sample);
    if (!key || (quest.scopeAllow || []).includes(key)) { sideRun = null; return; }
    const vkey = `${quest.id}|${key}`;
    if (sideVerdicts.has(vkey)) return;
    if (!sideRun || sideRun.key !== key) { sideRun = { key, since: at }; return; }
    if (at - sideRun.since < 4 * 60_000) return;
    const r = await judge.judge({ quest, nextStep: nextStep(quest), sample, minutes: Math.round((at - sideRun.since) / 60_000) });
    const verdict = r.verdict === 'off-task' ? 'side-task' : 'in-scope';
    sideVerdicts.set(vkey, verdict);
    log('side-judged', { verdict, source: r.source });
    if (verdict === 'side-task') {
      lastSide = { questId: quest.id, key };
      await speak('side-task', { type: 'side-task', where: key });
    }
  }

  // An agent (or the user) asks: is this new request part of the quest?
  // Creep words or the local decider -> say so once, kindly, with options.
  async function scopeCheck(request) {
    const quest = store.activeQuest();
    const text = String(request || '').slice(0, 400);
    if (!quest) return { verdict: 'no-quest', suggestion: 'No active quest: start one with this request, or keep going.' };
    let verdict = scopeHint(text) === 'creep' ? 'creep' : 'in-scope', source = 'words';
    if (verdict !== 'creep' && judge && judge.mode !== 'off') {
      const r = await judge.judge({ quest, nextStep: nextStep(quest), sample: { app: 'AI chat', title: text }, minutes: 0 });
      if (r.verdict === 'off-task') { verdict = 'creep'; source = r.source; }
    }
    log('scope-check', { verdict, source });
    if (verdict !== 'creep') return { verdict, quest: quest.title };
    store.update((st) => ({ ...st, scope: { creepsByDay: { ...(st.scope?.creepsByDay || {}), [dayKey(now())]: ((st.scope?.creepsByDay || {})[dayKey(now())] || 0) + 1 } } }));
    await speak('scope', { type: 'scope', reason: 'creep', request: text });
    return { verdict, quest: quest.title, suggestion: `New scope. Finish and commit "${quest.title}" first, then park this (companion_park) or start it as its own quest.` };
  }

  // "It's part of it": the side task's page joins this quest's scope.
  function allowScope() {
    if (!lastSide) throw new Error('no side task to allow');
    updateQuest(lastSide.questId, (q) => ({ ...q, scopeAllow: [...new Set([...(q.scopeAllow || []), lastSide.key])] }));
    sideVerdicts.set(`${lastSide.questId}|${lastSide.key}`, 'in-scope');
    log('scope-allowed', {});
    const r = { allowed: lastSide.key };
    lastSide = null;
    return r;
  }

  // Happiness settles back toward 50 over the hours (never below).
  function settleHappiness(at) {
    const r = store.get().rewards;
    if (!r) return;
    const hours = (at - (r.settledAt || at)) / 3_600_000;
    if (!r.settledAt || hours >= 1) store.update((st) => ({ ...st, rewards: { ...settle(r, r.settledAt ? hours : 0), settledAt: at } }));
  }

  async function tick() {
    const st0 = store.get();
    if (st0.paused && st0.pausedUntil && now() >= st0.pausedUntil) { store.update((st) => ({ ...st, paused: false, pausedUntil: null })); log('resumed', { reason: 'snooze ended' }); ui.status?.({ label: lastLabel, paused: false, pausedUntil: null }); }
    if (busy || store.get().paused) { lastTickAt = null; return; }
    busy = true;
    try {
      const sample = await watcher.sample();
      const quest = store.activeQuest();
      const at = now();
      settleHappiness(at);
      let c = classify(sample, quest, rules);
      if (sample) {
        recent.push({ at, app: sample.app, title: sample.title, label: c.label, neutral: !!c.neutral });
        recent = recent.filter((r) => at - r.at <= RECENT_MS);
      }
      c = await maybeJudge(sample, c, at);
      if (c.label !== lastLabel) {
        // Only the app name and the rule that fired are kept, never the title.
        log('label', { label: c.label, app: sample?.app || '', reason: c.reason });
        lastLabel = c.label;
        ui.status?.({ label: c.label, app: sample?.app });
      }
      // Gaps are capped so sleep or a locked screen never counts as time.
      const gap = lastTickAt ? Math.min(at - lastTickAt, sampleEverySeconds * 2000) : 0;
      await keepRhythm(sample, c, at, gap);
      // During a call (and its grace period) drift doesn't build up at all, so the
      // first nudge after the call isn't swallowed by a cooldown.
      for (const event of drift.push({ label: quiet && c.label === 'drift' ? 'unclear' : c.label, at, reason: c.reason, match: c.match })) await react(event);
      await guardScope(sample, c, at, quest);

      // Stuck: on-task time accumulates.
      if (c.label === 'on-task') onTaskMs += gap;
      const step = nextStep(quest);
      if (step && onTaskMs >= T.stuckMinutes * 60_000) {
        const onTaskSeconds = Math.round(onTaskMs / 1000);
        onTaskMs = 0;
        log('stuck', { onTaskSeconds });
        await speak('stuck', { type: 'stuck', onTaskSeconds });
      }
      lastTickAt = at;
      await checkSession(at, c.label);
      await bookends(at, c.label);
    } catch (e) {
      log('tick-error', { error: String(e.message || e).slice(0, 200) });
    } finally { busy = false; }
  }

  // A message the user sent to an AI assistant (Claude Code hook). If a quest
  // is active and the judge says the chat is clearly about something else,
  // one gentle nudge (at most every 30 min). The text is never stored.
  async function noteChat(text) {
    const quest = store.activeQuest();
    if (!quest || !judge || judge.mode === 'off' || store.get().paused) return { checked: false, why: !quest ? 'no active quest' : 'judge off or paused' };
    const r = await judge.judge({ quest, nextStep: nextStep(quest), sample: { app: 'AI chat', title: String(text).slice(0, 300) }, minutes: 0 });
    log('chat-judged', { verdict: r.verdict, source: r.source });
    if (r.verdict !== 'off-task') return { checked: true, verdict: r.verdict };
    if (now() - lastChatNudgeAt < 30 * 60_000) return { checked: true, verdict: r.verdict, nudged: false, why: 'cooldown' };
    lastChatNudgeAt = now();
    await speak('chat', { type: 'chat', reason: r.reason });
    return { checked: true, verdict: r.verdict, nudged: true };
  }

  return {
    tick,
    noteChat,
    park,
    startSession,
    stopSession,
    planQuest,
    scopeCheck,
    allowScope,
    settings: () => ({ ...SETTINGS, ...(store.get().settings || {}) }),
    rewards() {
      const r = rewardsNow();
      return { ...rewardSummary(r), achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc, unlocked: r.achievements.includes(a.id), unlocks: a.unlocks ? COSMETICS[a.unlocks] : null })), wardrobe: Object.entries(COSMETICS).map(([id, name]) => ({ id, name, unlocked: r.unlocked.includes(id), equipped: r.equipped === id })), trophies: r.trophies };
    },
    equip(item) {
      const r = equip(rewardsNow(), item || null);
      store.update((st) => ({ ...st, rewards: r }));
      log('equip', { item: r.equipped });
      ui.status?.({ label: lastLabel, rewards: rewardSummary(r) });
      return rewardSummary(r);
    },
    week: () => weekRecap(store.get().log, now()),
    // Validated, so a bad value from any client can't break the loop.
    updateSettings(patch = {}) {
      const int = (v, lo, hi) => (v == null || v === '' ? null : Math.max(lo, Math.min(hi, Math.round(Number(v)))));
      const clean = {};
      if ('driftAfterSeconds' in patch) clean.driftAfterSeconds = int(patch.driftAfterSeconds, T.minDriftAfter, T.maxDriftAfter) ?? SETTINGS.driftAfterSeconds;
      for (const k of ['quietFrom', 'quietTo']) if (k in patch) clean[k] = int(patch[k], 0, 23);
      if ('morningHour' in patch) clean.morningHour = int(patch.morningHour, 0, 12) ?? SETTINGS.morningHour;
      if ('eveningHour' in patch) clean.eveningHour = int(patch.eveningHour, 12, 23) ?? SETTINGS.eveningHour;
      for (const k of ['sound', 'fx']) if (k in patch) clean[k] = !!patch[k];
      if ('volume' in patch) clean.volume = int(patch.volume, 0, 100) ?? SETTINGS.volume;
      store.update((st) => ({ ...st, settings: { ...(st.settings || {}), ...clean } }));
      log('settings', { keys: Object.keys(clean) });
      const all = { ...SETTINGS, ...store.get().settings };
      ui.status?.({ label: lastLabel, settings: all });
      return all;
    },
    vault: () => store.get().vault || [],
    unpark(id) {
      const before = (store.get().vault || []).length;
      store.update((st) => ({ ...st, vault: (st.vault || []).filter((v) => v.id !== id) }));
      log('unparked', {});
      return { removed: before - (store.get().vault || []).length };
    },
    start() { if (!timer) { timer = setInterval(tick, sampleEverySeconds * 1000); tick(); } },
    stop() { clearInterval(timer); timer = null; watcher.stop?.(); },
    learnFromFeedback,
    dayActivity,
    rules() {
      const q = store.activeQuest();
      return { quest: q ? { title: q.title, allow: q.allow || [], deny: q.deny || [] } : null, globalDistractions: rules.distractions, nudgeAfterSeconds: driftAfter(), judge: judge?.mode || 'off' };
    },
    forgetRule(keyword) {
      const q = store.activeQuest();
      const kw = lower(keyword);
      if (!q) throw new Error('no active quest');
      const had = [...(q.allow || []), ...(q.deny || [])].some((x) => lower(x) === kw);
      updateQuest(q.id, (x) => ({ ...x, allow: (x.allow || []).filter((a) => lower(a) !== kw), deny: (x.deny || []).filter((d) => lower(d) !== kw) }));
      verdicts.delete(kw);
      log('rule-forgotten', { keyword: kw, existed: had });
      return { forgotten: had ? kw : null, quest: q.title };
    },
    // Optional minutes: a snooze that resumes by itself (survives restarts via pausedUntil).
    setPaused(paused, { minutes } = {}) {
      const pausedUntil = paused && minutes ? now() + minutes * 60_000 : null;
      store.update((st) => ({ ...st, paused, pausedUntil }));
      log(paused ? 'paused' : 'resumed', minutes ? { minutes } : {});
      ui.status?.({ label: lastLabel, paused, pausedUntil });
      return { paused, pausedUntil };
    },
    addQuest(quest, { activate = true } = {}) {
      store.update((st) => ({ ...st, quests: [...st.quests, quest], activeQuestId: activate ? quest.id : st.activeQuestId }));
      if (activate) onTaskMs = 0;
      log('quest-added', { title: quest.title });
    },
    setActiveQuest(id) { store.update((st) => ({ ...st, activeQuestId: id })); onTaskMs = 0; log('quest-activated', { id }); },
    // Edit: title, deadline (boss), repo, keywords; steps are replaced only if given.
    editQuest(id, patch = {}) {
      const q = store.get().quests.find((x) => x.id === id);
      if (!q) throw new Error('no such quest');
      const str = (v, n) => String(v ?? '').trim().slice(0, n);
      updateQuest(id, (x) => ({
        ...x,
        ...(patch.title != null && str(patch.title, 120) ? { title: str(patch.title, 120) } : {}),
        ...(patch.deadline !== undefined ? { deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(patch.deadline)) ? patch.deadline : null, boss: /^\d{4}-\d{2}-\d{2}$/.test(String(patch.deadline)) } : {}),
        ...(patch.repo !== undefined ? { repo: str(patch.repo, 400) || null } : {}),
        ...(Array.isArray(patch.allow) ? { allow: patch.allow.map((s) => str(s, 40).toLowerCase()).filter(Boolean).slice(0, 20) } : {}),
        ...(Array.isArray(patch.steps) ? { steps: patch.steps.map((s) => str(s, 120)).filter(Boolean).slice(0, 30).map((text) => ({ id: newId('s'), text, done: false })) } : {}),
      }));
      log('quest-edited', { fields: Object.keys(patch) });
      return { edited: true };
    },
    removeQuest(id) {
      const st = store.get();
      if (!st.quests.some((q) => q.id === id)) throw new Error('no such quest');
      store.update((s) => {
        const quests = s.quests.filter((q) => q.id !== id);
        return { ...s, quests, activeQuestId: s.activeQuestId === id ? quests[0]?.id ?? null : s.activeQuestId };
      });
      log('quest-removed', {});
      return { removed: true, active: store.activeQuest()?.title || null };
    },
    addSteps(questId, steps) {
      store.update((st) => ({ ...st, quests: st.quests.map((q) => (q.id === questId ? { ...q, steps: [...q.steps, ...steps.map((text) => ({ id: newId('s'), text, done: false }))] } : q)) }));
      log('steps-added', { count: steps.length });
    },
    listQuests() {
      const st = store.get();
      return st.quests.map((q) => ({ id: q.id, title: q.title, tag: q.tag, active: q.id === st.activeQuestId, deadline: q.deadline, done: q.steps.filter((s) => s.done).length, total: q.steps.length, next: nextStep(q)?.text || null }));
    },
    completeNextStep() {
      const quest = store.activeQuest();
      const step = nextStep(quest);
      if (!step) return [];
      const r = completeStep(store.get().game, { quest, stepId: step.id, at: now(), lastNudgeAt });
      store.update((st) => ({ ...st, game: r.game, quests: st.quests.map((q) => (q.id === quest.id ? r.quest : q)) }));
      onTaskMs = 0;
      log('step-done', { step: step.text, xp: r.events.find((e) => e.type === 'xp')?.amount || 0, titles: r.events.filter((e) => e.type === 'title').map((e) => e.id), events: r.events.map((e) => e.type) });
      ui.gameEvents?.(r.events);
      reward('step');
      if (r.events.some((e) => e.type === 'boss-defeated')) reward('boss', { quest: quest.title });
      return r.events;
    },
    status() {
      const st = store.get();
      const quest = store.activeQuest();
      return { rewards: rewardSummary(), settings: { ...SETTINGS, ...(st.settings || {}) }, flow: rhythm.flow(), quiet, fullscreen, session: st.session || null, paused: st.paused, pausedUntil: st.pausedUntil || null, label: lastLabel, quest: quest && { title: quest.title, next: nextStep(quest)?.text || null, boss: quest.boss ? bossHp(quest) : null }, level: levelProgress(st.game.xp.total), skills: st.game.xp.skills, titles: st.game.titles, streak: st.game.streak, nudges: st.nudges, nudgeAfterSeconds: driftAfter(), judge: judge?.mode || 'off', today: dayActivity() };
    },
  };
}

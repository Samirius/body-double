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

export const DEFAULT_TIMING = {
  unclearMinutes: 6, // same unclear site/app this long -> ask the judge
  judgeCacheMinutes: 30, // a verdict holds this long for that site/app
  stuckMinutes: 25, // on task this long without finishing the step -> offer to split
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
  const drift = createDriftTracker({ ...driftOptions, driftAfterSeconds: driftAfter });
  let lastLabel = null, lastNudgeAt = null, timer = null, busy = false, lastTickAt = null;
  // Recent samples, in memory only (titles never reach disk): used to learn
  // from "you missed my drift" feedback. Last nudge context: for "wrong nudge".
  const RECENT_MS = 15 * 60_000;
  let recent = [];
  let lastNudgeContext = null;
  const verdicts = new Map(); // site key -> { label, until, reason } (judge cache)
  let unclearRun = null; // { key, since }
  let onTaskMs = 0; // on-task time since the last finished step (for "stuck")
  let lastChatNudgeAt = 0; // chat-drift nudges at most every 30 min

  const nextStep = (q) => q?.steps.find((s) => !s.done) || null;
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

  async function speak(kind, event) {
    const quest = store.activeQuest();
    currentNudgeKind = kind;
    try { await brain.handle({ quest, nextStep: nextStep(quest), event, stats: store.get().nudges }); } finally { currentNudgeKind = 'drift'; }
  }

  async function react(event) {
    log(event.type, { ...event, at: undefined });
    if (event.type === 'drift') {
      const quest = store.activeQuest();
      const last = recent.at(-1);
      lastNudgeContext = { at: now(), match: event.match || null, key: last ? siteKey(last) || last.app : null, questId: quest?.id || null };
      await speak('drift', event);
    } else if (event.type === 'returned') {
      store.update((s) => ({ ...s, nudges: { ...s.nudges, returned: s.nudges.returned + 1, returnSeconds: [...s.nudges.returnSeconds, event.secondsAfterNudge].slice(-200) } }));
      ui.gameEvents?.([{ type: 'returned', secondsAfterNudge: event.secondsAfterNudge }]);
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
    };
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
    return `Today: ${bits.filter(Boolean).join(' · ')}. Streak ${store.get().game.streak.days} day${store.get().game.streak.days === 1 ? '' : 's'}.`;
  }

  async function bookends(at, label) {
    if (label === 'away') return;
    const d = new Date(at), today = dayKey(at), hour = d.getHours();
    const b = store.get().bookends || {};
    if (hour >= T.morningHour && hour < 12 && b.morning !== today) {
      store.update((st) => ({ ...st, bookends: { ...(st.bookends || {}), morning: today } }));
      await speak('morning', { type: 'morning', summary: morningSummary() });
    }
    if (hour >= T.eveningHour && b.evening !== today) {
      const summary = eveningSummary(dayActivity(today));
      store.update((st) => ({ ...st, bookends: { ...(st.bookends || {}), evening: today } }));
      if (summary) await speak('evening', { type: 'evening', summary });
    }
  }

  // --- judging unclear stretches -------------------------------------------
  async function maybeJudge(sample, c, at) {
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

  async function tick() {
    const st0 = store.get();
    if (st0.paused && st0.pausedUntil && now() >= st0.pausedUntil) { store.update((st) => ({ ...st, paused: false, pausedUntil: null })); log('resumed', { reason: 'snooze ended' }); ui.status?.({ label: lastLabel, paused: false, pausedUntil: null }); }
    if (busy || store.get().paused) { lastTickAt = null; return; }
    busy = true;
    try {
      const sample = await watcher.sample();
      const quest = store.activeQuest();
      const at = now();
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
      for (const event of drift.push({ label: c.label, at, reason: c.reason, match: c.match })) await react(event);

      // Stuck: on-task time accumulates (gaps capped so sleep/lock never counts).
      const gap = lastTickAt ? Math.min(at - lastTickAt, sampleEverySeconds * 2000) : 0;
      if (c.label === 'on-task') onTaskMs += gap;
      const step = nextStep(quest);
      if (step && onTaskMs >= T.stuckMinutes * 60_000) {
        const onTaskSeconds = Math.round(onTaskMs / 1000);
        onTaskMs = 0;
        log('stuck', { onTaskSeconds });
        await speak('stuck', { type: 'stuck', onTaskSeconds });
      }
      lastTickAt = at;
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
      return r.events;
    },
    status() {
      const st = store.get();
      const quest = store.activeQuest();
      return { paused: st.paused, pausedUntil: st.pausedUntil || null, label: lastLabel, quest: quest && { title: quest.title, next: nextStep(quest)?.text || null, boss: quest.boss ? bossHp(quest) : null }, level: levelProgress(st.game.xp.total), skills: st.game.xp.skills, titles: st.game.titles, streak: st.game.streak, nudges: st.nudges, nudgeAfterSeconds: driftAfter(), judge: judge?.mode || 'off', today: dayActivity() };
    },
  };
}

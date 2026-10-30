// The heartbeat: sample the foreground window, classify it, feed the drift
// tracker, and react. UI-agnostic: the terminal and the desktop pet both
// plug in through `ui` ({ nudge, gameEvents, status }).
import { classify, siteKey, DEFAULT_RULES } from './core/classifier.js';
import { createDriftTracker } from './core/drift.js';
import { completeStep, bossHp, levelProgress } from './core/game.js';
import { newId } from './core/store.js';

// `makeBrain({ onNudge, onSplit, log })` builds the brain (see agent/brain.js);
// the companion owns the callbacks so nudge stats live in one place.
export function createCompanion({ store, watcher, makeBrain, ui, rules = DEFAULT_RULES, driftOptions = {}, sampleEverySeconds = 15, now = Date.now }) {
  const drift = createDriftTracker(driftOptions);
  let lastLabel = null, lastNudgeAt = null, timer = null, busy = false;
  // Recent samples, in memory only (titles never reach disk): used to learn
  // from "you missed my drift" feedback. Last nudge context: for "wrong nudge".
  const RECENT_MS = 15 * 60_000;
  let recent = [];
  let lastNudgeContext = null;

  const nextStep = (q) => q?.steps.find((s) => !s.done) || null;

  async function showNudge(nudge, source) {
    lastNudgeAt = now();
    store.update((st) => ({ ...st, nudges: { ...st.nudges, sent: st.nudges.sent + 1 } }));
    store.log('nudge', { source, message: nudge.message, nextAction: nudge.nextAction });
    await ui.nudge(nudge);
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
    store.log('split', { steps });
  }

  const lower = (x) => String(x || '').trim().toLowerCase();
  function updateQuest(id, fn) { store.update((st) => ({ ...st, quests: st.quests.map((q) => (q.id === id ? fn(q) : q)) })); }

  // Turn feedback into a per-quest rule. Returns what was learned so the user
  // (or Claude) can confirm it or undo it with forgetRule().
  function learnFromFeedback(verdict, { keyword } = {}) {
    const quest = store.activeQuest();
    let learned = null;
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
    } else if (verdict === 'missed-drift') {
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
      }
    } else throw new Error('verdict must be wrong-nudge or missed-drift');
    store.log('feedback', { verdict, ...learned });
    return { verdict, ...learned };
  }

  const brain = makeBrain({ onNudge: showNudge, onSplit: splitStep, log: (type, data) => store.log(type, data) });

  async function react(event) {
    const st = store.get();
    const quest = store.activeQuest();
    store.log(event.type, { ...event, at: undefined });
    if (event.type === 'drift') {
      const last = recent.at(-1);
      lastNudgeContext = { at: now(), match: event.match || null, key: last ? siteKey(last) : null, questId: quest?.id || null };
      await brain.handle({ quest, nextStep: nextStep(quest), event, stats: st.nudges });
    } else if (event.type === 'returned') {
      store.update((s) => ({ ...s, nudges: { ...s.nudges, returned: s.nudges.returned + 1, returnSeconds: [...s.nudges.returnSeconds, event.secondsAfterNudge].slice(-200) } }));
      ui.gameEvents?.([{ type: 'returned', secondsAfterNudge: event.secondsAfterNudge }]);
    }
  }

  async function tick() {
    if (busy || store.get().paused) return;
    busy = true;
    try {
      const sample = await watcher.sample();
      const quest = store.activeQuest();
      const c = classify(sample, quest, rules);
      const at = now();
      if (sample) {
        recent.push({ at, app: sample.app, title: sample.title, label: c.label, neutral: !!c.neutral });
        recent = recent.filter((r) => at - r.at <= RECENT_MS);
      }
      if (c.label !== lastLabel) {
        // Only the app name and the rule that fired are kept, never the title.
        store.log('label', { label: c.label, app: sample?.app || '', reason: c.reason });
        lastLabel = c.label;
        ui.status?.({ label: c.label, app: sample?.app });
      }
      for (const event of drift.push({ label: c.label, at, reason: c.reason, match: c.match })) await react(event);
    } catch (e) {
      store.log('tick-error', { error: String(e.message || e).slice(0, 200) });
    } finally { busy = false; }
  }

  return {
    tick,
    start() { if (!timer) { timer = setInterval(tick, sampleEverySeconds * 1000); tick(); } },
    stop() { clearInterval(timer); timer = null; watcher.stop?.(); },
    learnFromFeedback,
    rules() {
      const q = store.activeQuest();
      return { quest: q ? { title: q.title, allow: q.allow || [], deny: q.deny || [] } : null, globalDistractions: rules.distractions };
    },
    forgetRule(keyword) {
      const q = store.activeQuest();
      const kw = lower(keyword);
      if (!q) throw new Error('no active quest');
      const had = [...(q.allow || []), ...(q.deny || [])].some((x) => lower(x) === kw);
      updateQuest(q.id, (x) => ({ ...x, allow: (x.allow || []).filter((a) => lower(a) !== kw), deny: (x.deny || []).filter((d) => lower(d) !== kw) }));
      store.log('rule-forgotten', { keyword: kw, existed: had });
      return { forgotten: had ? kw : null, quest: q.title };
    },
    setPaused(paused) { store.update((st) => ({ ...st, paused })); store.log(paused ? 'paused' : 'resumed'); },
    addQuest(quest, { activate = true } = {}) {
      store.update((st) => ({ ...st, quests: [...st.quests, quest], activeQuestId: activate ? quest.id : st.activeQuestId }));
      store.log('quest-added', { title: quest.title });
    },
    setActiveQuest(id) { store.update((st) => ({ ...st, activeQuestId: id })); store.log('quest-activated', { id }); },
    addSteps(questId, steps) {
      store.update((st) => ({ ...st, quests: st.quests.map((q) => (q.id === questId ? { ...q, steps: [...q.steps, ...steps.map((text) => ({ id: newId('s'), text, done: false }))] } : q)) }));
      store.log('steps-added', { count: steps.length });
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
      store.log('step-done', { step: step.text, events: r.events.map((e) => e.type) });
      ui.gameEvents?.(r.events);
      return r.events;
    },
    status() {
      const st = store.get();
      const quest = store.activeQuest();
      return { paused: st.paused, label: lastLabel, quest: quest && { title: quest.title, next: nextStep(quest)?.text || null, boss: quest.boss ? bossHp(quest) : null }, level: levelProgress(st.game.xp.total), skills: st.game.xp.skills, titles: st.game.titles, streak: st.game.streak, nudges: st.nudges };
    },
  };
}

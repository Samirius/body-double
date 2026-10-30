// The heartbeat: sample the foreground window, classify it, feed the drift
// tracker, and react. UI-agnostic: the terminal and the desktop pet both
// plug in through `ui` ({ nudge, gameEvents, status }).
import { classify, DEFAULT_RULES } from './core/classifier.js';
import { createDriftTracker } from './core/drift.js';
import { completeStep, bossHp, levelProgress } from './core/game.js';
import { newId } from './core/store.js';

// `makeBrain({ onNudge, onSplit, log })` builds the brain (see agent/brain.js);
// the companion owns the callbacks so nudge stats live in one place.
export function createCompanion({ store, watcher, makeBrain, ui, rules = DEFAULT_RULES, driftOptions = {}, sampleEverySeconds = 15, now = Date.now }) {
  const drift = createDriftTracker(driftOptions);
  let lastLabel = null, lastNudgeAt = null, timer = null, busy = false;

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

  const brain = makeBrain({ onNudge: showNudge, onSplit: splitStep, log: (type, data) => store.log(type, data) });

  async function react(event) {
    const st = store.get();
    const quest = store.activeQuest();
    store.log(event.type, { ...event, at: undefined });
    if (event.type === 'drift') {
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
      if (c.label !== lastLabel) {
        // Only the app name and the rule that fired are kept, never the title.
        store.log('label', { label: c.label, app: sample?.app || '', reason: c.reason });
        lastLabel = c.label;
        ui.status?.({ label: c.label, app: sample?.app });
      }
      for (const event of drift.push({ label: c.label, at, reason: c.reason })) await react(event);
    } catch (e) {
      store.log('tick-error', { error: String(e.message || e).slice(0, 200) });
    } finally { busy = false; }
  }

  return {
    tick,
    start() { if (!timer) { timer = setInterval(tick, sampleEverySeconds * 1000); tick(); } },
    stop() { clearInterval(timer); timer = null; watcher.stop?.(); },
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

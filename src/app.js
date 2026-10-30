// Shared startup for every front end (terminal, background service, pet):
// one store, one model handle, one companion loop.
import { createStore } from './core/store.js';
import { createWatcher } from './core/watcher.js';
import { createBrain, createJudge, createModelFromEnv } from './agent/brain.js';
import { captureScreen } from './core/screenshot.js';
import { createCompanion } from './companion.js';

export async function createApp({ env = process.env, ui, log = console.log }) {
  const store = createStore(env.BD_DATA_DIR || undefined);
  let modelHandle = null;
  try { modelHandle = await createModelFromEnv(env); } catch (e) { log(`model setup failed, using templates: ${e.message}`); }
  // BD_JUDGE: title (default) | screenshot | off. See createJudge in agent/brain.js.
  const judge = createJudge({ modelHandle, mode: (env.BD_JUDGE || 'title').toLowerCase(), log: (t, d) => store.log(t, d) });
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const timing = Object.fromEntries(Object.entries({ unclearMinutes: num(env.BD_UNCLEAR_MINUTES), stuckMinutes: num(env.BD_STUCK_MINUTES), morningHour: num(env.BD_MORNING_HOUR), eveningHour: num(env.BD_EVENING_HOUR) }).filter(([, v]) => v !== undefined));
  const companion = createCompanion({
    store, watcher: createWatcher({ onRestart: (n) => store.log('watcher-restart', { n }) }), ui, judge, captureScreen,
    makeBrain: (callbacks) => createBrain({ modelHandle, ...callbacks }),
    driftOptions: num(env.BD_DRIFT_SECONDS) ? { driftAfterSeconds: num(env.BD_DRIFT_SECONDS) } : {},
    timing,
    sampleEverySeconds: num(env.BD_SAMPLE_SECONDS) || 15,
  });
  return { store, companion, modelHandle, judgeMode: judge.mode, modelLabel: modelHandle ? `${modelHandle.model?.provider}/${modelHandle.model?.id}` : 'templates (no model key)' };
}

// Find a quest by id or by a case-insensitive fragment of its title.
export function findQuest(quests, query) {
  if (!query) return null;
  const q = String(query).toLowerCase();
  return quests.find((x) => x.id === query) || quests.find((x) => x.title.toLowerCase().includes(q)) || null;
}

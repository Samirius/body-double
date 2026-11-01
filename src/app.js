// Shared startup for every front end (terminal, background service, pet):
// one store, one model handle, one companion loop.
import path from 'node:path';
import { createStore } from './core/store.js';
import { createWatcher } from './core/watcher.js';
import { createBrain, createJudge, createModelChain } from './agent/brain.js';
import { captureScreen } from './core/screenshot.js';
import { createDecider } from './agent/decider.js';
import { createCompanion } from './companion.js';

export async function createApp({ env = process.env, ui, log = console.log }) {
  const store = createStore(env.BD_DATA_DIR || undefined, { debounceMs: Number(env.BD_SAVE_MS ?? 2000) });
  // Batched saves must never be lost on exit.
  process.on('exit', () => store.flush());
  // Nudge writers in order (Muse Spark with a Meta key or sign-in, then Llama
  // on this PC). The brain holds this array, so reloadModels() swaps models in
  // place (e.g. right after "Sign in with Meta").
  const dataDir = path.dirname(store.file);
  const modelHandles = [];
  const reloadModels = async () => {
    let next = [];
    try { next = await createModelChain(env, { dataDir }); } catch (e) { log(`model setup failed, using templates: ${e.message}`); }
    modelHandles.splice(0, modelHandles.length, ...next);
    return labelOf();
  };
  const labelOf = () => (modelHandles.length ? modelHandles.map((h) => `${h.model?.provider}/${h.model?.id}`).join(' -> ') : 'templates (no model)');
  await reloadModels();
  const modelHandle = modelHandles[0] || null;
  // BD_JUDGE: local (a decision model on this PC, see agent/decider.js; the
  // default when BD_DECIDER_URL is set) | title | screenshot | off.
  const judgeMode = (env.BD_JUDGE || (env.BD_DECIDER_URL ? 'local' : 'title')).toLowerCase();
  const judge = judgeMode === 'local'
    ? createDecider({ baseUrl: env.BD_DECIDER_URL || 'http://127.0.0.1:18090/v1', modelId: env.BD_DECIDER_MODEL || 'julia-1', threshold: Number(env.BD_DECIDER_THRESHOLD) || 0.75, allowRemote: env.BD_DECIDER_ALLOW_REMOTE === '1', log: (t, d) => store.log(t, d) })
    : createJudge({ modelHandle, mode: judgeMode, log: (t, d) => store.log(t, d) });
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const timing = Object.fromEntries(Object.entries({ unclearMinutes: num(env.BD_UNCLEAR_MINUTES), stuckMinutes: num(env.BD_STUCK_MINUTES), morningHour: num(env.BD_MORNING_HOUR), eveningHour: num(env.BD_EVENING_HOUR) }).filter(([, v]) => v !== undefined));
  const companion = createCompanion({
    store, watcher: createWatcher({ onRestart: (n) => store.log('watcher-restart', { n }) }), ui, judge, captureScreen,
    makeBrain: (callbacks) => createBrain({ modelHandles, ...callbacks }),
    driftOptions: num(env.BD_DRIFT_SECONDS) ? { driftAfterSeconds: num(env.BD_DRIFT_SECONDS) } : {},
    timing,
    sampleEverySeconds: num(env.BD_SAMPLE_SECONDS) || 15,
  });
  return { store, companion, modelHandle, judgeMode: judge.mode, modelLabel: labelOf(), dataDir, reloadModels, modelLabelNow: labelOf };
}

// Find a quest by id or by a case-insensitive fragment of its title.
export function findQuest(quests, query) {
  if (!query) return null;
  const q = String(query).toLowerCase();
  return quests.find((x) => x.id === query) || quests.find((x) => x.title.toLowerCase().includes(q)) || null;
}

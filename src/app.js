// Shared startup for every front end (terminal, background service, pet):
// one store, one model handle, one companion loop.
import { createStore } from './core/store.js';
import { createWatcher } from './core/watcher.js';
import { createBrain, createModelFromEnv } from './agent/brain.js';
import { createCompanion } from './companion.js';

export async function createApp({ env = process.env, ui, log = console.log }) {
  const store = createStore(env.BD_DATA_DIR || undefined);
  let modelHandle = null;
  try { modelHandle = await createModelFromEnv(env); } catch (e) { log(`model setup failed, using templates: ${e.message}`); }
  const companion = createCompanion({
    store, watcher: createWatcher(), ui,
    makeBrain: (callbacks) => createBrain({ modelHandle, ...callbacks }),
    driftOptions: { driftAfterSeconds: Number(env.BD_DRIFT_SECONDS) || 180 },
    sampleEverySeconds: Number(env.BD_SAMPLE_SECONDS) || 15,
  });
  return { store, companion, modelHandle, modelLabel: modelHandle ? `${modelHandle.model?.provider}/${modelHandle.model?.id}` : 'templates (no model key)' };
}

// Find a quest by id or by a case-insensitive fragment of its title.
export function findQuest(quests, query) {
  if (!query) return null;
  const q = String(query).toLowerCase();
  return quests.find((x) => x.id === query) || quests.find((x) => x.title.toLowerCase().includes(q)) || null;
}

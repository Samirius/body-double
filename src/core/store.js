// Durable local state: one JSON file, written atomically (temp file + rename)
// so a crash or power cut never leaves a half-written save.
// Holds quests, game progress, nudge outcomes and a capped event log.
// Never holds screenshots or full window titles.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { newGameState } from './game.js';

const LOG_CAP = 5000;
export const SCHEMA_VERSION = 1;

export function defaultDataDir(env = process.env) {
  return path.join(env.APPDATA || env.HOME || '.', 'body-double');
}

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    quests: [],
    activeQuestId: null,
    game: newGameState(),
    nudges: { sent: 0, returned: 0, returnSeconds: [] },
    paused: false,
    settings: {}, // learned tuning, e.g. driftAfterSeconds
    bookends: {}, // last day the morning/evening messages were sent
    log: [],
  };
}

// debounceMs: 0 writes on every change (tests, terminal); the long-running
// service passes ~2000 so a busy minute is a few writes, not dozens. Call
// flush() before exiting; createApp registers it on process exit.
export function createStore(dir = defaultDataDir(), { debounceMs = 0 } = {}) {
  const file = path.join(dir, 'state.json');
  mkdirSync(dir, { recursive: true });
  let state = existsSync(file) ? { ...emptyState(), ...JSON.parse(readFileSync(file, 'utf8')) } : emptyState();
  let timer = null;
  let writes = 0;

  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, file);
    writes++;
  };
  const schedule = () => {
    if (!debounceMs) return save();
    if (!timer) timer = setTimeout(() => { timer = null; save(); }, debounceMs);
  };

  return {
    file,
    get: () => state,
    update(fn) { state = fn(state) ?? state; schedule(); return state; },
    log(type, data = {}, at = Date.now()) {
      state.log.push({ at, type, ...data });
      if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
      schedule();
    },
    flush() { if (timer) { clearTimeout(timer); timer = null; save(); } },
    writes: () => writes,
    activeQuest: () => state.quests.find((q) => q.id === state.activeQuestId) || null,
  };
}

let seq = 0;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// A quest is a goal with small steps; `boss: true` gives it an HP bar and a
// kill bonus (deadlines). allow/deny are keywords for the classifier.
export function makeQuest({ title, tag = 'General', steps = [], allow = [], deny = [], deadline = null, boss = !!deadline }) {
  return { id: newId('q'), title, tag, allow, deny, deadline, boss, steps: steps.map((text) => ({ id: newId('s'), text, done: false })) };
}

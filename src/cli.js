#!/usr/bin/env node
// Terminal front end: runs the companion with Windows notifications and
// single-letter commands. This is what the day-1 kill test runs on.
//   npm start            run (template nudges until a model key is set)
// Env: BD_PROVIDER=meta|zai|none, META_API_KEY / ZAI_API_KEY, BD_MODEL,
//      BD_DRIFT_SECONDS (default 180), BD_SAMPLE_SECONDS (default 15)
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { createStore, makeQuest } from './core/store.js';
import { createWatcher } from './core/watcher.js';
import { createBrain, createModelFromEnv } from './agent/brain.js';
import { createCompanion } from './companion.js';
import { notify } from './ui/notify.js';
import { killTestReport } from './report.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const store = createStore(env.BD_DATA_DIR || undefined);
const say = (...a) => console.log(new Date().toTimeString().slice(0, 5), ...a);

const ui = {
  async nudge({ message, nextAction }) { say(`NUDGE  ${message}  ->  ${nextAction}`); notify(message, `Next: ${nextAction}`); },
  gameEvents(events) {
    for (const e of events) {
      if (e.type === 'xp') say(`+${e.amount} XP  ${e.skill}`);
      else if (e.type === 'level-up') { say(`LEVEL UP -> ${e.level}`); notify('Level up!', `You reached level ${e.level}`); }
      else if (e.type === 'title') { say(`NEW TITLE: ${e.name}`); notify('New title', e.name); }
      else if (e.type === 'boss-defeated') { say(`BOSS DEFEATED: ${e.quest}`); notify('Boss defeated', e.quest); }
      else if (e.type === 'returned') say(`back on quest after ${e.secondsAfterNudge}s`);
      else say(e.type);
    }
  },
  status({ label, app }) { if (env.BD_VERBOSE) say(`[${label}] ${app}`); },
};

let modelHandle = null;
try { modelHandle = await createModelFromEnv(env); } catch (e) { say(`model setup failed, using templates: ${e.message}`); }
const companion = createCompanion({
  store, watcher: createWatcher(), ui,
  makeBrain: (callbacks) => createBrain({ modelHandle, ...callbacks }),
  driftOptions: { driftAfterSeconds: Number(env.BD_DRIFT_SECONDS) || 180 },
  sampleEverySeconds: Number(env.BD_SAMPLE_SECONDS) || 15,
});

const HELP = `commands:
  add <title> | <step>; <step> | allow: kw, kw | deny: kw | tag: <skill> | deadline: YYYY-MM-DD
  d  done (next step)      s  status        p  pause/resume
  w  last nudge was wrong  m  I drifted and you missed it
  r  kill-test report      h  help          x  exit`;

function parseQuest(line) {
  const [title, stepsPart = '', ...opts] = line.split('|').map((x) => x.trim());
  const o = Object.fromEntries(opts.map((x) => { const i = x.indexOf(':'); return [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()]; }));
  const list = (v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
  return makeQuest({ title, steps: stepsPart.split(';').map((x) => x.trim()).filter(Boolean), allow: list(o.allow), deny: list(o.deny), tag: o.tag || 'General', deadline: o.deadline || null });
}

function printStatus() {
  const s = companion.status();
  const bar = (f, n = 20) => '#'.repeat(Math.round(f * n)).padEnd(n, '.');
  say(`${s.paused ? 'PAUSED  ' : ''}Level ${s.level.level} [${bar(s.level.fraction)}] ${s.level.into}/${s.level.needed} XP   streak ${s.streak.days}d (shields ${s.streak.shields})`);
  if (s.quest) say(`Quest: ${s.quest.title}${s.quest.boss ? `  BOSS HP ${s.quest.boss.hp}/${s.quest.boss.max}` : ''}  ->  next: ${s.quest.next || '(all steps done)'}`);
  else say('No active quest. Add one with: add <title> | step; step | allow: keyword');
  const skills = Object.entries(s.skills).map(([k, v]) => `${k} ${v}`).join(', ');
  if (skills) say(`Skills: ${skills}`);
  if (s.titles.length) say(`Titles: ${s.titles.join(', ')}`);
}

say(`companion running (${modelHandle ? `model ${modelHandle.model?.id}` : 'template nudges, no model key yet'}); data: ${store.file}`);
printStatus();
console.log(HELP);
companion.start();

const rl = createInterface({ input: process.stdin });
rl.on('line', (raw) => {
  const line = raw.trim();
  const [cmd, ...rest] = line.split(' ');
  if (cmd === 'add') { const q = parseQuest(rest.join(' ')); companion.addQuest(q); say(`quest added: ${q.title} (${q.steps.length} steps)`); printStatus(); }
  else if (cmd === 'd') { if (!companion.completeNextStep().length) say('no undone step in the active quest'); printStatus(); }
  else if (cmd === 's') printStatus();
  else if (cmd === 'p') { companion.setPaused(!store.get().paused); say(store.get().paused ? 'paused' : 'resumed'); }
  else if (cmd === 'w') { store.log('feedback', { verdict: 'wrong-nudge' }); say('noted: last nudge was wrong'); }
  else if (cmd === 'm') { store.log('feedback', { verdict: 'missed-drift' }); say('noted: missed drift'); }
  else if (cmd === 'r') console.log(killTestReport(store.get().log));
  else if (cmd === 'h') console.log(HELP);
  else if (cmd === 'x') { companion.stop(); rl.close(); process.exit(0); }
  else if (line) say('unknown command (h for help)');
});

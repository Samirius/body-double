#!/usr/bin/env node
// Background service: runs the companion loop and exposes a small JSON API
// on 127.0.0.1 only, guarded by a random token kept in the data folder.
// Claude (through src/mcp.js) and the pixel pet talk to it; nothing else can.
//   npm run daemon
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createApp, findQuest } from './app.js';
import { makeQuest } from './core/store.js';
import { notify } from './ui/notify.js';
import { killTestReport } from './report.js';
import { importFromFile } from './jarvis.js';
import { buildStats, renderStatsHtml } from './stats.js';
import { ensureDeciderServer, ensureWriterServer } from './core/decider-server.js';
import { startMetaLogin, metaSignedIn, metaSignOut } from './agent/meta-auth.js';
import { fileURLToPath } from 'node:url';

if (existsSync('.env')) process.loadEnvFile('.env');
const env = process.env;
const PORT = Number(env.BD_PORT) || 47821;
// Kev-0.8B by default: a 14 GB PC also runs Llama 3B and everything else.
// Kev-4B (BD_DECIDER=kev-4b) only if the eval shows it earns its 3 GB.
const DEFAULT_DECIDER = 'kev';
const JARVIS_NOW =env.BD_JARVIS_NOW || 'D:\\Samir-Second-Brain\\work\\NOW.generated.md';

// Server-sent events: the pet (or anything local) subscribes to /events.
const listeners = new Set();
// `type` is written last so a payload field can never overwrite the channel.
const broadcast = (type, data) => { const line = `data: ${JSON.stringify({ ...data, type, at: Date.now() })}\n\n`; for (const res of listeners) res.write(line); };

// When a pet (or any live client) is connected it shows nudges itself, so
// Windows pop-ups are only the fallback for when nothing is listening.
const toast = (title, text) => { if (listeners.size === 0) notify(title, text); };
const ui = {
  async nudge({ message, nextAction, kind = 'drift' }) { toast(message, `Next: ${nextAction}`); broadcast('nudge', { message, nextAction, kind }); },
  gameEvents(events) {
    for (const e of events) {
      if (e.type === 'level-up') toast('Level up!', `You reached level ${e.level}`);
      else if (e.type === 'title') toast('New title', e.name);
      else if (e.type === 'boss-defeated') toast('Boss defeated', e.quest);
      broadcast('game', { game: e });
    }
  },
  status(s) { broadcast('status', s); },
};

// Local models: started here so they run whenever the service does.
// BD_DECIDER picks the decision model (kev | kev-4b | julia | off; an explicit
// BD_JUDGE wins). BD_WRITER=off skips Llama; a Meta key still goes first.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverLog = (t, d) => console.log(t, d);
let decider = null, writer = null;
if (!env.BD_JUDGE && (env.BD_DECIDER || DEFAULT_DECIDER) !== 'off') {
  decider = await ensureDeciderServer({ root: ROOT, name: env.BD_DECIDER || DEFAULT_DECIDER, log: serverLog });
  if (decider) Object.assign(env, { BD_JUDGE: 'local', BD_DECIDER_URL: decider.url, BD_DECIDER_MODEL: decider.name });
}
if (!env.BD_LLAMA_URL && env.BD_WRITER !== 'off') {
  writer = await ensureWriterServer({ root: ROOT, log: serverLog });
  if (writer) env.BD_LLAMA_URL = writer.url;
}
process.on('exit', () => { decider?.child?.kill(); writer?.child?.kill(); });

const { store, companion, modelLabel, dataDir, reloadModels, modelLabelNow } = await createApp({ env, ui });
let metaLogin = null; // the sign-in in progress, if any
let metaError = null; // why the current sign-in attempt failed
const token = randomBytes(24).toString('hex');

const routes = {
  'GET /status': () => companion.status(),
  'GET /quests': () => companion.listQuests(),
  'POST /quests': (b) => {
    if (!b.title) throw new Error('title is required');
    const q = makeQuest({ title: b.title, steps: b.steps || [], tag: b.tag || 'General', allow: b.allow || [], deny: b.deny || [], deadline: b.deadline || null, repo: b.repo || null });
    companion.addQuest(q, { activate: b.activate !== false });
    return { added: q.title, id: q.id, active: b.activate !== false };
  },
  // Answers at once; the plan arrives as a nudge event (a model may take a few seconds).
  'POST /quests/plan': () => { companion.planQuest().catch((e) => store.log('plan-error', { error: String(e.message || e).slice(0, 200) })); return { planning: true }; },
  'POST /quests/edit': (b) => {
    const q = findQuest(store.get().quests, b.query);
    if (!q) throw new Error(`no quest matches "${b.query}"`);
    return { quest: q.title, ...companion.editQuest(q.id, b.patch || {}) };
  },
  'POST /quests/remove': (b) => {
    const q = findQuest(store.get().quests, b.query);
    if (!q) throw new Error(`no quest matches "${b.query}"`);
    return { quest: q.title, ...companion.removeQuest(q.id) };
  },
  // Scope guard: "is this new request part of the quest?" (agents call it), and
  // "it's part of it" for the side task last pointed out.
  'GET /settings': () => companion.settings(),
  'GET /rewards': () => companion.rewards(),
  'POST /rewards/equip': (b) => companion.equip(b.item || null),
  'GET /week': () => companion.week(),
  'POST /settings': (b) => companion.updateSettings(b || {}),
  'POST /scope/check': (b) => companion.scopeCheck(String(b.request || '')),
  'POST /scope/allow': () => companion.allowScope(),
  'POST /quests/activate': (b) => {
    const q = findQuest(store.get().quests, b.query);
    if (!q) throw new Error(`no quest matches "${b.query}"`);
    companion.setActiveQuest(q.id);
    return { active: q.title };
  },
  'POST /steps/done': () => ({ events: companion.completeNextStep(), status: companion.status() }),
  'POST /steps/add': (b) => {
    const q = b.query ? findQuest(store.get().quests, b.query) : store.activeQuest();
    if (!q) throw new Error('no matching or active quest');
    companion.addSteps(q.id, b.steps || []);
    return { quest: q.title, added: (b.steps || []).length };
  },
  'POST /pause': (b) => companion.setPaused(!!b.paused, { minutes: Number(b.minutes) || undefined }),
  'POST /feedback': (b) => companion.learnFromFeedback(b.verdict, { keyword: b.keyword }),
  'GET /rules': () => companion.rules(),
  'POST /rules/forget': (b) => companion.forgetRule(b.keyword),
  'GET /report': () => ({ report: killTestReport(store.get().log) }),
  'GET /today': () => companion.dayActivity(),
  'POST /session': (b) => (b.action === 'stop' ? companion.stopSession() : companion.startSession({ minutes: b.minutes })),
  'POST /vault/park': (b) => companion.park({ note: b.note }),
  'GET /vault': () => companion.vault(),
  'POST /vault/remove': (b) => companion.unpark(String(b.id || '')),
  // Answer at once and judge in the background, so the Claude hook never slows a prompt down.
  'POST /activity/chat': (b) => {
    companion.noteChat(String(b.text || '')).catch((e) => store.log('chat-error', { error: String(e.message || e).slice(0, 200) }));
    return { accepted: true };
  },
  // Writes the stats page next to the data and returns the numbers.
  'GET /stats': () => {
    const stats = buildStats(store.get());
    const htmlPath = path.join(path.dirname(store.file), 'stats.html');
    writeFileSync(htmlPath, renderStatsHtml(stats));
    return { htmlPath, totals: stats.totals, perDay: stats.perDay, driftsByHour: stats.driftsByHour, judged: stats.judged };
  },
  // Lets the pet's self-test replay events; only with BD_DEBUG=1.
  'POST /debug/emit': (b) => {
    if (env.BD_DEBUG !== '1') throw new Error('debug routes are off');
    if (b.type === 'nudge') return ui.nudge(b), { emitted: 'nudge' };
    if (b.type === 'game') return ui.gameEvents(b.events || []), { emitted: 'game' };
    if (b.type === 'status') return ui.status(b.status || {}), { emitted: 'status' };
    throw new Error('type must be nudge, game or status');
  },
  // Sign in with Meta: returns the code to enter on Meta's page; when the user
  // finishes, Muse Spark joins the model chain without a restart.
  'POST /meta/login': async () => {
    metaLogin?.abort();
    const flow = new AbortController();
    metaLogin = flow;
    metaError = null;
    const r = await startMetaLogin(dataDir, { signal: flow.signal });
    r.done.then(async () => { store.log('meta-signed-in', { models: await reloadModels() }); }).catch((e) => {
      if (flow.signal.aborted) return; // replaced by a newer attempt or signed out
      metaError = String(e.message || e).slice(0, 200);
      store.log('meta-login-error', { error: metaError });
    });
    return { verificationUri: r.verificationUri, userCode: r.userCode, expiresInSeconds: r.expiresInSeconds };
  },
  'GET /meta/status': () => {
    // Only the current attempt's error counts, so a retry is not stopped by an old one.
    return { signedIn: metaSignedIn(dataDir), models: modelLabelNow(), lastError: metaError };
  },
  'POST /meta/logout': async () => { metaLogin?.abort(); metaSignOut(dataDir); return { signedIn: false, models: await reloadModels() }; },
  'POST /import/jarvis': (b) => {
    const added = importFromFile(b.path || JARVIS_NOW, store.get().quests);
    for (const q of added) companion.addQuest(q, { activate: false });
    return { added: added.map((q) => q.title) };
  },
};

const server = http.createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers['x-bd-token'] !== token) return send(401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return res.write(`data: ${JSON.stringify({ type: 'hello', status: companion.status() })}\n\n`);
  }
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(404, { error: 'not found' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) return send(413, { error: 'too large' }); }
  try { send(200, await handler(raw ? JSON.parse(raw) : {})); } catch (e) { send(400, { error: String(e.message || e) }); }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`another companion already runs on port ${PORT}`); process.exit(3); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  // The token file is how local clients (MCP, pet) find and authenticate.
  writeFileSync(path.join(path.dirname(store.file), 'daemon.json'), JSON.stringify({ port: PORT, pid: process.pid, token, model: modelLabel, startedAt: new Date().toISOString() }));
  store.log('daemon-start', { model: modelLabel });
  companion.start();
  console.log(`companion service on 127.0.0.1:${PORT} (${modelLabel}); data ${store.file}`);
});

const shutdown = () => { companion.stop(); store.flush(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

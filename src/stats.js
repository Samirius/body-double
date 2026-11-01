// Evidence from real use, computed only from the local event log.
// buildStats(state) -> plain numbers; renderStatsHtml(stats) -> one standalone
// HTML page (no external files, light + dark). Framed honestly: one person's
// usage, not a study.
import { dayKey, levelProgress, TITLES } from './core/game.js';
import { killTestReport } from './report.js';

const titleName = Object.fromEntries(TITLES.map((t) => [t.id, t.name]));
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const isDriftNudge = (e) => e.type === 'nudge' && (e.kind || 'drift') === 'drift';

export function buildStats(state) {
  const log = state.log || [];
  const days = new Map();
  const day = (at) => { const k = dayKey(at); if (!days.has(k)) days.set(k, { day: k, steps: 0, xp: 0, driftNudges: 0, returns: [], titles: [], wrong: 0, missed: 0 }); return days.get(k); };
  const byHour = Array(24).fill(0);
  const sources = {}, judged = { 'on-task': 0, 'off-task': 0, unsure: 0 };
  for (const e of log) {
    if (e.type === 'step-done') { const d = day(e.at); d.steps++; d.xp += e.xp || 0; d.titles.push(...(e.titles || [])); }
    else if (isDriftNudge(e)) { day(e.at).driftNudges++; sources[e.source || 'unknown'] = (sources[e.source || 'unknown'] || 0) + 1; }
    else if (e.type === 'drift') byHour[new Date(e.at).getHours()]++;
    else if (e.type === 'returned') day(e.at).returns.push(e.secondsAfterNudge);
    else if (e.type === 'feedback') { const d = day(e.at); if (e.verdict === 'wrong-nudge') d.wrong++; else if (e.verdict === 'missed-drift') d.missed++; }
    else if (e.type === 'judged' && e.verdict in judged) judged[e.verdict]++;
  }
  const perDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, medianReturnSeconds: median(d.returns), returns: d.returns.length }));
  const allReturns = log.filter((e) => e.type === 'returned').map((e) => e.secondsAfterNudge).filter((x) => x != null);
  const totals = {
    daysActive: perDay.filter((d) => d.steps || d.driftNudges).length,
    steps: perDay.reduce((n, d) => n + d.steps, 0),
    xp: state.game?.xp?.total || 0,
    level: levelProgress(state.game?.xp?.total || 0).level,
    titles: (state.game?.titles || []).map((t) => titleName[t] || t),
    bossesDefeated: state.game?.stats?.bossesDefeated || 0,
    streakDays: state.game?.streak?.days || 0,
    driftNudges: perDay.reduce((n, d) => n + d.driftNudges, 0),
    returns: allReturns.length,
    medianReturnSeconds: median(allReturns),
    wrongNudges: perDay.reduce((n, d) => n + d.wrong, 0),
    missedDrifts: perDay.reduce((n, d) => n + d.missed, 0),
    learnedRules: (state.quests || []).reduce((n, q) => n + (q.allow?.length || 0) + (q.deny?.length || 0), 0),
    nudgeAfterSeconds: state.settings?.driftAfterSeconds ?? null,
  };
  return { generatedAt: new Date().toISOString(), totals, perDay, driftsByHour: byHour, nudgeSources: sources, judged, killTest: killTestReport(log) };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const secs = (s) => (s == null ? '–' : s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

// One-series bar chart: drifts by hour of day. Thin bars, 4px rounded tops,
// hairline baseline, native hover titles, and a table view underneath.
function hourChart(byHour) {
  const W = 720, H = 200, padL = 32, padB = 26, padT = 12;
  const max = Math.max(1, ...byHour);
  const slot = (W - padL) / 24, bw = Math.min(18, slot - 4);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const bars = byHour.map((v, h) => {
    const x = padL + h * slot + (slot - bw) / 2, top = y(v), base = H - padB, r = Math.min(4, (base - top) / 2);
    const path = v ? `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z` : '';
    return `<g class="bar"><title>${String(h).padStart(2, '0')}:00 – ${v} drift${v === 1 ? '' : 's'}</title><rect x="${padL + h * slot}" y="${padT}" width="${slot}" height="${H - padT - padB}" fill="transparent"/>${path ? `<path d="${path}"/>` : ''}</g>`;
  }).join('');
  const grid = ticks.map((v) => `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`).join('');
  const labels = [0, 6, 12, 18, 23].map((h) => `<text x="${padL + h * slot + slot / 2}" y="${H - 8}" class="tick" text-anchor="middle">${String(h).padStart(2, '0')}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Drifts by hour of day">${grid}${bars}${labels}</svg>`;
}

export function renderStatsHtml(s) {
  const t = s.totals;
  const tile = (label, value, note = '') => `<div class="tile"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div>${note ? `<div class="n">${esc(note)}</div>` : ''}</div>`;
  const rows = s.perDay.map((d) => `<tr><td>${d.day}</td><td>${d.steps}</td><td>${d.xp}</td><td>${d.driftNudges}</td><td>${d.returns}</td><td>${secs(d.medianReturnSeconds)}</td><td>${d.wrong}</td><td>${d.missed}</td><td>${esc(d.titles.map((x) => titleName[x] || x).join(', '))}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No activity logged yet.</td></tr>';
  const hourRows = s.driftsByHour.map((v, h) => (v ? `<tr><td>${String(h).padStart(2, '0')}:00</td><td>${v}</td></tr>` : '')).join('') || '<tr><td colspan="2" class="muted">No drifts logged.</td></tr>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nudgling stats</title>
<style>
:root{--bg:#fcfcfb;--ink:#1f1f1d;--muted:#6b6a65;--line:#e6e4df;--card:#ffffff;--bar:#2a78d6}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--ink:#ecebe7;--muted:#a3a29c;--line:#34332f;--card:#222220;--bar:#3987e5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "Segoe UI",system-ui,sans-serif;padding:24px 16px}
main{max-width:960px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px}
.muted,.note{color:var(--muted)}.note{font-size:13px;margin:0 0 18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.tile .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.tile .l{color:var(--muted);font-size:12px}.tile .n{color:var(--muted);font-size:11px;margin-top:2px}
.chart{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
svg{width:100%;height:auto;display:block}svg .bar path{fill:var(--bar)}svg .bar:hover path{opacity:.8}svg .grid{stroke:var(--line);stroke-width:1}svg .tick{fill:var(--muted);font-size:11px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);font-size:13px}th{color:var(--muted);font-weight:600}
.wrap{overflow-x:auto}details{margin-top:8px}pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px}
</style></head><body><main>
<h1>Nudgling: what actually happened</h1>
<p class="note">One person's real use (n = 1), from the local event log. Not a study and no claim beyond these numbers. Generated ${esc(s.generatedAt.slice(0, 16).replace('T', ' '))} UTC.</p>
<div class="tiles">
${tile('days active', t.daysActive)}${tile('steps finished', t.steps)}${tile('XP / level', `${t.xp} / ${t.level}`)}${tile('drift nudges', t.driftNudges)}
${tile('turned around', t.driftNudges ? `${t.returns} (${Math.round((t.returns / t.driftNudges) * 100)}%)` : '–', 'returned to the quest after a nudge')}
${tile('median time back', secs(t.medianReturnSeconds))}${tile('wrong nudges', t.wrongNudges)}${tile('missed drifts', t.missedDrifts, 'reported by the user')}
${tile('learned rules', t.learnedRules)}${tile('nudge after', t.nudgeAfterSeconds ? `${t.nudgeAfterSeconds} s` : 'default', 'tuned by feedback')}${tile('streak', `${t.streakDays} d`)}${tile('bosses defeated', t.bossesDefeated)}
</div>
<h2>Drifts by hour of day</h2>
<div class="chart">${hourChart(s.driftsByHour)}</div>
<details><summary class="muted">Table view</summary><div class="wrap"><table><tr><th>Hour</th><th>Drifts</th></tr>${hourRows}</table></div></details>
<h2>Per day</h2>
<div class="wrap"><table><tr><th>Day</th><th>Steps</th><th>XP</th><th>Drift nudges</th><th>Turned around</th><th>Median back</th><th>Wrong</th><th>Missed</th><th>New titles</th></tr>${rows}</table></div>
<h2>How nudges were written and what the judge decided</h2>
<div class="wrap"><table><tr><th>Nudge source</th><th>Count</th></tr>${Object.entries(s.nudgeSources).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">none</td></tr>'}
<tr><th>Judge verdict</th><th>Count</th></tr>${Object.entries(s.judged).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table></div>
<h2>Kill-test view</h2>
<pre>${esc(s.killTest)}</pre>
<p class="note">Titles earned: ${esc(t.titles.join(', ') || 'none yet')}.</p>
</main></body></html>`;
}

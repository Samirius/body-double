// Scope guard: drifting *inside* the work.
//  - uncommitted:  the quest's git repo has piled up changes with no commit
//                  ("started as a bug fix, now 14 files changed")
//  - side task:    same site or app, different job (Elementor page edit ->
//                  WooCommerce orders -> checkout settings)
//  - scope creep:  a new request to an AI agent that is not the quest
//                  ("while you're at it, also add...")
import { execFile } from 'node:child_process';
import { BROWSERS } from './classifier.js';

const run = (args, cwd) => new Promise((resolve) => {
  execFile('git', args, { cwd, timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : String(out)));
});

// { files, lines, lastCommitMinutes } for a repo, or null if it isn't one.
export async function gitScope(repo, now = Date.now()) {
  if (!repo) return null;
  const status = await run(['status', '--porcelain'], repo);
  if (status == null) return null;
  const files = status.split('\n').filter(Boolean).length;
  const stat = (await run(['diff', 'HEAD', '--numstat'], repo)) || '';
  const lines = stat.split('\n').filter(Boolean).reduce((n, row) => { const [a, d] = row.split('\t'); return n + (Number(a) || 0) + (Number(d) || 0); }, 0);
  const last = Number((await run(['log', '-1', '--format=%ct'], repo)) || 0) * 1000;
  return { files, lines, lastCommitMinutes: last ? Math.round((now - last) / 60_000) : null };
}

export const UNCOMMITTED_LIMITS = { files: 8, lines: 300, minutes: 45 };
// Big pile of changes AND a while since the last commit: small fixes never warn.
export function tooMuchUncommitted(g, limits = UNCOMMITTED_LIMITS) {
  if (!g || !g.files) return false;
  const big = g.files >= limits.files || g.lines >= limits.lines;
  const old = g.lastCommitMinutes == null || g.lastCommitMinutes >= limits.minutes;
  return big && old;
}

// "Which job inside this site?": the page part of a title, numbers blanked so
// "Order #1043" and "Order #1044" are one context.
//   "Edit Page “Home” ‹ My Shop — Elementor - Brave" -> "edit page “home”"
//   "Orders ‹ My Shop — WooCommerce - Brave"        -> "orders"
export function pageKey(sample) {
  if (!sample) return null;
  const app = String(sample.app || '').toLowerCase();
  let title = String(sample.title || '').replace(/\s*[-—|]\s*(brave|google chrome|chrome|microsoft edge|mozilla firefox|firefox|opera|vivaldi|arc)\s*$/i, '');
  if (!BROWSERS.includes(app)) title = title.replace(/\s*[-—|]\s*[^-—|]+$/, ''); // drop " - Visual Studio Code" etc.
  const first = title.split(/\s+(?:‹|›|-|—|\||·|:)\s+/)[0] || '';
  const key = first.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 50);
  return key || null;
}

// Words people use when a request grows the job. A hint, not a verdict: the
// local decision model has the last word when it runs.
const CREEP = [/\balso\b/, /\bwhile (we|you)('| a)re at it\b/, /\bwhile we'?re here\b/, /\bby the way\b/, /\bbtw\b/, /\b(new|another|extra) (feature|page|section|option|setting|screen|tool)\b/, /\badd (a|an|some|another) /, /\brefactor\b/, /\bredesign\b/, /\brewrite\b/, /\bmigrate\b/, /\band (then|maybe)\b/, /\bwhat if we\b/, /\bcould (we|you) also\b/];
export function scopeHint(request) {
  const r = String(request || '').toLowerCase();
  const hits = CREEP.filter((re) => re.test(r)).length;
  return hits >= 1 ? 'creep' : 'unknown';
}

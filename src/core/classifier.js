// Rules-first classification of one foreground sample against the current
// quest. Free and instant; the model is only consulted later for 'unclear'.
// Labels: 'on-task' | 'drift' | 'away' | 'unclear'.
// `match` says which rule fired ({ list, keyword }) so feedback can learn.

export const DEFAULT_RULES = {
  awayAfterSeconds: 180,
  // Matched against "<app> <title>" lowercased. Kept short on purpose:
  // anything not listed stays 'unclear' rather than becoming a false nudge.
  distractions: ['youtube', 'netflix', 'twitch', 'tiktok', 'instagram', 'facebook', 'reddit', 'x.com', 'steam', 'epic games', 'shahid', 'anghami'],
  // Messaging: fine in short bursts, drift after an allowance (see companion timing.commAllowanceMinutes).
  communication: ['whatsapp', 'telegram', 'discord', 'slack', 'signal', 'messenger'],
  // Apps that are neutral plumbing (switching windows, the companion itself).
  neutralApps: ['explorer', 'searchhost', 'shellexperiencehost', 'lockapp', 'body-double', 'electron', 'startmenuexperiencehost', 'applicationframehost'],
};

export const BROWSERS = ['brave', 'chrome', 'msedge', 'firefox', 'opera', 'vivaldi', 'arc', 'browser'];
const BROWSER_SUFFIX = /\s*[-—|]\s*(brave|google chrome|chrome|microsoft edge|mozilla firefox|firefox|opera|vivaldi|arc)\s*$/i;

const norm = (s) => String(s || '').toLowerCase();
const firstMatch = (haystack, needles = []) => needles.find((n) => n && haystack.includes(norm(n))) || null;

export function classify(sample, quest, rules = DEFAULT_RULES) {
  if (!sample) return { label: 'unclear', reason: 'no sample', match: null };
  if (sample.idleSeconds >= rules.awayAfterSeconds) return { label: 'away', reason: `idle ${sample.idleSeconds}s`, match: null };
  const app = norm(sample.app);
  if (rules.neutralApps.includes(app)) return { label: 'unclear', reason: `neutral app ${app}`, match: null, neutral: true };
  const hay = `${app} ${norm(sample.title)}`;
  // Quest-specific lists win over global ones, so "youtube" can be on-task
  // for a quest like "edit the course video".
  const allow = firstMatch(hay, quest?.allow);
  if (allow) return { label: 'on-task', reason: `matches quest keyword "${allow}"`, match: { list: 'allow', keyword: norm(allow) } };
  const questDeny = firstMatch(hay, quest?.deny);
  if (questDeny) return { label: 'drift', reason: `matches quest distraction "${questDeny.trim()}"`, match: { list: 'deny', keyword: norm(questDeny) } };
  // X (Twitter) page titles end in "/ X"; a plain " / x" substring would also
  // match ordinary titles like "Projects / Xero", so only the suffix counts.
  const stripped = norm(String(sample.title || '').replace(BROWSER_SUFFIX, '').trim());
  if (BROWSERS.includes(app) && /\/ x$/.test(stripped)) return { label: 'drift', reason: 'matches distraction "x"', match: { list: 'distractions', keyword: 'x' } };
  const globalDeny = firstMatch(hay, rules.distractions);
  if (globalDeny) return { label: 'drift', reason: `matches distraction "${globalDeny.trim()}"`, match: { list: 'distractions', keyword: norm(globalDeny) } };
  const comm = firstMatch(hay, rules.communication);
  if (comm) return { label: 'unclear', reason: `messaging (${comm})`, match: null, comm: norm(comm) };
  return { label: 'unclear', reason: 'no rule matched', match: null };
}

// A short, learnable key for "where was I?": the site name for browsers
// ("Show HN: ... - Hacker News - Brave" -> "hacker news"), the app otherwise.
export function siteKey(sample) {
  if (!sample) return null;
  const app = norm(sample.app);
  if (!BROWSERS.includes(app)) return app || null;
  const title = String(sample.title || '').replace(BROWSER_SUFFIX, '').trim();
  const parts = title.split(/\s+[-—|·]\s+/).map((p) => p.trim()).filter(Boolean);
  const last = parts.at(-1);
  // Pages without a site suffix ("New Tab", a bare page title) give no
  // reliable key; better to learn nothing than to block a random phrase.
  if (!last || parts.length < 2 || last.length > 40) return null;
  return norm(last);
}

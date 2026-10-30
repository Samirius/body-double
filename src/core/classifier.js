// Rules-first classification of one foreground sample against the current
// quest. Free and instant; the model is only consulted later for 'unclear'.
// Labels: 'on-task' | 'drift' | 'away' | 'unclear'.

export const DEFAULT_RULES = {
  awayAfterSeconds: 180,
  // Matched against "<app> <title>" lowercased. Kept short on purpose:
  // anything not listed stays 'unclear' rather than becoming a false nudge.
  distractions: ['youtube', 'netflix', 'twitch', 'tiktok', 'instagram', 'facebook', 'reddit', ' / x', 'x.com', 'steam', 'epic games', 'shahid', 'anghami'],
  // Apps that are neutral plumbing (switching windows, the companion itself).
  neutralApps: ['explorer', 'searchhost', 'shellexperiencehost', 'lockapp', 'body-double', 'electron'],
};

const norm = (s) => String(s || '').toLowerCase();
const firstMatch = (haystack, needles = []) => needles.find((n) => n && haystack.includes(norm(n))) || null;

export function classify(sample, quest, rules = DEFAULT_RULES) {
  if (!sample) return { label: 'unclear', reason: 'no sample' };
  if (sample.idleSeconds >= rules.awayAfterSeconds) return { label: 'away', reason: `idle ${sample.idleSeconds}s` };
  const app = norm(sample.app);
  if (rules.neutralApps.includes(app)) return { label: 'unclear', reason: `neutral app ${app}` };
  const hay = `${app} ${norm(sample.title)}`;
  // Quest-specific lists win over global ones, so "youtube" can be on-task
  // for a quest like "edit the course video".
  const allow = firstMatch(hay, quest?.allow);
  if (allow) return { label: 'on-task', reason: `matches quest keyword "${allow}"` };
  const deny = firstMatch(hay, quest?.deny) || firstMatch(hay, rules.distractions);
  if (deny) return { label: 'drift', reason: `matches distraction "${deny.trim()}"` };
  return { label: 'unclear', reason: 'no rule matched' };
}

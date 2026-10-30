// Kill-test report from the event log. Thresholds were fixed before the test
// (plan, 2026-10-30): catch >= 4 of 5 real drifts (80%) with <= 1 wrong nudge.
//   caught = nudges not marked wrong; missed = 'm' presses; wrong = 'w' presses.
export const KILL_TEST = { minCatchRate: 0.8, maxWrong: 1, minRealDrifts: 5 };

export function killTestReport(log, { since = 0 } = {}) {
  const entries = log.filter((e) => e.at >= since);
  const nudges = entries.filter((e) => e.type === 'nudge');
  const wrong = entries.filter((e) => e.type === 'feedback' && e.verdict === 'wrong-nudge').length;
  const missed = entries.filter((e) => e.type === 'feedback' && e.verdict === 'missed-drift').length;
  const returned = entries.filter((e) => e.type === 'returned');
  const caught = nudges.length - wrong;
  const real = caught + missed;
  const rate = real ? caught / real : 0;
  const enough = real >= KILL_TEST.minRealDrifts;
  const pass = enough && rate >= KILL_TEST.minCatchRate && wrong <= KILL_TEST.maxWrong;
  const fmt = (t) => new Date(t).toTimeString().slice(0, 5);
  const lines = [
    '--- kill-test report ---',
    `nudges sent: ${nudges.length}  (wrong: ${wrong})   missed drifts reported: ${missed}`,
    `real drifts: ${real}   caught: ${caught}   catch rate: ${Math.round(rate * 100)}%   returns after a nudge: ${returned.length}`,
    `verdict: ${!enough ? `NOT ENOUGH DATA (need ${KILL_TEST.minRealDrifts} real drifts, have ${real})` : pass ? 'PASS' : 'FAIL'}  (needs >= ${KILL_TEST.minCatchRate * 100}% caught and <= ${KILL_TEST.maxWrong} wrong)`,
    '',
    ...entries.filter((e) => ['nudge', 'returned', 'feedback'].includes(e.type)).map((e) =>
      e.type === 'nudge' ? `${fmt(e.at)}  nudge [${e.source}] ${e.message} -> ${e.nextAction}`
      : e.type === 'returned' ? `${fmt(e.at)}  returned after ${e.secondsAfterNudge}s`
      : `${fmt(e.at)}  feedback: ${e.verdict}`),
  ];
  return lines.join('\n');
}

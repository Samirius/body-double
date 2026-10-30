// Turns a stream of classified samples into a few meaningful events.
// Pure: the caller passes timestamps, so tests can replay a whole day.
//   'drift'    continuous drift for >= driftAfterSeconds (once per episode,
//              then again only after the cooldown, with escalation count)
//   'returned' back on task after a nudged drift (with seconds to return)
//   'away' / 'back' idle beyond the away threshold and back again

export const DEFAULT_DRIFT = { driftAfterSeconds: 180, cooldownSeconds: 300 };

export function createDriftTracker(opts = {}) {
  const cfg = { ...DEFAULT_DRIFT, ...opts };
  let current = null; // { label, since }
  let episode = null; // { start, lastNudgeAt, nudges }
  let pendingReturn = null; // { nudgedAt, driftStart }
  let away = false;

  return {
    push({ label, at, reason, match = null }) {
      const events = [];
      if (!current || current.label !== label) current = { label, since: at };

      if (label === 'away' && !away) { away = true; events.push({ type: 'away', at }); }
      if (label !== 'away' && away) { away = false; events.push({ type: 'back', at }); }

      if (label === 'drift') {
        if (!episode) episode = { start: at, lastNudgeAt: null, nudges: 0 };
        const driftedFor = (at - episode.start) / 1000;
        const sinceNudge = episode.lastNudgeAt ? (at - episode.lastNudgeAt) / 1000 : Infinity;
        if (driftedFor >= cfg.driftAfterSeconds && sinceNudge >= cfg.cooldownSeconds) {
          episode.nudges += 1;
          episode.lastNudgeAt = at;
          pendingReturn = { nudgedAt: at, driftStart: episode.start };
          events.push({ type: 'drift', at, driftedSeconds: Math.round(driftedFor), nudgeNumber: episode.nudges, reason, match });
        }
      } else if (label === 'on-task') {
        if (pendingReturn) {
          events.push({ type: 'returned', at, secondsAfterNudge: Math.round((at - pendingReturn.nudgedAt) / 1000), driftSeconds: Math.round((at - pendingReturn.driftStart) / 1000) });
          pendingReturn = null;
        }
        episode = null;
      }
      // 'unclear' and 'away' neither extend nor end a drift episode: a quick
      // alt-tab through Explorer must not reset the clock.
      return events;
    },
    state: () => ({ current, episode, pendingReturn, away }),
  };
}

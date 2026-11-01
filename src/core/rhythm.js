// Work rhythm, from the stream of labelled samples (pure, clock-free):
//  - quiet:      a call, meeting, presentation or screen share was seen in the
//                last 2 minutes -> no nudges, sounds or full-screen effects
//  - flow combo: every 5 uninterrupted on-task minutes is one combo level
//                ("FLOW x3"); drifting or leaving banks it, it never scolds
//  - hyperfocus: 90 minutes at the keyboard without a real break -> one
//                gentle "stand up, drink water" (the ADHD flip side of drift)
// 'unclear' and quiet samples neither build nor break a combo.

export const RHYTHM_DEFAULTS = { flowStepMinutes: 5, hyperfocusMinutes: 90, realBreakMinutes: 5, quietGraceMinutes: 2 };

export function createRhythm(opts = {}) {
  const o = { ...RHYTHM_DEFAULTS, ...opts };
  const STEP = o.flowStepMinutes * 60_000;
  let quietUntil = 0, flowMs = 0, level = 0, activeMs = 0, awaySince = null;

  return {
    // gapMs: time since the previous sample (capped by the caller).
    push({ at, label, quiet = false, gapMs = 0 }) {
      const events = [];
      if (quiet) quietUntil = at + o.quietGraceMinutes * 60_000;

      if (label === 'on-task') {
        flowMs += gapMs;
        const next = Math.floor(flowMs / STEP);
        if (next > level) { level = next; events.push({ type: 'flow', level, minutes: Math.round(flowMs / 60_000) }); }
      } else if (label === 'drift' || label === 'away') {
        if (level > 0) events.push({ type: 'flow-banked', level, minutes: Math.round(flowMs / 60_000) });
        flowMs = 0; level = 0;
      }

      if (label === 'away') {
        awaySince ??= at;
        if (at - awaySince >= o.realBreakMinutes * 60_000) activeMs = 0;
      } else {
        awaySince = null;
        activeMs += gapMs;
        if (activeMs >= o.hyperfocusMinutes * 60_000) { events.push({ type: 'hyperfocus', minutes: Math.round(activeMs / 60_000) }); activeMs = 0; }
      }
      return events;
    },
    isQuiet: (at) => at < quietUntil,
    // A focus-session break counts as a real break.
    rested() { activeMs = 0; },
    flow: () => ({ level, minutes: Math.round(flowMs / 60_000) }),
  };
}

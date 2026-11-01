// The Nudgling's feelings: what it does (emote, robot sound, full-screen
// effect) when something happens. Pure and clock-injected, so it is tested.
//   emote:  pixel icon by its head (see emotes.js)
//   voice:  a wordless robot sound (see voice.js)
//   fx:     a short full-screen effect (see fx.js), only on real escalation:
//           the 3rd nudge in one drift, the 3rd snooze within an hour, big wins.
// It is never mean: the loudest line is "I'M NOT MAD." and every effect is a
// couple of seconds long and click-through.

const HOUR = 3_600_000;

export function createFeelings({ now = Date.now } = {}) {
  let drifts = 0; // nudges since the last return or finished step
  let snoozes = []; // snooze times in the last hour
  let lastEdge = -Infinity;

  const calm = () => { drifts = 0; };
  return {
    nudge(kind = 'drift', { next = '' } = {}) {
      if (kind === 'drift' || kind === 'chat') {
        drifts++;
        if (drifts % 3 === 0) return { emote: 'fire', voice: 'angry', fx: { kind: 'bomb', text: `NUDGE #${drifts}. BOOM.`, sub: next ? `Next: ${next}` : 'Back to the quest.' } };
        return drifts >= 2 ? { emote: 'fire', voice: 'angry' } : { emote: 'alert', voice: 'hm' };
      }
      return {
        stuck: { emote: 'sweat', voice: 'hm' },
        morning: { emote: 'sparkle', voice: 'happy' },
        evening: { emote: 'heart', voice: 'happy' },
        plan: { emote: 'sparkle', voice: 'happy' },
        ask: { emote: 'question', voice: 'hm' },
        'session-start': { emote: 'alert', voice: 'hm' },
        'session-end': { emote: 'sparkle', voice: 'celebrate' },
        'break-end': { emote: 'alert', voice: 'hm' },
        hyperfocus: { emote: 'sweat', voice: 'sigh' },
        scope: { emote: 'alert', voice: 'hm' },
        'side-task': { emote: 'question', voice: 'hm' },
      }[kind] || null;
    },
    // --- the good part: rewarded in the moment -------------------------------
    // Flow combo: a soft chime when it starts and at every half hour (x6).
    flow(level) { return level === 1 || level % 6 === 0 ? { emote: level >= 6 ? 'sparkle' : null, voice: 'chime' } : null; },
    // A whole focus session without a single drift.
    perfect(minutes) { calm(); return { emote: 'heart', voice: 'celebrate', fx: { kind: 'gold', text: 'PERFECT SESSION', sub: `${minutes} minutes, zero drift.` } }; },
    // Back within a minute of a nudge: the comeback you can see.
    returned(seconds = null) { calm(); return { emote: 'heart', voice: 'happy', quick: seconds != null && seconds <= 60 }; },
    done() { calm(); return { emote: 'sparkle', voice: 'happy' }; },
    park() { return { emote: 'sparkle', voice: 'ooh' }; },
    snooze() {
      const t = now();
      snoozes = [...snoozes.filter((x) => t - x < HOUR), t];
      const n = snoozes.length;
      if (n >= 3) return { emote: 'fire', voice: 'angry', fx: { kind: 'rage', text: n === 3 ? 'SNOOZE #3. I\'M NOT MAD.' : `SNOOZE #${n}. OK. A LITTLE MAD.`, sub: 'One tiny step, then snooze all you want.' } };
      return { emote: 'sweat', voice: 'sigh' };
    },
    celebrate(type, label = '') {
      const text = { 'level-up': `LEVEL UP${label ? ` // ${label}` : ''}`, 'boss-defeated': 'BOSS DOWN', 'pet-evolved': 'NUDGLING EVOLVED' }[type];
      return text ? { emote: 'sparkle', voice: 'celebrate', fx: { kind: 'confetti', text, sub: label && type !== 'level-up' ? label : '' } } : null;
    },
    // Walking right up to the edge of the screen: a little "whoaaa", at most once a minute.
    edge() {
      const t = now();
      if (t - lastEdge < 60_000) return null;
      lastEdge = t;
      return { emote: 'alert', voice: 'whoa' };
    },
  };
}

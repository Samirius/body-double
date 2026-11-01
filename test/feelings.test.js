import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeelings } from '../src/pet/feelings.js';

test('feelings: a drift escalates from "hm?" to fire to a bomb on the 3rd nudge, and calms on return', () => {
  const f = createFeelings();
  assert.deepEqual(f.nudge('drift'), { emote: 'alert', voice: 'hm' });
  assert.deepEqual(f.nudge('drift'), { emote: 'fire', voice: 'angry' });
  const third = f.nudge('drift', { next: 'Upload storefront photo' });
  assert.equal(third.fx.kind, 'bomb');
  assert.match(third.fx.sub, /Upload storefront photo/);
  f.returned();
  assert.deepEqual(f.nudge('drift'), { emote: 'alert', voice: 'hm' }, 'a new drift starts gentle again');
  f.done();
  assert.equal(f.nudge('drift').fx, undefined);
});

test('feelings: the 3rd snooze within an hour gets the full-screen "I\'m not mad", older ones expire', () => {
  let t = 0;
  const f = createFeelings({ now: () => t });
  assert.equal(f.snooze().voice, 'sigh');
  t += 10 * 60_000; assert.equal(f.snooze().fx, undefined);
  t += 10 * 60_000; assert.match(f.snooze().fx.text, /NOT MAD/);
  t += 2 * 3_600_000; assert.equal(f.snooze().fx, undefined, 'an hour later the count starts over');
});

test('feelings: big wins get confetti, the edge "whoa" has a cooldown, quiet kinds stay quiet', () => {
  let t = 0;
  const f = createFeelings({ now: () => t });
  assert.equal(f.celebrate('level-up', '05').fx.kind, 'confetti');
  assert.equal(f.celebrate('xp'), null);
  assert.equal(f.edge().voice, 'whoa');
  assert.equal(f.edge(), null);
  t += 61_000; assert.equal(f.edge().voice, 'whoa');
  assert.equal(f.nudge('returned'), null);
});

test('feelings: the good part is rewarded in the moment: flow chimes, perfect sessions rain gold, quick returns show', () => {
  const f = createFeelings();
  assert.equal(f.flow(1).voice, 'chime');
  assert.equal(f.flow(2), null, 'quiet in between, it is focus time');
  assert.equal(f.flow(6).emote, 'sparkle');
  assert.equal(f.perfect(25).fx.kind, 'gold');
  assert.equal(f.returned(40).quick, true);
  assert.equal(f.returned(200).quick, false);
});

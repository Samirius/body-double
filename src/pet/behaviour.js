// Pet behaviour, pure and testable (no DOM).

// Which pose to show. Priority: celebrate > talk > sleep (away/paused) >
// worry (drifting) > walk > idle.
export function decidePose({ now, cheerUntil = 0, talking = false, label = null, paused = false, moving = false }) {
  if (now < cheerUntil) return 'cheer';
  if (talking) return 'talk';
  if (paused || label === 'away') return 'sleep';
  if (label === 'drift') return 'worry';
  return moving ? 'walk' : 'idle';
}

// Calm wandering along the strip: rest a while, walk to a random spot, rest.
// `random` is injectable so tests are deterministic.
export function createWanderer({ width, sprite, speed = 45, restMin = 6, restMax = 18, random = Math.random, start = null }) {
  let x = start ?? Math.max(0, width() - sprite - 160);
  let target = null, rest = restMin, facing = -1;
  let home = null; // where the user dropped it: it then only strolls nearby
  const margin = 24, ROAM = 180;
  return {
    x: () => x,
    facing: () => facing,
    moving: () => target != null,
    // Dragged by the user: stand here, rest a moment, then stroll around this spot.
    place(nx) { x = nx; target = null; home = nx; rest = restMax; },
    step(dt, { canMove = true } = {}) {
      const maxX = Math.max(margin, width() - sprite - margin);
      x = Math.min(Math.max(x, margin), maxX); // keep inside after resizes
      if (!canMove) { target = null; return; }
      if (target == null) {
        rest -= dt;
        if (rest <= 0) {
          const lo = home == null ? margin : Math.max(margin, home - ROAM), hi = home == null ? maxX : Math.min(maxX, home + ROAM);
          target = lo + random() * (hi - lo);
          rest = restMin + random() * (restMax - restMin);
        }
        return;
      }
      const d = target - x;
      facing = d >= 0 ? 1 : -1;
      const stepPx = speed * dt;
      if (Math.abs(d) <= stepPx) { x = target; target = null; } else x += Math.sign(d) * stepPx;
    },
  };
}

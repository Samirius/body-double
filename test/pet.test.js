import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrame, frameToBitmap, SIZE, paletteFor } from '../src/pet/sprites.js';
import { decidePose, createWanderer } from '../src/pet/behaviour.js';

const count = (frame, key) => frame.pixels.flat().filter((k) => k === key).length;
const STATES = ['idle', 'walk', 'talk', 'cheer', 'sleep', 'worry'];

test('sprites: every state x stage builds a 24x24 frame using only palette colours', () => {
  for (const state of STATES) for (const stage of [1, 2, 3, 4]) for (const t of [0, 0.37, 1.9, 3.95]) {
    const f = buildFrame({ state, stage, t });
    assert.equal(f.pixels.length, SIZE);
    assert.ok(f.pixels.every((r) => r.length === SIZE));
    for (const k of f.pixels.flat()) if (k) assert.ok(f.palette[k], `${state}/${stage}: unknown key ${k}`);
    assert.ok(count(f, 'o') > 30, 'has an outline');
  }
});

test('sprites: faces match the mood', () => {
  assert.ok(count(buildFrame({ state: 'idle', t: 0.1 }), 'w') >= 8, 'idle has open eyes');
  assert.equal(count(buildFrame({ state: 'sleep', stage: 1, t: 0.1 }), 'w'), 0, 'sleep has closed eyes');
  assert.ok(count(buildFrame({ state: 'sleep', t: 0.1 }), 'z') > 0, 'sleep shows Zzz');
  assert.ok(count(buildFrame({ state: 'cheer', stage: 1, t: 0 }), 'y') > 0, 'cheer has sparkles');
  assert.ok(count(buildFrame({ state: 'talk', t: 0 }), 'm') > 0, 'talk opens the mouth');
});

test('sprites: evolution adds antenna, wings, crown and changes colour', () => {
  assert.equal(count(buildFrame({ stage: 1, t: 0.1 }), 'y'), 0);
  assert.ok(count(buildFrame({ stage: 2, t: 0.1 }), 'y') >= 4, 'antenna tip');
  const s3 = buildFrame({ stage: 3, t: 0.1 });
  assert.ok(s3.pixels.some((row) => row[0] === 'o' || row[1] === 'o'), 'wings reach the edge');
  assert.ok(count(buildFrame({ stage: 4, t: 0.1 }), 'y') >= 15, 'crown');
  assert.notEqual(paletteFor(1).b, paletteFor(4).b);
});

test('sprites: facing left mirrors the frame', () => {
  const r = buildFrame({ state: 'walk', t: 0.2, facing: 1 }), l = buildFrame({ state: 'walk', t: 0.2, facing: -1 });
  assert.deepEqual(l.pixels.map((row) => [...row].reverse()), r.pixels);
});

test('sprites: bitmap export (BGRA for the Windows tray)', () => {
  const f = buildFrame({ state: 'idle', stage: 1, t: 0.1 });
  const rgba = frameToBitmap(f, 2), bgra = frameToBitmap(f, 2, { bgra: true });
  assert.equal(rgba.width, 48);
  assert.equal(rgba.data.length, 48 * 48 * 4);
  const i = rgba.data.findIndex((v, idx) => idx % 4 === 3 && v === 255) - 3; // first opaque pixel
  assert.deepEqual([bgra.data[i], bgra.data[i + 2]], [rgba.data[i + 2], rgba.data[i]]);
});

test('behaviour: pose priority cheer > talk > sleep > worry > walk > idle', () => {
  const base = { now: 100 };
  assert.equal(decidePose({ ...base, cheerUntil: 200, talking: true, label: 'drift' }), 'cheer');
  assert.equal(decidePose({ ...base, talking: true, paused: true }), 'talk');
  assert.equal(decidePose({ ...base, paused: true, label: 'drift' }), 'sleep');
  assert.equal(decidePose({ ...base, label: 'away' }), 'sleep');
  assert.equal(decidePose({ ...base, label: 'drift', moving: true }), 'worry');
  assert.equal(decidePose({ ...base, label: 'on-task', moving: true }), 'walk');
  assert.equal(decidePose({ ...base, label: 'on-task' }), 'idle');
});

test('behaviour: wanderer rests, walks to a target, stays inside the strip, stops when told', () => {
  let w = 1000;
  const rnd = [0.5, 0.1, 0.9, 0.3];
  let i = 0;
  const wd = createWanderer({ width: () => w, sprite: 96, restMin: 1, restMax: 2, random: () => rnd[i++ % rnd.length], start: 800 });
  wd.step(0.5); assert.equal(wd.moving(), false);
  wd.step(0.6); assert.equal(wd.moving(), true); // rest over -> target picked: 24 + 0.5 * (880 - 24) = 452
  let k = 0;
  while (wd.moving() && k++ < 1000) wd.step(0.05);
  assert.equal(wd.moving(), false);
  assert.equal(Math.round(wd.x()), 452);
  assert.equal(wd.facing(), -1, 'walked left, faces left');
  assert.ok(wd.x() >= 24 && wd.x() <= w - 96 - 24);
  w = 300; wd.step(0.01); // screen shrank
  assert.ok(wd.x() <= 300 - 96 - 24);
  wd.step(5); wd.step(0.1, { canMove: false });
  assert.equal(wd.moving(), false);
});

test('pet: dropped somewhere, it stays and only strolls nearby', () => {
  const wd = createWanderer({ width: () => 1920, sprite: 96, restMin: 0.1, restMax: 0.2, random: () => 0.99, start: 1500 });
  wd.place(300);
  assert.equal(wd.x(), 300);
  for (let i = 0; i < 400; i++) wd.step(0.1);
  assert.ok(wd.x() <= 300 + 180 && wd.x() >= 300 - 180, `strolled to ${wd.x()}`);
});

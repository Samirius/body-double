// Motion scenes for the demo video. Everything is a pure function of t, so the
// render is deterministic. The creature is the app's real sprite, as voxels.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildFrame, SIZE } from '/src/pet/sprites.js';

const sceneName = new URLSearchParams(location.search).get('scene') || 'intro';
const overlay = document.getElementById('overlay');

// --- helpers ----------------------------------------------------------------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const easeOut = (x) => 1 - (1 - x) ** 3;
const backOut = (x) => { const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const lerp = (a, b, x) => a + (b - a) * x;
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
function keys(t, list) { // [[time, value...], ...] with smooth blending
  if (t <= list[0][0]) return list[0].slice(1);
  for (let i = 1; i < list.length; i++) if (t <= list[i][0]) {
    const x = smooth((t - list[i - 1][0]) / (list[i][0] - list[i - 1][0]));
    return list[i].slice(1).map((v, k) => lerp(list[i - 1][k + 1], v, x));
  }
  return list.at(-1).slice(1);
}
function el(html, cls, style = '') { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; d.style.cssText = style; overlay.appendChild(d); return d; }
function textIn(node, t, a, b, { rise = 40, fade = 0.35 } = {}) {
  const i = easeOut(ramp(t, a, a + fade)), o = b == null ? 1 : 1 - ramp(t, b - fade, b);
  node.style.opacity = i * o;
  node.style.transform = `translateY(${(1 - i) * rise}px)`;
}

function makeRenderer({ bloom = 0.7, exposure = 1.1 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1920, 1080, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1920 / 1080, 0.1, 2000);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1920, 1080), bloom, 0.6, 0.72));
  composer.addPass(new OutputPass());
  return { renderer, scene, camera, draw: () => composer.render() };
}

// The real sprite as voxels, assembling from a scatter.
function makeVoxels(scene, { size = 1, seed = 7, stage = 1 } = {}) {
  const cells = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) for (const z of [0, 1]) cells.push({ r, c, z });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size * 0.94, size * 0.94, size * 0.94), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, emissive: 0x222233, emissiveIntensity: 0.5 }), cells.length);
  scene.add(mesh);
  const rand = rng(seed);
  const parts = cells.map((c) => ({ ...c, from: new THREE.Vector3((rand() - 0.5) * 90, (rand() - 0.5) * 60, -30 + rand() * 50), delay: rand() * 0.9, spin: rand() * 6 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  return {
    mesh,
    // progress: 0 = scattered, 1 = assembled
    update(progress, { t = 0, state = 'idle', st = stage, facing = 1, wear = null } = {}) {
      const frame = buildFrame({ state, t, stage: st, facing, wear });
      parts.forEach((v, i) => {
        const k = frame.pixels[v.r][v.c];
        const x = backOut(clamp((progress * 1.9 - v.delay)));
        p.set((v.c - SIZE / 2) * size, (SIZE / 2 - v.r) * size, v.z * -size).lerp(v.from, 1 - clamp(x, -0.2, 1.2));
        e.set((1 - x) * v.spin, (1 - x) * v.spin, 0); q.setFromEuler(e);
        m.compose(p, q, k ? one : new THREE.Vector3(0.0001, 0.0001, 0.0001));
        mesh.setMatrixAt(i, m);
        col.set(k ? frame.palette[k] : '#000000');
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

// Floor of neon lines + stars, shared by intro and outro.
function makeWorld(scene) {
  scene.background = new THREE.Color('#07070d');
  scene.fog = new THREE.Fog('#07070d', 60, 190);
  scene.add(new THREE.AmbientLight('#8a8fbf', 0.9));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(20, 40, 60); scene.add(key);
  const rim = new THREE.PointLight('#ff2bd6', 900, 200); rim.position.set(-40, 10, 20); scene.add(rim);
  const rim2 = new THREE.PointLight('#00f0ff', 900, 200); rim2.position.set(40, -10, 20); scene.add(rim2);
  const grid = new THREE.GridHelper(420, 56, '#2f3468', '#2f3468'); grid.position.y = -22; grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);
  const rand = rng(99), pts = [];
  for (let i = 0; i < 1400; i++) pts.push((rand() - 0.5) * 400, rand() * 160 - 20, -60 - rand() * 120);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#8a8fbf', size: 0.5 })));
  return { grid };
}

function roundRect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

// --- intro: apps that wait; one that speaks first ---------------------------
function intro() {
  const { scene, camera, draw } = makeRenderer({ bloom: 0.28 });
  const world = makeWorld(scene);
  const NAMES = ['Timer', 'To-do', 'Habits', 'Planner', 'Focus', 'Tasks', 'Blocker', 'Journal'];
  const rand = rng(21);
  const apps = NAMES.map((name, i) => {
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240;
    const c = cv.getContext('2d');
    c.fillStyle = '#14162b'; roundRect(c, 0, 0, 320, 240, 18); c.fill();
    c.fillStyle = '#23264a'; c.fillRect(0, 0, 320, 44);
    ['#ff3b5c', '#f5ff3b', '#39ff9a'].forEach((col, k) => { c.fillStyle = col; c.globalAlpha = 0.5; c.beginPath(); c.arc(24 + k * 22, 22, 7, 0, 7); c.fill(); });
    c.globalAlpha = 1;
    c.fillStyle = '#e8ecff'; c.font = '700 40px Bahnschrift, Segoe UI'; c.fillText(name, 26, 108);
    c.fillStyle = '#8a8fbf'; c.font = '600 22px Consolas'; c.fillText('Opened: never', 26, 150);
    c.fillStyle = '#23264a'; for (let k = 0; k < 2; k++) c.fillRect(26, 172 + k * 22, 268 - k * 90, 10);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 15), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false }));
    const col = i % 4, row = Math.floor(i / 4);
    const home = new THREE.Vector3((col - 1.5) * 25 + (rand() - 0.5) * 4, (0.5 - row) * 19 + 8 + (rand() - 0.5) * 3, -6 - rand() * 14);
    scene.add(mesh);
    return { mesh, home, phase: rand() * 7, fall: rand() };
  });
  const vox = makeVoxels(scene, { size: 0.85 });
  const line1 = el('Every focus app <em>waits</em> for you to open it.', 't big', 'top: 860px');
  const line2 = el('An ADHD brain <b>doesn\'t open it.</b>', 't big', 'top: 860px');
  const title = el('NUDGLING', 't title', 'top: 690px');
  const sub = el('The body double that speaks first.', 't sub', 'top: 890px');
  const hey = el('hey.', 'bubble', 'left: 1270px; top: 110px');
  return {
    dur: 13,
    render(t) {
      const [cx, cy, cz] = keys(t, [[0, 0, 4, 72], [6, 0, 2, 60], [8, 0, 6, 52], [13, 0, 8, 58]]);
      camera.position.set(cx + Math.sin(t * 0.35) * 2, cy, cz); camera.lookAt(0, t > 6 ? lerp(2, 6, ramp(t, 6, 8)) : 2, 0);
      for (const a of apps) {
        const leave = easeOut(ramp(t, 5 + a.fall, 6.6 + a.fall));
        a.mesh.position.copy(a.home);
        a.mesh.position.y += Math.sin(t * 0.7 + a.phase) * 0.5 - leave * (40 + a.fall * 40);
        a.mesh.rotation.z = Math.sin(t * 0.4 + a.phase) * 0.02 + leave * (a.fall - 0.5) * 2;
        a.mesh.material.opacity = (1 - ramp(t, 3.4, 5) * 0.55) * (1 - leave) * ramp(t, 0, 0.8);
        a.mesh.visible = a.mesh.material.opacity > 0.01;
      }
      const prog = ramp(t, 6.2, 8.4);
      vox.mesh.visible = prog > 0;
      const blink = t > 8.6 && t < 9.2 ? 'cheer' : 'idle';
      vox.update(prog, { t, state: blink });
      vox.mesh.position.set(0, 13 + Math.sin(t * 2.2) * 0.5, 0);
      vox.mesh.rotation.y = Math.sin(t * 0.8) * 0.3;
      world.grid.position.z = (t * 6) % 7.5;
      textIn(line1, t, 0.6, 3.5);
      textIn(line2, t, 3.6, 6.2);
      hey.style.opacity = ramp(t, 8.5, 8.7) * (1 - ramp(t, 12.6, 13));
      hey.style.transform = `scale(${backOut(ramp(t, 8.5, 8.8))})`;
      textIn(title, t, 9.4, null, { rise: 70 });
      textIn(sub, t, 10.2, null);
      draw();
    },
  };
}

// --- concept: the clip-on desk device (clearly not built yet) ----------------
function concept() {
  const { renderer, scene, camera, draw } = makeRenderer({ bloom: 0.22, exposure: 1.2 });
  scene.background = new THREE.Color('#10111f');
  scene.add(new THREE.AmbientLight('#aab0e0', 1.1));
  const sun = new THREE.DirectionalLight('#ffffff', 2.6); sun.position.set(14, 26, 30); scene.add(sun);
  const pink = new THREE.PointLight('#ff2bd6', 260, 120); pink.position.set(-22, 12, 10); scene.add(pink);
  const cyanL = new THREE.PointLight('#00f0ff', 260, 120); cyanL.position.set(18, -8, 16); scene.add(cyanL);

  // The monitor (units: cm). Its top edge sits at y = 0.
  const wall = new THREE.TextureLoader().load('/video/motion/wallpaper.png'); wall.colorSpace = THREE.SRGBColorSpace; wall.magFilter = THREE.NearestFilter;
  const monitor = new THREE.Mesh(new RoundedBoxGeometry(62, 36, 2.4, 4, 0.6), new THREE.MeshStandardMaterial({ color: '#15161f', roughness: 0.55, metalness: 0.3 }));
  monitor.position.set(-22, -18, 0); scene.add(monitor);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(60, 33.75), new THREE.MeshBasicMaterial({ map: wall, toneMapped: false }));
  panel.position.set(-22, -18, 1.25); scene.add(panel);
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.MeshStandardMaterial({ color: '#10111d', roughness: 0.9 }));
  desk.rotation.x = -Math.PI / 2; desk.position.y = -40; scene.add(desk);

  // 3D-printed look: fine layer lines in the bump map.
  const lines = document.createElement('canvas'); lines.width = 16; lines.height = 256;
  const lc = lines.getContext('2d'); for (let y = 0; y < 256; y += 4) { lc.fillStyle = y % 8 ? '#9a9a9a' : '#5a5a5a'; lc.fillRect(0, y, 16, 4); }
  const layerTex = new THREE.CanvasTexture(lines); layerTex.wrapS = layerTex.wrapT = THREE.RepeatWrapping; layerTex.repeat.set(4, 8);
  const printed = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, bumpMap: layerTex, bumpScale: 0.6 });

  const device = new THREE.Group(); scene.add(device);
  const W = 6.6, H = 9, D = 1.2;
  const front = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.42), printed('#2b2f6b')); front.position.z = 0.6; device.add(front);
  const back = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.42), printed('#20234f')); back.position.z = -0.6; device.add(back);
  // The screen: 160 x 128 like the real ST7735, drawn with the real sprite.
  const scr = document.createElement('canvas'); scr.width = 480; scr.height = 384;
  const sc = scr.getContext('2d');
  const scrTex = new THREE.CanvasTexture(scr); scrTex.colorSpace = THREE.SRGBColorSpace; scrTex.magFilter = THREE.NearestFilter;
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.68), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }));
  screenMesh.position.set(0, 1.9, 0); front.add(screenMesh); screenMesh.position.z = D / 2 + 0.02;
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(5, 4.08), new THREE.MeshBasicMaterial({ color: '#05050a' })); bezel.position.set(0, 1.9, D / 2 + 0.01); front.add(bezel);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 24), new THREE.MeshStandardMaterial({ color: '#00f0ff', emissive: '#00f0ff', emissiveIntensity: 0.6 }));
  btn.rotation.x = Math.PI / 2; btn.position.set(2.3, -3.5, D / 2 + 0.12); front.add(btn);
  // The tap zone in the lower half.
  const zoneCv = document.createElement('canvas'); zoneCv.width = 256; zoneCv.height = 128;
  const zc = zoneCv.getContext('2d'); zc.strokeStyle = '#00f0ff'; zc.lineWidth = 8; zc.lineCap = 'round';
  for (let r = 22; r <= 70; r += 24) { zc.beginPath(); zc.arc(84, 64, r, -0.7, 0.7); zc.stroke(); }
  zc.fillStyle = '#00f0ff'; zc.font = '800 34px Consolas'; zc.fillText('TAP', 172, 76);
  const zone = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(zoneCv), transparent: true, toneMapped: false }));
  zone.position.set(-0.8, -2.7, D / 2 + 0.02); front.add(zone);
  // The clip: hooks over the monitor's top edge from behind.
  const clipShape = new THREE.Shape();
  clipShape.moveTo(-1.6, 0.5); clipShape.lineTo(2.2, 0.5); clipShape.lineTo(2.2, -5); clipShape.lineTo(1.5, -5); clipShape.lineTo(1.5, 0); clipShape.lineTo(-1.2, 0); clipShape.lineTo(-1.2, -0.9); clipShape.lineTo(-1.6, -0.9); clipShape.closePath();
  const clip = new THREE.Mesh(new THREE.ExtrudeGeometry(clipShape, { depth: 3.4, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }), printed('#ff2bd6'));
  clip.rotation.y = Math.PI / 2; clip.position.set(-1.7, -H / 2 - 0.5, 0); device.add(clip);

  // Inside: the three real parts, simplified.
  const pcb = (w, h, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 }));
  const metal = new THREE.MeshStandardMaterial({ color: '#c4c8d4', roughness: 0.3, metalness: 0.9 });
  const esp = new THREE.Group();
  esp.add(pcb(2.8, 5.4, '#15171c'));
  const can = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 0.3), metal); can.position.set(0, 1.4, 0.2); esp.add(can);
  const usb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.35), metal); usb.position.set(0, -2.6, 0.22); esp.add(usb);
  for (let i = 0; i < 15; i++) for (const s of [-1, 1]) { const pin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: '#d9b45a', metalness: 0.8, roughness: 0.3 })); pin.position.set(s * 1.24, -2.4 + i * 0.34, 0.14); esp.add(pin); }
  const rc = new THREE.Group();
  rc.add(pcb(4, 6, '#123a8a'));
  for (let i = 0; i < 4; i++) { const coil = new THREE.Mesh(new THREE.TorusGeometry(1.5 - i * 0.22, 0.03, 8, 4, Math.PI * 2), metal); coil.rotation.z = Math.PI / 4; coil.scale.set(1, 1, 0.4); coil.position.set(0, 0.7, 0.1); rc.add(coil); }
  const lcd = new THREE.Group();
  lcd.add(pcb(5, 4.4, '#7a1420'));
  const lcdGlass = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 3.44), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false })); lcdGlass.position.z = 0.1; lcd.add(lcdGlass);
  const inner = [lcd, esp, rc]; inner.forEach((g) => { g.visible = false; scene.add(g); });

  // RFID cards.
  const makeCard = (word, color) => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 324;
    const c = cv.getContext('2d');
    c.fillStyle = color; roundRect(c, 0, 0, 512, 324, 26); c.fill();
    c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(0, 214, 512, 110);
    c.fillStyle = '#07070d'; c.font = '800 96px Bahnschrift, Segoe UI'; c.fillText(word, 34, 120);
    const f = buildFrame({ state: 'idle', stage: 1 });
    for (let r = 0; r < SIZE; r++) for (let k = 0; k < SIZE; k++) { const p = f.pixels[r][k]; if (p) { c.fillStyle = f.palette[p]; c.fillRect(366 + k * 5, 160 + r * 5, 5, 5); } }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const m = new THREE.Mesh(new RoundedBoxGeometry(8.56, 5.4, 0.1, 2, 0.04), [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: color })).concat([new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }), new THREE.MeshStandardMaterial({ color })]));
    scene.add(m); return m;
  };
  const cardFocus = makeCard('FOCUS', '#00f0ff'), cardDone = makeCard('DONE', '#39ff9a');
  const rings = [0, 1, 2].map(() => { const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: '#00f0ff', transparent: true, toneMapped: false })); scene.add(r); return r; });

  function drawScreen(mode, t) {
    sc.fillStyle = '#07070d'; sc.fillRect(0, 0, 480, 384);
    const state = mode === 'done' ? 'cheer' : 'idle';
    const f = buildFrame({ state, t, stage: 1 });
    const S = 9, ox = 240 - (SIZE * S) / 2, oy = mode === 'idle' ? 70 : 96;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const p = f.pixels[r][c]; if (p) { sc.fillStyle = f.palette[p]; sc.fillRect(ox + c * S, oy + r * S, S, S); } }
    sc.textAlign = 'center';
    if (mode === 'focus') {
      sc.fillStyle = '#00f0ff'; sc.font = '800 62px Consolas';
      const left = Math.max(0, 25 * 60 - Math.floor((t - 9) * 8));
      sc.fillText(`FOCUS ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`, 240, 66);
    } else if (mode === 'done') { sc.fillStyle = '#f5ff3b'; sc.font = '800 66px Consolas'; sc.fillText('+10 XP', 240, 68); }
    else { sc.fillStyle = '#39ff9a'; sc.font = '800 38px Consolas'; sc.fillText('fix the checkout', 240, 346); }
    scrTex.needsUpdate = true;
  }

  const badge = el('CONCEPT RENDER · NOT BUILT YET', 'badge');
  const labels = {
    case: el('3D-printed case, to design', 'label'),
    lcd: el('ST7735 screen', 'label'),
    esp: el('ESP32', 'label'),
    rc: el('RC522 RFID reader', 'label'),
    clip: el('Clips to the monitor', 'label'),
  };
  const check = el(`<h2>Where it stands today</h2>
    <div class="y"><i>✓</i>Firmware written, compiles for ESP32</div>
    <div class="y"><i>✓</i>Card actions run in the app (taps simulated)</div>
    <div class="n"><i>○</i>Reader and screen wired and tested</div>
    <div class="n"><i>○</i>Case designed and printed</div>`, 'check');
  const v = new THREE.Vector3();
  const place = (node, obj, dx, dy, on) => { obj.getWorldPosition ? obj.getWorldPosition(v) : v.copy(obj); v.project(camera); node.style.left = `${(v.x + 1) * 960 + dx}px`; node.style.top = `${(1 - v.y) * 540 + dy}px`; node.style.opacity = on; };
  const bottomY = H / 2 + 0.5; // the device stands on the monitor's top edge

  return {
    dur: 27,
    render(t) {
      badge.style.opacity = ramp(t, 0.2, 0.6);
      // Camera path.
      const [px, py, pz, lx, ly, lz] = keys(t, [
        [0, -22, 4, 62, -10, -2, 0], [3.5, 13, 9, 34, 0, 3, 0], [6, 7, 8, 30, 1, 4, 0], [13, 5, 7, 27, 1, 4, 0],
        [15.5, 24, 13, 25, 0, 5, 3], [21, 19, 11, 27, 0, 5, 3], [23, 0, 6, 40, 0, 4, 0], [27, 0, 6, 42, 0, 4, 0],
      ]);
      camera.position.set(px, py, pz); camera.lookAt(lx, ly, lz);
      camera.updateMatrixWorld();
      // The device drops in and clips on (0.6 - 2.2 s), with a small bounce.
      const drop = ramp(t, 0.6, 2.2), by = bottomY + (1 - easeOut(drop)) * 26 - Math.sin(drop * Math.PI) * 0;
      device.position.set(0, by, 0);
      device.rotation.z = (1 - easeOut(drop)) * 0.4;
      const snap = ramp(t, 2.2, 2.5); device.scale.setScalar(1 + Math.sin(snap * Math.PI) * 0.03);
      place(labels.clip, new THREE.Vector3(5.4, 1, 0), 110, 0, ramp(t, 2.6, 3) * (1 - ramp(t, 5.4, 5.8)));
      // Screen state follows the cards.
      drawScreen(t >= 12.5 ? 'done' : t >= 8.5 ? 'focus' : 'idle', t);
      // Card FOCUS taps at 8.5 s, card DONE at 12.5 s.
      const tap = (card, a, side) => {
        const inn = easeOut(ramp(t, a - 1.5, a - 0.1)), out = smooth(ramp(t, a + 1, a + 2));
        const x = lerp(side * 19, side * 3.6, inn) + out * side * 22;
        card.position.set(x, device.position.y - 3.4 + (1 - inn) * -4, 1.8 + (1 - inn) * 3);
        card.rotation.set(-0.08, side * (1 - inn) * -0.5, side * (1 - inn) * 0.2 + side * -0.06);
        card.visible = inn > 0 && out < 1;
      };
      tap(cardFocus, 8.5, 1); tap(cardDone, 12.5, 1);
      rings.forEach((r, i) => {
        const a = t < 12 ? 8.5 : 12.5, x = ramp(t, a + i * 0.15, a + 1.1 + i * 0.15);
        r.visible = x > 0 && x < 1;
        r.position.set(-0.8, device.position.y - 2.7, 1.5);
        r.scale.setScalar(0.8 + x * 4.5);
        r.material.opacity = 1 - x;
        r.material.color.set(t < 12 ? '#00f0ff' : '#39ff9a');
      });
      // Exploded view, 14.2 - 21 s: parts come out in front of the opened case.
      const ex = smooth(ramp(t, 14.2, 16)) * (1 - smooth(ramp(t, 21, 22.2)));
      front.position.z = 0.6 + ex * 9.5;
      back.position.z = -0.6 - ex * 0.6;
      inner.forEach((g, i) => {
        g.visible = ex > 0.02;
        g.position.set(device.position.x, device.position.y + [1.9, 0, -0.4][i] * ex, lerp(0, [7.4, 4.6, 1.8][i], ex));
        g.rotation.y = 0;
      });
      scene.updateMatrixWorld();
      place(labels.lcd, inner[0], -40, -210, ramp(t, 16, 16.4) * (1 - ramp(t, 20.6, 21)));
      place(labels.esp, inner[1], 40, 240, ramp(t, 16.5, 16.9) * (1 - ramp(t, 20.6, 21)));
      place(labels.rc, inner[2], 260, 200, ramp(t, 17, 17.4) * (1 - ramp(t, 20.6, 21)));
      place(labels.case, front, -270, 250, ramp(t, 17.5, 17.9) * (1 - ramp(t, 20.6, 21)));
      // The honest status list.
      const ch = ramp(t, 22.2, 22.6) * (1 - ramp(t, 26.6, 27));
      check.style.opacity = ch;
      [...check.querySelectorAll('div')].forEach((d, i) => { d.style.opacity = ramp(t, 22.6 + i * 0.45, 22.9 + i * 0.45); });
      draw();
    },
  };
}

// --- outro --------------------------------------------------------------------
function outro() {
  const { scene, camera, draw } = makeRenderer({ bloom: 0.75 });
  const world = makeWorld(scene);
  const vox = makeVoxels(scene, { size: 0.8, seed: 3 });
  const a = el('NUDGLING', 't title', 'top: 560px; font-size: 130px');
  const b = el('Meta Llama 3.2 runs on your PC. Window titles stay on your PC.', 't sub', 'top: 730px; font-size: 40px; color: #e8ecff; text-shadow: none');
  const c = el('github.com/Samirius/body-double', 't url', 'top: 810px');
  const d = el('Windows · MIT · hand the link to any AI agent and it sets itself up', 't mono', 'top: 890px; font-size: 28px');
  return {
    dur: 9,
    render(t) {
      camera.position.set(Math.sin(t * 0.4) * 5, 2, 66); camera.lookAt(0, 3, 0);
      const stages = t < 3 ? 1 : t < 4.2 ? 2 : t < 5.4 ? 3 : 4;
      vox.update(ramp(t, 0, 1.6), { t, state: 'cheer', st: stages });
      vox.mesh.position.set(0, 13 + Math.abs(Math.sin(t * 3)) * 0.8, 0);
      vox.mesh.rotation.y = Math.sin(t * 0.9) * 0.25;
      world.grid.position.z = (t * 6) % 7.5;
      textIn(a, t, 1.4, null, { rise: 60 });
      textIn(b, t, 2.2, null);
      textIn(c, t, 3, null);
      textIn(d, t, 3.8, null);
      draw();
    },
  };
}

// --- wallpaper: a quiet pixel-art dusk; the creature walks on its ground line --
function wallpaper() {
  const cv = document.getElementById('flat'); cv.style.display = 'block'; document.getElementById('gl').style.display = 'none';
  const c = cv.getContext('2d');
  const W = 480, H = 270, GROUND = 258, rand = rng(1234);
  const stops = [[0, [13, 12, 34]], [0.45, [31, 21, 66]], [0.72, [84, 34, 102]], [0.9, [176, 66, 112]], [1, [245, 138, 106]]];
  const sky = (y) => { const k = y / GROUND; let i = 1; while (i < stops.length - 1 && k > stops[i][0]) i++; const [a, ca] = stops[i - 1], [b, cb] = stops[i], x = clamp((k - a) / (b - a)); return ca.map((v, n) => lerp(v, cb[n], x)); };
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const img = c.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const col = sky(y), d = (BAYER[y % 4][x % 4] / 16 - 0.5) * 14, i = (y * W + x) * 4;
    for (let n = 0; n < 3; n++) img.data[i + n] = Math.round(Math.round((col[n] + d) / 8) * 8);
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // Stars, with a few bright ones.
  for (let i = 0; i < 240; i++) { const y = Math.floor(rand() ** 1.6 * 150), x = Math.floor(rand() * W); c.fillStyle = rand() > 0.88 ? '#e8ecff' : '#7d82b8'; c.fillRect(x, y, 1, 1); }
  // Moon with a segmented ring, like the creature's focus timer.
  const mx = 372, my = 66;
  c.fillStyle = '#f7e9c9'; for (let y = -19; y <= 19; y++) for (let x = -19; x <= 19; x++) if (x * x + y * y < 361) c.fillRect(mx + x, my + y, 1, 1);
  c.fillStyle = '#e2cfa8'; for (const [ax, ay, r] of [[-6, -5, 4], [7, 4, 5], [-4, 9, 3]]) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y < r * r) c.fillRect(mx + ax + x, my + ay + y, 1, 1);
  c.fillStyle = '#00f0ff'; for (let a = -Math.PI / 2; a < Math.PI * 1.15; a += 0.052) { if (Math.floor(a * 9.5) % 3 === 2) continue; c.fillRect(Math.round(mx + Math.cos(a) * 28), Math.round(my + Math.sin(a) * 28), 1, 1); }
  // Layers of hills and town.
  const ridge = (base, amp, color, seed, step) => { const r = rng(seed); let h = 0; c.fillStyle = color; for (let x = 0; x < W; x += step) { h = lerp(h, r() * amp, 0.45); const top = Math.round(base - h - Math.sin(x / 41 + seed) * amp * 0.3); c.fillRect(x, top, step, GROUND - top); } };
  ridge(208, 36, '#3a1e5c', 5, 1);
  ridge(226, 22, '#27174a', 9, 1);
  const town = rng(77); let x = 0;
  while (x < W) {
    const w = 8 + Math.floor(town() * 16), h = 12 + Math.floor(town() * 30), top = GROUND - h - 2;
    c.fillStyle = '#150f2e'; c.fillRect(x, top, w, h + 2);
    if (town() > 0.6) c.fillRect(x + (w >> 1), top - 5, 1, 5);
    for (let wy = top + 3; wy < GROUND - 5; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (town() > 0.8) { c.fillStyle = ['#ffd23a', '#00f0ff', '#ff2bd6', '#39ffb0'][Math.floor(town() * 4)]; c.fillRect(wx, wy, 1, 1); }
    x += w + (town() > 0.82 ? 3 + Math.floor(town() * 7) : 0);
  }
  // The ground the creature walks on.
  c.fillStyle = '#0b0a1c'; c.fillRect(0, GROUND, W, H - GROUND);
  c.fillStyle = '#00f0ff'; c.fillRect(0, GROUND, W, 1);
  c.fillStyle = '#1b5d78'; for (let gx = 0; gx < W; gx += 6) c.fillRect(gx, GROUND + 3, 3, 1);
  return { dur: 0, render() {} };
}

const SCENES = { intro, concept, outro, wallpaper };
const s = SCENES[sceneName]();
window.sceneDuration = s.dur;
window.renderAt = async (t) => { s.render(t); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); };
// Give textures a moment to load before the first frame.
setTimeout(() => { window.ready = true; }, 800);

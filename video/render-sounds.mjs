// Electron main: renders the Nudgling's robot sounds (src/pet/voice.js) to
// WAV files, so the video plays exactly what the app plays.
//   electron video/render-sounds.mjs <outDir>
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv.at(-1);

function wav(samples, rate = 48000) {
  const data = Buffer.alloc(samples.length * 2);
  // Louder than in the app (master 0.08 there), so it sits next to the narration.
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s * 6)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, sandbox: false } });
  await win.loadFile(path.join(here, 'render-sounds.html'));
  for (let i = 0; i < 40 && !(await win.webContents.executeJavaScript('!!window.renderSound')); i++) await new Promise((r) => setTimeout(r, 100));
  for (const name of await win.webContents.executeJavaScript('window.soundNames')) {
    writeFileSync(path.join(out, `${name}.wav`), wav(await win.webContents.executeJavaScript(`window.renderSound(${JSON.stringify(name)})`)));
  }
  app.exit(0);
});

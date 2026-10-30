// Electron main: renders every frameNN-NN.html in a folder to a 1280x720 PNG.
import { app, BrowserWindow } from 'electron';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv.at(-1);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 720, show: false, paintWhenInitiallyHidden: true, useContentSize: true });
  for (const f of readdirSync(dir).filter((x) => /^frame.*\.html$/.test(x)).sort()) {
    await win.loadFile(path.join(dir, f));
    await new Promise((r) => setTimeout(r, 250));
    writeFileSync(path.join(dir, f.replace(/\.html$/, '.png')), (await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 720 })).toPNG());
  }
  app.exit(0);
});

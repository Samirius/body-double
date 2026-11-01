// The only bridge between the pet/panel pages and the main process.
// Pages can run allowlisted actions and listen to events; nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bd', {
  act: (name, payload) => ipcRenderer.invoke('bd:act', name, payload),
  onEvent: (fn) => ipcRenderer.on('bd:event', (_e, ev) => fn(ev)),
  onConnection: (fn) => ipcRenderer.on('bd:connection', (_e, s) => fn(s)),
  onRefresh: (fn) => ipcRenderer.on('bd:refresh', () => fn()),
  setInteractive: (on) => ipcRenderer.send('bd:interactive', !!on),
  setTyping: (on) => ipcRenderer.send('bd:typing', !!on),
  // Full-screen effects: the pet asks for one, the fx window plays it and reports done.
  fx: (payload) => ipcRenderer.send('bd:fx', payload),
  onFx: (fn) => ipcRenderer.on('bd:fx', (_e, p) => fn(p)),
  fxDone: () => ipcRenderer.send('bd:fx-done'),
});

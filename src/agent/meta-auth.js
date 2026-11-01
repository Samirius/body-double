// "Sign in with Meta": pi-ai's device-code flow for the Meta Model API
// (Muse Spark). You open Meta's page, enter a short code, and pi mints a
// Model API key from your Meta sign-in; it renews that key by itself.
// The credential is kept in the data folder (meta-auth.json, your Windows
// profile only), never in the repo, and is never logged.
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createModels } from '@earendil-works/pi-ai';

export const metaAuthFile = (dataDir) => path.join(dataDir, 'meta-auth.json');
export const metaSignedIn = (dataDir) => existsSync(metaAuthFile(dataDir));

// Minimal persistent CredentialStore (one JSON file, writes serialized).
export function createFileCredentialStore(file) {
  let chain = Promise.resolve();
  const readAll = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
  const writeAll = (all) => {
    if (!Object.keys(all).length) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 2));
    renameSync(`${file}.tmp`, file);
  };
  const serial = (fn) => { const next = chain.then(fn, fn); chain = next.catch(() => {}); return next; };
  return {
    async read(id) { return readAll()[id]; },
    async list() { return Object.entries(readAll()).map(([providerId, c]) => ({ providerId, type: c.type })); },
    modify(id, fn) {
      return serial(async () => {
        const all = readAll();
        const next = await fn(all[id]);
        if (next !== undefined) { all[id] = next; writeAll(all); }
        return all[id];
      });
    },
    delete(id) { return serial(async () => { const all = readAll(); delete all[id]; writeAll(all); }); },
  };
}

// Models with the Meta provider reading the signed-in credential.
export async function createMetaModels(dataDir) {
  const { metaProvider } = await import('@earendil-works/pi-ai/providers/meta');
  const models = createModels({ credentials: createFileCredentialStore(metaAuthFile(dataDir)) });
  models.setProvider(metaProvider());
  return models;
}

// Starts the sign-in. Resolves as soon as Meta hands out the code to show
// ({ verificationUri, userCode }); `done` settles when the user finishes.
export async function startMetaLogin(dataDir, { signal } = {}) {
  const models = await createMetaModels(dataDir);
  let showCode;
  const code = new Promise((resolve) => { showCode = resolve; });
  const done = models.login('meta', 'oauth', {
    signal,
    prompt: async () => { throw new Error('Meta sign-in asked for typed input; use the code page instead'); },
    notify: (ev) => { if (ev.type === 'device_code') showCode({ verificationUri: ev.verificationUri, userCode: ev.userCode, expiresInSeconds: ev.expiresInSeconds }); },
  }).then(() => ({ signedIn: true }));
  // A flow that fails before showing a code (offline, Meta refuses) rejects here.
  return { ...(await Promise.race([code, done.then(() => ({}))])), done };
}

export const metaSignOut = (dataDir) => rmSync(metaAuthFile(dataDir), { force: true });

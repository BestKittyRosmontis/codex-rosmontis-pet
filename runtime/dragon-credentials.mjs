import fs from 'node:fs';
import path from 'node:path';

// Only explicitly entered pet credentials are available. Never read Codex auth.
export function createCredentialStore(dataDir, safeStorage) {
  const file = path.join(dataDir, 'credentials.encrypted.json');
  const valid = key => typeof key === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(key);
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Credential store unreadable'); }
  };
  const write = entries => {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(entries), { mode: 0o600 });
    fs.renameSync(temp, file);
  };
  const available = () => {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('Windows credential encryption unavailable');
  };
  return {
    async resolve(key) {
      if (!valid(key)) return null;
      const entries = read();
      if (!Object.hasOwn(entries, key)) return null;
      available();
      return { value: safeStorage.decryptString(Buffer.from(entries[key], 'base64')) };
    },
    async set(key, value) {
      if (!valid(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid credential name');
      available();
      const entries = read();
      entries[key] = safeStorage.encryptString(String(value)).toString('base64');
      write(entries);
    },
    async delete(key) {
      if (!valid(key)) return;
      const entries = read();
      delete entries[key];
      write(entries);
    },
    async unset(key) { return this.delete(key); },
  };
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDispatcher } from '../runtime/dragon-dispatcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, manifest.version, 'Package and plugin versions agree');
assert.equal(manifest.name, 'rosmontis-pet');
const jokes = JSON.parse(fs.readFileSync(path.join(root, 'docs/dialogue.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(jokes.length, 48);
assert.equal(new Set(jokes).size, 48);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rosmontis-check-'));
const codexDir = path.join(temporary, 'empty-codex');
fs.mkdirSync(codexDir);
const dispatcher = createDispatcher({ dataDir: path.join(temporary, 'data'), codexDir, monitor: false,
  fetchImpl: async () => { throw new Error('External network disabled during package check'); } });
const hash = data => createHash('sha256').update(data).digest('hex');
try {
  const sprite = fs.readFileSync(path.join(root, 'assets/rosmontis.png'));
  assert.equal(sprite.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  for (const route of ['/dsh-whale/image.png', '/dsh-whale/bubble-img.png?id=bimg_petpet', '/dsh-whale/rua.gif']) {
    const response = await dispatcher.dispatch(route);
    assert.equal(response.status, 200, route);
    assert.equal(hash(response.body), hash(sprite), route);
    assert.match(response.headers['content-type'], /image\/png/);
  }
  const roles = JSON.parse((await dispatcher.dispatch('/dsh-whale/roles.json')).body);
  assert.equal(roles.roles.find(role => role.id === 'default').name, '迷迭香');
  const widget = (await dispatcher.dispatch('/dsh-whale/widget.js')).body.toString('utf8');
  for (const joke of jokes) assert.ok(widget.includes(joke), 'Each documented joke is in the runtime widget');
  for (const relative of ['Install.cmd', 'Uninstall.cmd', 'Start.cmd', 'Stop.cmd', '.mcp.json', 'LICENSE',
    'vendor/smol-toml/LICENSE', 'docs/upstream/PROVENANCE.md']) assert.ok(fs.existsSync(path.join(root, relative)), relative);
  console.log(JSON.stringify({ ok: true, version: manifest.version, imageRoutes: 3, dialogueCount: jokes.length, role: '迷迭香' }));
} finally {
  await dispatcher.close();
  const resolved = fs.realpathSync(temporary);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(resolved).startsWith('codex-rosmontis-check-')) {
    throw new Error('Unexpected check directory; cleanup refused.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

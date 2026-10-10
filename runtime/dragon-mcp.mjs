import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { bridgeRequest } from './bridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(os.homedir(), '.codex', 'rosmontis-pet');
const tools = [
  ['dragon_status', 'Read Rosmontis pet status.'],
  ['dragon_balance', 'Read the station balance snapshot. Not actual per-turn cost. No credentials are returned.'],
  ['dragon_usage', 'Read local token history and configured-price estimates, not station charges.'],
  ['dragon_open', 'Show the installed Rosmontis pet next to Codex.'],
].map(([name, description]) => ({ name, description, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: name !== 'dragon_open', destructiveHint: false, openWorldHint: name === 'dragon_balance' } }));
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
function readPreference(file) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; }
}
async function launchSupervisor() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const powershell = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'Start-Dragon.ps1')],
      { env, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Desktop launcher failed')));
  });
}
let startupTask;
async function ensurePetStartup() {
  if (!startupTask) startupTask = (async () => {
    const config = readPreference('follow-config.json');
    const pause = readPreference('pause-until-host-exit.json');
    const follow = readPreference('follow-state.json').state || {};
    if (config.enabled === false || pause.pauseAll === true ||
        (follow.hostAlive && String(pause.hostPid) === String(follow.hostPid))) return;
    try {
      const status = await bridgeRequest('/api/status', { dataDir, timeoutMs: 1200 });
      if (status.ok && fs.existsSync(path.join(dataDir, 'supervisor-state.json'))) return;
    } catch {}
    await launchSupervisor();
  })().catch(() => { process.stderr.write('Rosmontis desktop autostart unavailable.\n'); });
  await startupTask;
}

async function openPet() {
  try { return await bridgeRequest('/api/show', { dataDir, method: 'POST', timeoutMs: 2000 }); } catch {}
  await launchSupervisor();
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try { return await bridgeRequest('/api/show', { dataDir, method: 'POST', timeoutMs: 1000 }); } catch {}
  }
  return { ok: false, error: 'Pet is waiting for the Codex window. Open Codex and try again.' };
}
export async function dispatch(message) {
  const { id, method, params = {} } = message;
  if (id === undefined) return null;
  try {
    let result;
    if (method === 'initialize') {
      await ensurePetStartup();
      result = { protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'rosmontis-pet', version: '1.0.2' } };
    }
    else if (method === 'ping') result = {};
    else if (method === 'tools/list') result = { tools };
    else if (method === 'resources/list') result = { resources: [] };
    else if (method === 'resources/templates/list') result = { resourceTemplates: [] };
    else if (method === 'tools/call') {
      if (Object.keys(params.arguments || {}).length) throw new Error('No arguments supported');
      const routes = { dragon_status: '/api/status', dragon_balance: '/api/station-usage', dragon_usage: '/dsh-whale/usage-records.json' };
      if (params.name !== 'dragon_open' && !Object.hasOwn(routes, params.name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } };
      const output = params.name === 'dragon_open' ? await openPet() : await bridgeRequest(routes[params.name], { dataDir });
      result = { content: [{ type: 'text', text: JSON.stringify(output) }], isError: output.ok === false };
    } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    return { jsonrpc: '2.0', id, result };
  } catch { return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'Pet unavailable. Keep Codex open and check the Rosmontis plugin installation.' }] } }; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void ensurePetStartup();
  let queue = Promise.resolve();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    if (line.length > 1024 * 1024) return;
    queue = queue.then(async () => {
      try {
        const message = JSON.parse(line);
        if (!message || message.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC');
        const reply = await dispatch(message);
        if (reply) send(reply);
      } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    });
  });
  input.on('close', () => queue.then(() => process.exit(0)));
}

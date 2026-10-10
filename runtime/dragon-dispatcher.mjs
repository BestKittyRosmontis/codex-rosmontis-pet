import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createDragonPlugin } from '../vendor/dsh-whale-widget/lib/index.js';
import { createCredentialStore } from './dragon-credentials.mjs';
import { createSessionAdapter } from './dragon-sessions.mjs';
import { SessionMonitor } from './session-monitor.mjs';
import { ConfigStore } from './config.mjs';
import { createStationUsage } from './dragon-billing.mjs';
import { createStationAuth } from './dragon-station-auth.mjs';
import { createRequestLogReader, reconcileTurn } from './dragon-turn-billing.mjs';

export const UI_ORIGIN = 'whale://widget';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' };
const UI_FILES = {
  '/widget.html': 'dragon.html', '/dragon.css': 'dragon.css', '/dragon.js': 'dragon.js',
  '/render.js': 'render.js', '/input.js': 'input.js', '/shape.js': 'shape.js', '/alpha-worker.js': 'alpha-worker.js',
};
const json = (status, value) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify(value)) });

export function createDispatcher({ dataDir, codexDir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  monitor = true, safeStorage, credentials, stationCredentials, fetchImpl, onStop = () => {}, onShow = () => {}, statusInfo = () => ({}) } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const registry = path.join(dataDir, '.dshw-api.json');
  if (!fs.existsSync(registry)) fs.writeFileSync(registry, JSON.stringify({
    version: 1, models: [{ id: 'codex', provider: 'codex', name: 'Codex', keyRef: '', currency: 'CNY' }], usage: {},
  }));
  const routes = new Map(), effects = [], events = new EventEmitter(), trusted = Symbol('internal-request');
  const ctx = {
    credentials: credentials || createCredentialStore(dataDir, safeStorage),
    connection: { requestRejection: req => req[trusted] ? null : 403 },
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); }, tapIndex: () => () => {} },
    effect(fn) { effects.push(fn()); },
    on(name, handler) { events.on(name, handler); return () => events.off(name, handler); },
    get(name) { return this[name] || null; },
    inject(_names, fn) { fn(this); },
  };
  createDragonPlugin({ dataDir, codexDir, fetchImpl }).apply(ctx);
  const adapter = createSessionAdapter(codexDir, (...args) => events.emit(...args), () => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, '.dshw-size.json'), 'utf8')).codexStatsOn !== false; }
    catch (error) { return error.code === 'ENOENT'; }
  });
  const watcher = monitor ? new SessionMonitor(adapter) : null;
  const stationUsage = createStationUsage({ config: new ConfigStore({ dataDir, codexHome: codexDir }), fetchImpl });
  // Billing sessions must not be selectable as model-provider API credentials.
  const stationAuth = createStationAuth({
    credentials: stationCredentials || createCredentialStore(path.join(dataDir, 'station-auth'), safeStorage), fetchImpl,
  });
  const billing = async (force = false) => {
    // Never combine a key account's charges with a different website account's balance.
    const auth = await stationAuth.status();
    if (auth.state === 'connected' || auth.state === 'expired') return { ...await stationAuth.read({ force }), source: 'website' };
    return stationUsage({ force });
  };
  const readRequestLogs = createRequestLogReader({ codexDir });
  let lastBilling = null, history = [], historyAt = 0, historyPending = null, historyTurn = null;
  const turnKey = row => row ? row.sessionId + ':' + row.turnId : '';
  function rememberHistory(value) {
    history = value.codex?.turns || [];
    historyAt = Date.now();
  }
  async function readHistory() {
    const liveKey = turnKey(adapter.lastCompleted);
    const matched = history.find(row => turnKey(row) === liveKey);
    const staleLive = liveKey && (!matched || matched.status === 'running');
    if (historyAt && liveKey === historyTurn && Date.now() - historyAt < (staleLive ? 5000 : 60000)) return history;
    if (!historyPending) {
      historyTurn = liveKey;
      historyPending = run('/dsh-whale/usage-records.json', 'GET', {}, null).then(result => {
        if (result.status === 200) rememberHistory(JSON.parse(result.body.toString('utf8')));
      }).finally(() => { historyPending = null; });
    }
    await historyPending;
    return history;
  }
  watcher?.start();
  let closed = false;
  async function dispatch(route, { method = 'GET', headers = {}, body = null } = {}) {
    let result;
    try {
      result = await run(route, method, headers, body);
      const pathname = new URL(route, UI_ORIGIN).pathname;
      if (method === 'GET' && pathname === '/dsh-whale/usage-records.json' && result.status === 200) {
        const value = JSON.parse(result.body.toString('utf8'));
        rememberHistory(value);
        const [snapshot, logs] = await Promise.all([billing(), readRequestLogs()]);
        for (const turn of value.codex?.turns || []) {
          turn.billing = reconcileTurn(turn, snapshot, logs);
          turn.actualCost = turn.billing.actualCost;
        }
        result = json(200, value);
      }
      if (method === 'GET' && pathname === '/dsh-whale/last-turn.json' && result.status === 200) {
        await readHistory();
        // A completion can arrive during the asynchronous history scan.
        result = await run(route, method, headers, body);
        const value = JSON.parse(result.body.toString('utf8'));
        const live = adapter.lastCompleted;
        let turn = history.find(row => turnKey(row) === turnKey(live) && row.status !== 'running') || live;
        if (value.turn == null) {
          turn = history.filter(row => !row.isSubagent && row.status === 'completed' && row.turnId)
            .sort((a, b) => (b.finishedAt || b.lastAt) - (a.finishedAt || a.lastAt))[0];
          if (turn) Object.assign(value, { turn: turn.turnId, amount: turn.estimatedCost ?? null,
            tokens: turn.usage.total, ts: turn.finishedAt || turn.lastAt, restored: true });
        }
        if (value.turn != null) {
          const refresh = !lastBilling || (lastBilling.turnCost?.state !== 'actual' &&
            Date.now() - (lastBilling.checkedAt || 0) >= 5000) || lastBilling.key !== turnKey(turn);
          const [snapshot, logs] = await Promise.all([billing(refresh), readRequestLogs()]);
          const { receipts, rows, ...account } = snapshot;
          value.billing = { ...account, turnCost: reconcileTurn(turn, snapshot, logs) };
          value.sessionId = turn?.sessionId || null;
          value.turnId = turn?.turnId || null;
          lastBilling = { ...value.billing, key: turnKey(turn) };
          result = json(200, value);
        }
      }
    }
    catch { result = json(400, { ok: false, error: '操作失败，请检查设置或导入文件' }); }
    result.headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, ...result.headers };
    return result;
  }
  async function run(route, method, headers, body) {
    if (closed) return json(503, { ok: false });
    if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[\\\x00-\x1f]/.test(route)) return json(400, { ok: false });
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (h.origin && h.origin !== UI_ORIGIN || h['sec-fetch-site'] === 'cross-site') return json(403, { ok: false });
    if (h.host && h.host !== 'widget') return json(403, { ok: false });
    if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(method)) return json(405, { ok: false });
    const url = new URL(route, UI_ORIGIN);
    const bytes = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    if (bytes.length > 32 * 1024 * 1024) return json(413, { ok: false });
    if (url.pathname === '/api/status' && method === 'GET') return json(200, {
      ok: true, name: 'Rosmontis Pet', sourceVersion: 'DSH 0.3.17', transport: 'local-ipc',
      monitor: watcher?.status() || { watching: 0 }, ...statusInfo(),
    });
    if (url.pathname === '/api/show' && method === 'POST') { onShow(); return json(200, { ok: true }); }
    if (url.pathname === '/api/stop' && method === 'POST') { setTimeout(onStop, 100); return json(200, { ok: true }); }
    if (url.pathname === '/api/station-usage' && method === 'GET') return json(200, await billing(url.searchParams.get('refresh') === '1'));
    if (url.pathname === '/api/station-auth' && method === 'GET') return json(200, await stationAuth.status());
    const ui = UI_FILES[url.pathname === '/' ? '/widget.html' : url.pathname];
    if (ui) {
      if (!['GET', 'HEAD'].includes(method)) return json(405, { ok: false });
      return { status: 200, headers: { 'content-type': MIME[path.extname(ui)] }, body: fs.readFileSync(path.join(ROOT, 'desktop', 'ui', ui)) };
    }
    const handler = routes.get(url.pathname);
    if (!handler) return json(404, { ok: false });
    if (/\.(?:js|png|gif|mp3|wav)$/.test(url.pathname) && !['GET', 'HEAD'].includes(method)) return json(405, { ok: false });
    if (/(?:role-pin|role-delete|bubble-img-upload)\.json$/.test(url.pathname) && !['POST', 'PUT'].includes(method)) return json(405, { ok: false });
    const req = Readable.from(bytes.length ? [bytes] : []);
    Object.assign(req, { url: route, method, [trusted]: true,
      headers: { 'content-type': h['content-type'] || 'application/json', host: '127.0.0.1', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin' } });
    return new Promise((resolve, reject) => {
      const chunks = [], responseHeaders = {};
      const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      res.statusCode = 200;
      res.setHeader = (name, value) => { responseHeaders[name.toLowerCase()] = String(value); };
      res.writeHead = (status, values = {}) => { res.statusCode = status; for (const [k, v] of Object.entries(values)) res.setHeader(k, v); return res; };
      res.on('finish', () => resolve({ status: res.statusCode, headers: responseHeaders, body: Buffer.concat(chunks) }));
      req.on('error', reject); res.on('error', reject);
      Promise.resolve(handler(req, res)).catch(reject);
    });
  }
  async function close() {
    if (closed) return;
    closed = true;
    await watcher?.stop();
    for (const dispose of effects.reverse()) if (typeof dispose === 'function') await dispose();
    events.removeAllListeners();
  }
  return { dispatch, close, watcher, adapter, stationAuth,
    whale: { config: { publicInfo: () => ({ name: 'Codex' }), resolve: () => ({ dashboardUrl: '' }) } } };
}

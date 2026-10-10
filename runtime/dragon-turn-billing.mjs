import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN = 'https://ai.phuketcore.com';
const keyOf = row => row.sessionId + ':' + row.turnId;

// The diagnostic format is text; parse only the HTTP response envelope, never
// tool output or conversation content. Only this station's client IDs qualify.
export function parseRequestLog(row) {
  const text = row.feedback_log_body;
  if (typeof text !== 'string' || text.length > 32768 || !UUID.test(row.thread_id || '')) return null;
  const url = text.match(/\bmethod=POST url=(https:\/\/[^\s]+) status=(\d{3})\b/);
  if (!url) return null;
  try {
    const u = new URL(url[1]);
    if (u.origin !== ORIGIN || !['/responses', '/v1/responses'].includes(u.pathname) ||
      u.username || u.password || u.search || u.hash) return null;
  } catch { return null; }
  const turns = [...new Set([...text.matchAll(/\bturn(?:\.id|_id)=([0-9a-f-]{36})\b/gi)].map(m => m[1]))];
  if (turns.length !== 1 || !UUID.test(turns[0])) return null;
  let headers;
  try { headers = JSON.parse(text.match(/\bheaders=(\{.*\})\s+version=/)?.[1]); } catch { return null; }
  const id = headers?.['x-client-request-id'];
  if (!UUID.test(id || '')) return null;
  return { sessionId: row.thread_id, turnId: turns[0], requestId: 'client:' + id,
    at: Number(row.ts) * 1000, status: Number(url[2]) };
}

export function createRequestLogReader({ codexDir, now = Date.now } = {}) {
  let cached = null, pending = null;
  async function load() {
    let db;
    try {
      const { DatabaseSync } = await import('node:sqlite');
      db = new DatabaseSync(path.join(codexDir, 'logs_2.sqlite'), { readOnly: true });
      const first = db.prepare('SELECT MIN(ts) AS ts FROM logs').get();
      const logs = db.prepare(`SELECT ts, thread_id, feedback_log_body FROM logs
        WHERE target = 'codex_http_client::client' ORDER BY id DESC LIMIT 10001`).all();
      const truncated = logs.length > 10000;
      const rows = logs.slice(0, 10000).map(parseRequestLog).filter(Boolean);
      return { ok: true, checkedAt: now(), rows,
        since: truncated ? Math.max(Number(first.ts) * 1000, Number(logs[9999].ts) * 1000) : Number(first.ts) * 1000 };
    } catch { return { ok: false, checkedAt: now(), rows: [], since: Infinity }; }
    finally { db?.close(); }
  }
  return async function read() {
    if (cached && now() - cached.checkedAt < 3000) return cached;
    if (!pending) pending = load().then(value => { cached = value; return value; }).finally(() => { pending = null; });
    return pending;
  };
}

export function reconcileTurn(turn, snapshot, logs) {
  const base = { state: 'unverified', actualCost: null, matchedCost: null, currency: 'USD',
    matchedRequests: 0, requestCount: 0, scope: 'recorded-requests' };
  if (!snapshot?.ok || snapshot.source !== 'website' || !snapshot.receiptsAvailable)
    return { ...base, state: snapshot?.source === 'website' ? 'unavailable' : 'unauthorized' };
  if (!logs?.ok || !turn?.sessionId || !turn?.turnId) return base;
  const members = [turn, ...(turn.billingMembers || [])];
  const keys = new Set(members.map(keyOf));
  const owners = new Map(), requests = new Map();
  for (const row of logs.rows) {
    const owner = keyOf(row);
    if (!owners.has(row.requestId)) owners.set(row.requestId, new Set());
    owners.get(row.requestId).add(owner);
    if (keys.has(owner)) requests.set(row.requestId, row);
  }
  const receipts = new Map(), conflicts = new Set();
  for (const row of snapshot.receipts || snapshot.rows || []) {
    if (!row.requestId) continue;
    if (row.conflict) conflicts.add(row.requestId);
    if (receipts.has(row.requestId) && receipts.get(row.requestId).actualCost !== row.actualCost) conflicts.add(row.requestId);
    receipts.set(row.requestId, row);
  }
  let sum = 0, matched = 0, ambiguous = false;
  for (const id of requests.keys()) {
    if (owners.get(id).size !== 1 || conflicts.has(id)) { ambiguous = true; continue; }
    const cost = receipts.get(id)?.actualCost;
    if (typeof cost === 'number' && Number.isFinite(cost)) { sum += cost; matched++; }
  }
  const requestCount = requests.size;
  const cost = matched ? Math.round(sum * 1e10) / 1e10 : null;
  const complete = members.every(row => !row.partial && row.startedAt >= logs.since &&
    !['running', 'unknown'].includes(row.status || 'unknown')) &&
    (turn.usageUpdates || 0) > 0 && [...requests.values()].filter(row => row.status >= 200 && row.status < 300).length >= turn.usageUpdates &&
    (!turn.childTurns || (turn.billingMembers || []).length === turn.childTurns);
  const state = ambiguous ? 'unverified' : !requestCount ? 'unverified' :
    matched === requestCount && complete ? 'actual' : matched ? 'partial' : 'pending';
  return { ...base, state, actualCost: state === 'actual' ? cost : null, matchedCost: cost,
    matchedRequests: matched, requestCount, complete, includesChildren: members.length > 1 };
}

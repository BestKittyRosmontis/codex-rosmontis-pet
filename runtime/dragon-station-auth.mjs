export const STATION_ORIGIN = 'https://ai.phuketcore.com';
const STORE = 'dragon_station_session';
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\s\x00-\x1f]/.test(value);

async function boundedJson(response) {
  if (!response.ok) {
    const error = new Error('Station request failed');
    error.status = response.status;
    throw error;
  }
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error('Station response too large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (envelope.code !== 0 || !envelope.data || typeof envelope.data !== 'object') throw new Error('Invalid station response');
  return envelope.data;
}

// Website sessions are more privileged than read-only OAuth. Only these
// read endpoints and session refresh are reachable from this service.
export function createStationAuth({ credentials, fetchImpl = globalThis.fetch, now = Date.now }) {
  let revision = 0, state = 'disconnected', loaded = false, saved = null, pending = null, cached = null;
  let receiptCache = new Map();
  async function load() {
    if (loaded) return;
    const start = revision;
    const entry = await credentials.resolve(STORE);
    const value = entry ? JSON.parse(entry.value) : null;
    if (start !== revision) return;
    saved = value && token(value.accessToken) && Number.isSafeInteger(value.userId) ? value : null;
    state = saved ? 'connected' : 'disconnected';
    loaded = true;
  }
  async function request(route, accessToken, refreshToken) {
    if (!['/auth/me', '/auth/refresh'].includes(route) &&
      !/^\/usage\?page=(?:[1-9]|10)&page_size=20$/.test(route)) throw new Error('Unsupported station operation');
    return boundedJson(await fetchImpl(STATION_ORIGIN + '/api/v1' + route, {
      method: refreshToken ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json', ...(refreshToken ? { 'content-type': 'application/json' } : { authorization: 'Bearer ' + accessToken }) },
      ...(refreshToken ? { body: JSON.stringify({ refresh_token: refreshToken }) } : {}),
    }));
  }
  const publicStatus = () => ({ ok: true, state, origin: STATION_ORIGIN, userId: saved?.userId ?? null, readOnlyOAuth: false });
  async function status() {
    try { await load(); return publicStatus(); }
    catch { return { ok: false, state: 'unavailable', origin: STATION_ORIGIN }; }
  }
  async function authorize(input) {
    if (!token(input?.accessToken) || (input.refreshToken && !token(input.refreshToken))) throw new Error('Invalid login session');
    const start = ++revision;
    const me = await request('/auth/me', input.accessToken);
    if (!Number.isSafeInteger(me.id) || me.id <= 0 || start !== revision) throw new Error('Login session changed');
    const value = { accessToken: input.accessToken, refreshToken: input.refreshToken || null, userId: me.id };
    await credentials.set(STORE, JSON.stringify(value));
    saved = value; loaded = true; state = 'connected'; cached = null; receiptCache = new Map();
    return publicStatus();
  }
  async function disconnect() {
    revision++;
    saved = null; loaded = true; state = 'disconnected'; cached = null; receiptCache = new Map();
    await credentials.delete(STORE);
    return publicStatus();
  }
  async function get(route, start) {
    try { return await request(route, saved.accessToken); }
    catch (error) {
      if (error.status !== 401 || !saved?.refreshToken || start !== revision) throw error;
      const fresh = await request('/auth/refresh', null, saved.refreshToken);
      if (!token(fresh.access_token) || (fresh.refresh_token && !token(fresh.refresh_token)) || start !== revision) throw new Error('Invalid refreshed session');
      saved = { ...saved, accessToken: fresh.access_token, refreshToken: fresh.refresh_token || saved.refreshToken };
      await credentials.set(STORE, JSON.stringify(saved));
      return request(route, saved.accessToken);
    }
  }
  async function read({ force = false } = {}) {
    try { await load(); } catch { return { ok: false, error: '本机授权凭据不可读，请重新授权。' }; }
    if (!saved) return { ok: false, error: '尚未登录授权。', state: 'disconnected' };
    if (cached && now() - cached.checkedAt < (force ? 3000 : 60000)) return cached;
    if (pending) { await pending; return read(); }
    const start = revision;
    pending = (async () => {
      try {
        const me = await get('/auth/me', start);
        if (start !== revision || me.id !== saved?.userId) throw new Error('Account changed');
        let rows = [], receiptsAvailable = false;
        const collected = new Map(receiptCache), seen = new Map();
        try {
          for (let page = 1; page <= 10; page++) {
            const usage = await get('/usage?page=' + page + '&page_size=20', start);
            if (start !== revision) throw new Error('Account changed');
            if (!Array.isArray(usage.items)) break;
            const batch = usage.items.slice(0, 20).map(row => ({
              at: typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at)) ? new Date(row.created_at).toISOString() : null,
              actualCost: numeric(row.actual_cost), listCost: numeric(row.total_cost),
              requestId: typeof row.request_id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(row.request_id) ? row.request_id : null,
            }));
            if (page === 1) { rows = batch; receiptsAvailable = true; }
            const overlap = batch.some(row => row.requestId && receiptCache.has(row.requestId));
            for (const row of batch) if (row.requestId) {
              const prior = seen.get(row.requestId);
              if (prior && (prior.conflict || prior.actualCost !== row.actualCost)) row.conflict = true;
              seen.set(row.requestId, row);
              collected.set(row.requestId, row);
            }
            if (overlap || batch.length < 20) break;
          }
        } catch {}
        if (start !== revision) throw new Error('Account changed');
        receiptCache = new Map([...collected].sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, 2000));
        state = 'connected';
        return { ok: true, checkedAt: now(), source: 'website', userId: me.id,
          balance: numeric(me.balance), currency: 'USD', perTurnAvailable: false, receiptsAvailable, rows,
          receipts: [...receiptCache.values()] };
      } catch (error) {
        if (start === revision && error.status === 401) state = 'expired';
        return { ok: false, checkedAt: now(), error: '授权账单暂不可用；登录过期时请重新授权。' };
      }
    })();
    try {
      const result = await pending;
      if (start !== revision) return { ok: false, error: '授权已变更，请刷新。' };
      cached = result; return result;
    } finally { pending = null; }
  }
  return { status, authorize, disconnect, read };
}

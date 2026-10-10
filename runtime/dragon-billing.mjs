const ORIGIN = 'https://ai.phuketcore.com';
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

// Read-only, same-origin access. Neither credentials nor raw responses reach UI.
export function createStationUsage({ config, fetchImpl = globalThis.fetch, now = Date.now }) {
  let cached = null, cacheKey = '', pending = null;
  async function load(c) {
    const day = new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    const url = new URL('/v1/usage', ORIGIN);
    url.search = new URLSearchParams({ start_date: day, end_date: day, days: '7', timezone: 'Asia/Shanghai' });
    try {
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { authorization: 'Bearer ' + c.key, accept: 'application/json' },
      });
      if (!response.ok) throw new Error('unavailable');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) throw new Error('oversize');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data.isValid === false || !data.usage || typeof data.usage !== 'object') throw new Error('invalid');
      return {
        ok: true, checkedAt: now(), day, currency: data.unit === 'USD' ? 'USD' : null,
        todayActualCost: numeric(data.usage.today?.actual_cost),
        totalActualCost: numeric(data.usage.total?.actual_cost),
        todayRequests: numeric(data.usage.today?.requests),
        balance: numeric(data.balance), perTurnAvailable: false,
      };
    } catch {
      return { ok: false, checkedAt: now(), error: '站点汇总暂不可用；本机逐轮统计不受影响。' };
    }
  }
  return async function read({ force = false } = {}) {
    let c;
    try { c = config.resolve(); } catch { return { ok: false, error: '无法读取当前 API 配置。' }; }
    let allowed = false;
    try { allowed = new URL(c.baseUrl).origin === ORIGIN; } catch {}
    if (!allowed || !c.key) return { ok: false, error: '当前配置不是已授权站点，或没有可用 API Key。' };
    // Account changes invalidate both the successful and failed cached result.
    const identity = [c.accountId, c.baseUrl, c.key].join('\0');
    if (cached && cacheKey === identity && now() - cached.checkedAt < (force ? 3000 : 60000)) return cached;
    if (pending) {
      await pending;
      return read();
    }
    pending = load(c);
    try { cached = await pending; cacheKey = identity; return cached; }
    finally { pending = null; }
  };
}

import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const fields = {
  in: 'input_tokens', cached: 'cached_input_tokens', cwrite: 'cache_write_input_tokens',
  out: 'output_tokens', reason: 'reasoning_output_tokens', total: 'total_tokens',
};
const usage = raw => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, count(raw?.[field])]));
const identifier = value => typeof value === 'string' ? value.slice(0, 200) : '';
const emptyUsage = () => Object.fromEntries(Object.keys(fields).map(key => [key, 0]));
const addUsage = (target, delta) => { for (const key of Object.keys(fields)) target[key] += delta[key]; };

// Keep counters only. Copied fork history establishes a baseline, not new usage.
function* historyParser(dayKey) {
  const result = { days: {}, turns: [], rl: null, rlTs: 0, sessionId: '' };
  let model = 'codex', previous = null, metaSeen = false, forked = false, created = 0, skip = 0;
  let turn = '', inheritedTurn = false, firstOwnUsage = true, effort = '';
  let parentThreadId = '', isSubagent = false;
  const countedTurns = new Set(), seenFallback = new Set();
  const turns = new Map();
  function getTurn(id, at) {
    if (!turns.has(id)) turns.set(id, {
      sessionId: result.sessionId, turnId: id, rootTurnId: '', parentThreadId, isSubagent,
      startedAt: at, lastAt: at, finishedAt: null, status: 'unknown', partial: true,
      usage: emptyUsage(), byModel: {}, efforts: [], usageUpdates: 0,
    });
    return turns.get(id);
  }
  function recordUsage(id, at, delta) {
    const row = getTurn(id, at);
    row.lastAt = Math.max(row.lastAt, at);
    row.usageUpdates++;
    addUsage(row.usage, delta);
    if (!Object.hasOwn(row.byModel, model)) row.byModel[model] = emptyUsage();
    addUsage(row.byModel[model], delta);
    if (effort && !row.efforts.includes(effort)) row.efforts.push(effort);
    return row;
  }
  for (let line = yield; line !== undefined; line = yield) {
    if (!line.trim()) continue;
    if (skip > 0) { skip--; continue; }
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const p = record?.payload;
    if (!p) continue;
    if (record.type === 'session_meta') {
      if (metaSeen) continue;
      metaSeen = true;
      result.sessionId = typeof p.id === 'string' ? p.id : '';
      forked = !!p.forked_from_id;
      created = Date.parse(p.timestamp || record.timestamp) || 0;
      parentThreadId = identifier(p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id);
      isSubagent = p.thread_source === 'subagent' || !!p.source?.subagent;
      skip = count(p.subagent_history_start_ordinal);
      if (skip) forked = true;
      continue;
    }
    if (record.type === 'turn_context') {
      if (p.model && !['__proto__', 'constructor', 'prototype'].includes(p.model)) model = String(p.model);
      effort = identifier(p.effort || p.reasoning_effort);
      if (p.turn_id) turn = identifier(p.turn_id);
      const at = Date.parse(record.timestamp) || 0;
      if (turn && !(forked && (at < created || inheritedTurn))) {
        const row = getTurn(turn, at);
        row.rootTurnId = identifier(p.root_turn_id) || row.rootTurnId;
      }
      continue;
    }
    if (record.type !== 'event_msg') continue;
    if (p.type === 'task_started' || p.type === 'turn_started') {
      const prior = turns.get(turn);
      if (prior?.status === 'running' && turn !== String(p.turn_id || p.id || record.timestamp || '')) prior.status = 'interrupted';
      turn = String(p.turn_id || p.id || record.timestamp || '');
      const rawStart = p.started_at ?? p.turn_start_timestamp;
      const started = typeof rawStart === 'number'
        ? (rawStart < 1e12 ? rawStart * 1000 : rawStart)
        : Date.parse(rawStart || record.timestamp);
      inheritedTurn = forked && started + 1000 < created;
      if (!inheritedTurn) {
        const row = getTurn(turn, started || Date.parse(record.timestamp) || 0);
        row.startedAt = started || row.startedAt;
        if (!row.finishedAt) row.status = 'running';
        if (!row.usageUpdates) row.partial = false;
        row.rootTurnId = identifier(p.root_turn_id) || row.rootTurnId;
      }
      continue;
    }
    if (['task_complete', 'turn_completed', 'task_aborted', 'turn_aborted'].includes(p.type)) {
      const id = identifier(p.turn_id || p.id) || turn;
      const row = turns.get(id);
      if (row && !inheritedTurn) {
        row.finishedAt = Date.parse(record.timestamp) || row.lastAt;
        row.lastAt = Math.max(row.lastAt, row.finishedAt);
        row.status = p.type.endsWith('aborted') || ['aborted', 'cancelled', 'canceled'].includes(p.status) ? 'aborted' :
          ['interrupted', 'incomplete'].includes(p.status) ? 'interrupted' :
          p.error || ['failed', 'error'].includes(p.status) ? 'failed' : 'completed';
      }
      if (id === turn) turn = '';
      continue;
    }
    if (['error', 'stream_error'].includes(p.type)) {
      const row = turns.get(turn);
      if (row && (!p.turn_id || p.turn_id === turn) && (p.fatal === true || p.will_retry === false || p.type === 'error' && p.will_retry !== true)) {
        row.status = 'failed';
        row.finishedAt = Date.parse(record.timestamp) || row.lastAt;
      }
      continue;
    }
    if (p.type !== 'token_count') continue;
    const at = Date.parse(record.timestamp);
    if (!Number.isFinite(at)) continue;
    const raw = p.info?.total_token_usage;
    const next = raw && Number.isSafeInteger(raw.total_tokens) ? usage(raw) : null;
    if (forked && (at < created || inheritedTurn)) { if (next) previous = next; continue; }
    const rl = p.rate_limits;
    if (rl && typeof rl === 'object' && (rl.primary || rl.secondary || rl.credits || rl.plan_type) && at >= result.rlTs) {
      result.rl = rl; result.rlTs = at;
    }
    let delta;
    const hadPrevious = !!previous;
    if (next) {
      const reset = previous && next.total < previous.total;
      if (previous && !reset) {
        delta = Object.fromEntries(Object.keys(fields).map(key => [key, Math.max(0, next[key] - previous[key])]));
      } else if (reset || forked && firstOwnUsage) {
        delta = usage(p.info?.last_token_usage);
      } else delta = next;
      previous = next;
    } else if (p.info?.last_token_usage) {
      const identity = JSON.stringify([record.timestamp, turn, model, p.info.last_token_usage]);
      if (seenFallback.has(identity)) continue;
      seenFallback.add(identity);
      delta = usage(p.info.last_token_usage);
    }
    if (!delta || delta.total <= 0) continue;
    firstOwnUsage = false;
    // A truncated file can begin with an old cumulative balance. Do not charge
    // that inherited balance to its first identifiable turn.
    const last = usage(p.info?.last_token_usage);
    if (!hadPrevious && !forked && next && p.info?.last_token_usage && next.total > last.total) {
      const unassigned = Object.fromEntries(Object.keys(fields).map(key => [key, Math.max(0, delta[key] - last[key])]));
      if (unassigned.total) recordUsage('', at, unassigned);
      if (last.total) recordUsage(turn, at, last).partial = true;
    } else {
      recordUsage(turn, at, delta);
    }
    const day = dayKey(at);
    const models = result.days[day] ||= {};
    const current = models[model] ||= { in: 0, cached: 0, cwrite: 0, out: 0, reason: 0, total: 0, turns: 0 };
    for (const key of Object.keys(fields)) current[key] += delta[key];
    const turnKey = JSON.stringify([day, model, turn || record.timestamp]);
    if (!countedTurns.has(turnKey)) { countedTurns.add(turnKey); current.turns++; }
  }
  result.turns = [...turns.values()].filter(row => row.usage.total > 0);
  return result;
}

export function parseCodexHistory(text, dayKey) {
  const parser = historyParser(dayKey);
  parser.next();
  for (const line of String(text || '').split('\n')) parser.next(line);
  return parser.next().value;
}

export async function parseCodexHistoryFile(file, dayKey, { size, maxLineChars = 2 * 1024 * 1024 } = {}) {
  const parser = historyParser(dayKey);
  parser.next();
  const decoder = new StringDecoder('utf8');
  let pending = '', discarding = false, skippedRecords = 0;
  function discardLine(prefix) {
    // Match only the known envelope, never a type embedded in message text.
    // Compaction snapshots repeat history; accounting uses token_count events.
    const header = /^\s*\{\s*"timestamp"\s*:\s*"[^"]*"\s*,\s*(?:"ordinal"\s*:\s*\d+\s*,\s*)?"type"\s*:\s*"(response_item|compacted|event_msg)"\s*,\s*"payload"\s*:\s*\{\s*/.exec(prefix);
    const ignoredEvent = header?.[1] === 'event_msg' &&
      /^"type"\s*:\s*"(item_completed|user_message|agent_message|agent_reasoning)"\s*[,}]/.test(prefix.slice(header[0].length));
    if (!header || header[1] === 'event_msg' && !ignoredEvent) skippedRecords++;
    parser.next('{}');
    pending = '';
  }
  function chunk(text) {
    let offset = 0;
    while (offset < text.length) {
      const end = text.indexOf('\n', offset);
      const tail = end < 0 ? text.length : end;
      if (!discarding) {
        const part = text.slice(offset, tail);
        if (pending.length + part.length > maxLineChars) {
          discardLine((pending || part).slice(0, 2048));
          discarding = true;
        } else pending += part;
      }
      if (end < 0) return;
      if (!discarding) parser.next(pending);
      pending = ''; discarding = false;
      offset = end + 1;
    }
  }
  if (size === 0) return parser.next().value;
  const stream = fs.createReadStream(file, { highWaterMark: 64 * 1024, ...(size > 0 ? { end: size - 1 } : {}) });
  for await (const buffer of stream) chunk(decoder.write(buffer));
  chunk(decoder.end());
  if (pending && !discarding) parser.next(pending);
  const result = parser.next().value;
  result.skippedRecords = skippedRecords;
  if (skippedRecords) for (const row of result.turns) row.partial = true;
  return result;
}

// Join only explicit root-turn links. Unlinked children remain separate rows.
export function aggregateCodexTurns(records) {
  const rows = records.map(row => ({
    ...row, usage: { ...row.usage },
    byModel: Object.fromEntries(Object.entries(row.byModel).map(([m, v]) => [m, { ...v }])),
    efforts: [...row.efforts], childTurns: 0, billingMembers: [],
  }));
  const roots = new Map();
  for (const row of rows) {
    if (!row.isSubagent && row.turnId) {
      const matches = roots.get(row.turnId) || [];
      matches.push(row);
      roots.set(row.turnId, matches);
    }
  }
  const linked = new Set();
  for (const child of rows) {
    if (!child.isSubagent || !child.rootTurnId) continue;
    const matches = roots.get(child.rootTurnId) || [];
    if (matches.length !== 1) continue;
    const root = matches[0];
    if (child.parentThreadId && child.parentThreadId !== root.sessionId) continue;
    addUsage(root.usage, child.usage);
    for (const [model, value] of Object.entries(child.byModel)) {
      if (!Object.hasOwn(root.byModel, model)) root.byModel[model] = emptyUsage();
      addUsage(root.byModel[model], value);
    }
    root.efforts = [...new Set([...root.efforts, ...child.efforts])];
    root.partial ||= child.partial;
    root.lastAt = Math.max(root.lastAt, child.lastAt);
    root.childTurns++;
    root.billingMembers.push({ sessionId: child.sessionId, turnId: child.turnId,
      startedAt: child.startedAt, status: child.status, partial: child.partial });
    root.usageUpdates += child.usageUpdates;
    if (child.status === 'running') root.status = 'running';
    linked.add(child);
  }
  return rows.filter(row => !linked.has(row)).sort((a, b) => b.startedAt - a.startedAt);
}

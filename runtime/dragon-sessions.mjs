export function createSessionAdapter(codexHome, emit, enabled = () => true) {
  const turns = new Map();
  let serial = 0;
  const send = (meta, type, data = {}) => emit('session/event',
    { id: meta.sessionId, name: 'Codex ' + String(meta.sessionId).slice(0, 8) }, { type, data });
  const adapter = {
    turns,
    lastCompleted: null,
    config: { codexHome, resolve: () => ({ model: '', setting: { monitorSessions: enabled() } }) },
    beginTurn(meta) {
      if (turns.has(meta.id)) return;
      turns.set(meta.id, { ...meta, number: ++serial, seen: new Map() });
      send(meta, 'turn/start');
    },
    updateTurn(meta) {
      if (!turns.has(meta.id)) adapter.beginTurn(meta);
      const turn = turns.get(meta.id);
      for (const [model, counts] of Object.entries(meta.byModel || {})) {
        const previous = turn.seen.get(model) || {};
        const delta = key => Math.max(0, (counts[key] || 0) - (previous[key] || 0));
        const input = delta('input_tokens'), cache = Math.min(input, delta('cached_input_tokens'));
        const output = delta('output_tokens');
        if (input + output > 0) send(meta, 'assistant/message', {
          turn: turn.number,
          usage: { inputTokens: input - cache, cacheReadTokens: cache, outputTokens: output },
          message: { source: { model } },
        });
        turn.seen.set(model, { ...counts });
      }
    },
    async finishTurn(meta) {
      if (meta.historical || meta.statusCorrection) { turns.delete(meta.id); return; }
      adapter.updateTurn(meta);
      const turn = turns.get(meta.id);
      if (meta.notify) {
        adapter.lastCompleted = { sessionId: meta.sessionId, turnId: meta.turnId, startedAt: meta.startedAt,
          finishedAt: meta.ts, status: meta.outcome || 'completed', partial: meta.partial, usageUpdates: meta.usageUpdates || 0 };
        if (!turn.seen.size) send(meta, 'assistant/message', {
          turn: turn.number, usage: {}, message: { source: { model: '' } },
        });
        send(meta, 'turn/end');
      } else {
        // Child/aborted turns must not impersonate the main conversation's completion.
        send(meta, 'turn/end', { notify: false });
      }
      turns.delete(meta.id);
    },
    signal(meta) {
      if (meta.isSubagent) return;
      send(meta, meta.event.type, meta.event.data);
    },
  };
  return adapter;
}

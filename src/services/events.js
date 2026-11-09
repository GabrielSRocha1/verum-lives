// Barramento de eventos: novas integrações se registram sem alterar o núcleo (Open/Closed).
export function createEventBus(logger) {
  const handlers = new Map();
  const inflight = new Set();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    // Dispara em segundo plano; falhas de uma integração não afetam as demais nem a resposta ao visitante.
    emit(type, payload) {
      for (const fn of handlers.get(type) || []) {
        const p = Promise.resolve()
          .then(() => fn(payload))
          .catch((e) => logger.error(`evento ${type} falhou`, { error: e.message }))
          .finally(() => inflight.delete(p));
        inflight.add(p);
      }
    },
    async idle() {
      while (inflight.size) await Promise.allSettled([...inflight]);
    }
  };
}

export function createLogger(silent = false) {
  const log = (level) => (msg, meta) => {
    if (silent) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(meta || {}) });
    (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  };
  return { info: log('info'), warn: log('warn'), error: log('error') };
}

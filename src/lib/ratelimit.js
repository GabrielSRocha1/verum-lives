// Limitador de taxa em memória (janela deslizante). Processo único — ver docs/ARQUITETURA.md.
export function createRateLimiter(clock = Date.now) {
  const buckets = new Map();
  let lastSweep = clock();

  function sweep(now) {
    if (now - lastSweep < 60000) return;
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt <= now && b.hits.length === 0) buckets.delete(k);
  }

  return {
    // Retorna true se permitido.
    hit(key, limit, windowMs) {
      const now = clock();
      sweep(now);
      let b = buckets.get(key);
      if (!b) { b = { hits: [], resetAt: now + windowMs }; buckets.set(key, b); }
      b.hits = b.hits.filter((t) => t > now - windowMs);
      if (b.hits.length >= limit) return false;
      b.hits.push(now);
      b.resetAt = now + windowMs;
      return true;
    },
    reset(key) {
      buckets.delete(key);
    }
  };
}

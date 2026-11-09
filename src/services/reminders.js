// Agendamento e envio de lembretes.
// Cada (ocorrência da live × etapa) é materializada uma única vez em "deliveries" para os inscritos elegíveis:
// consentimento ativo no canal e inscrição feita ANTES do horário daquela etapa. O envio tem retentativas com
// backoff, revalida o consentimento no momento do envio e descarta mensagens vencidas (ex.: aviso de 30 min após o início).
import { upcomingOccurrences } from '../lib/schedule.js';

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

export function createReminderService({ db, settings, subscribers, live, channels, config, clock, logger }) {
  const dcfg = config.dispatcher;
  let running = false;
  let again = false;
  let timer = null;

  db.prepare("UPDATE deliveries SET status = 'pending' WHERE status = 'sending'").run();

  const steps = () => settings.get('reminders').steps;
  const channelList = () => Object.values(channels);

  function enqueueConfirmation(sub) {
    const step = steps().find((s) => s.key === 'confirmation');
    if (!step?.enabled) return 0;
    const now = clock();
    let n = 0;
    const ins = db.prepare(`INSERT OR IGNORE INTO deliveries (subscriber_id, occurrence, step_key, channel, status, attempts, next_attempt_at, expires_at, created_at)
      VALUES (?, 'registration', 'confirmation', ?, 'pending', 0, ?, ?, ?)`);
    for (const ch of channelList()) {
      if (!step.channels[ch.name] || !sub[ch.consentField]) continue;
      n += ins.run(sub.id, ch.name, now, now + 48 * 3600_000, now).changes;
    }
    if (n) kick();
    return n;
  }

  function materialize(now) {
    const s = live.schedule();
    const graceMs = dcfg.graceMinutes * 60_000;
    const timed = steps().filter((st) => st.enabled && st.key !== 'confirmation' && Number.isInteger(st.offsetMinutes));
    if (!timed.length) return 0;
    const maxLead = Math.max(...timed.map((st) => -st.offsetMinutes)) * 60_000;
    const occs = upcomingOccurrences(s, now - graceMs, 40).filter((o) => o <= now + maxLead + graceMs);
    const hasRun = db.prepare('SELECT 1 FROM reminder_runs WHERE occurrence = ? AND step_key = ?');
    const markRun = db.prepare('INSERT OR IGNORE INTO reminder_runs (occurrence, step_key, created_at, queued) VALUES (?, ?, ?, ?)');
    let total = 0;
    for (const occ of occs) {
      const key = new Date(occ).toISOString();
      for (const st of timed) {
        const sendAt = occ + st.offsetMinutes * 60_000;
        if (sendAt > now || sendAt <= now - graceMs) continue;
        if (hasRun.get(key, st.key)) continue;
        const expires = Math.min(sendAt + 2 * 3600_000, occ + 30 * 60_000);
        let queued = 0;
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const ch of channelList()) {
            if (!st.channels[ch.name]) continue;
            queued += db.prepare(`INSERT OR IGNORE INTO deliveries (subscriber_id, occurrence, step_key, channel, status, attempts, next_attempt_at, expires_at, created_at)
              SELECT id, ?, ?, ?, 'pending', 0, ?, ?, ? FROM subscribers
              WHERE deleted_at IS NULL AND ${ch.consentField} = 1 AND created_at <= ?`).run(key, st.key, ch.name, now, expires, now, sendAt).changes;
          }
          markRun.run(key, st.key, now, queued);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        total += queued;
        logger.info('lembretes agendados', { occurrence: key, step: st.key, queued });
      }
    }
    return total;
  }

  async function deliver(row) {
    const now = clock();
    const finish = (status, extra = {}) => db.prepare(
      'UPDATE deliveries SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, provider_message_id = COALESCE(?, provider_message_id), sent_at = ? WHERE id = ?'
    ).run(status, extra.attempts ?? row.attempts, extra.next ?? row.next_attempt_at, extra.error ?? null, extra.messageId ?? null, extra.sentAt ?? null, row.id);

    const sub = subscribers.findById(row.subscriber_id);
    const ch = channels[row.channel];
    const step = steps().find((s) => s.key === row.step_key);
    if (!sub || sub.deleted_at) return finish('skipped', { error: 'inscrito removido' });
    if (!ch) return finish('skipped', { error: 'canal indisponível' });
    if (!sub[ch.consentField]) return finish('skipped', { error: 'sem consentimento no momento do envio' });
    if (!step || !step.enabled || !step.channels[row.channel]) return finish('skipped', { error: 'etapa desativada' });

    const occMs = row.occurrence === 'registration' ? null : Date.parse(row.occurrence);
    const vars = live.vars(sub, occMs);
    try {
      const r = await ch.send({ subscriber: sub, step, vars, unsubscribeUrl: vars.link_descadastro });
      if (r?.skipped) return finish('skipped', { error: r.skipped, attempts: row.attempts + 1 });
      return finish('sent', { attempts: row.attempts + 1, messageId: r?.providerMessageId || null, sentAt: clock() });
    } catch (e) {
      const attempts = row.attempts + 1;
      const retry = e.retryable && attempts < dcfg.maxAttempts;
      logger.warn('falha no envio', { delivery: row.id, channel: row.channel, step: row.step_key, error: e.message, retry });
      return finish('failed', {
        attempts: retry ? attempts : dcfg.maxAttempts,
        next: now + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
        error: String(e.message).slice(0, 500)
      });
    }
  }

  async function processDue(now) {
    db.prepare("UPDATE deliveries SET status = 'skipped', last_error = 'expirado' WHERE status IN ('pending','failed') AND attempts < ? AND expires_at IS NOT NULL AND expires_at < ?")
      .run(dcfg.maxAttempts, now);
    const rows = db.prepare("SELECT * FROM deliveries WHERE status IN ('pending','failed') AND attempts < ? AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT ?")
      .all(dcfg.maxAttempts, now, dcfg.batchSize);
    const claim = db.prepare("UPDATE deliveries SET status = 'sending' WHERE id = ? AND status IN ('pending','failed')");
    const claimed = rows.filter((r) => claim.run(r.id).changes === 1);
    let i = 0;
    const workers = Array.from({ length: Math.min(dcfg.concurrency, claimed.length) }, async () => {
      while (i < claimed.length) await deliver(claimed[i++]);
    });
    await Promise.all(workers);
    return claimed.length;
  }

  async function tick() {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        const now = clock();
        materialize(now);
        const n = await processDue(now);
        if (n >= dcfg.batchSize) again = true;
      } while (again);
    } catch (e) {
      logger.error('dispatcher', { error: e.message });
    } finally {
      running = false;
    }
  }

  function kick() {
    if (!dcfg.enabled) return;
    setImmediate(() => { tick(); });
  }

  function summary() {
    const byStatus = db.prepare('SELECT channel, status, COUNT(*) c FROM deliveries GROUP BY channel, status').all();
    const recentFailures = db.prepare(
      "SELECT id, channel, step_key, occurrence, status, attempts, last_error, created_at FROM deliveries WHERE status IN ('failed','skipped') ORDER BY id DESC LIMIT 20"
    ).all();
    const runs = db.prepare('SELECT occurrence, step_key, created_at, queued FROM reminder_runs ORDER BY created_at DESC LIMIT 20').all();
    return { byStatus, recentFailures, runs };
  }

  // Prévia: próximos envios programados (sem gravar nada).
  function plan(limit = 12) {
    const s = live.schedule();
    const now = clock();
    const out = [];
    for (const occ of upcomingOccurrences(s, now, 4)) {
      for (const st of steps()) {
        if (!st.enabled || st.key === 'confirmation') continue;
        const at = occ + st.offsetMinutes * 60_000;
        if (at > now) out.push({ at, occurrence: occ, step: st.key, label: st.label, channels: Object.keys(st.channels).filter((c) => st.channels[c]) });
      }
    }
    return out.sort((a, b) => a.at - b.at).slice(0, limit);
  }

  return {
    enqueueConfirmation,
    tick,
    kick,
    summary,
    plan,
    start() {
      if (!dcfg.enabled || timer) return;
      timer = setInterval(() => { tick(); }, dcfg.intervalMs);
      timer.unref?.();
      kick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async idle() {
      while (running) await new Promise((r) => setTimeout(r, 5));
    }
  };
}

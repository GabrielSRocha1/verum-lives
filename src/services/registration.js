// Fluxo de inscrição: antispam → validação → gravação (idempotente por e-mail) → confirmação → eventos.
import { HttpError } from '../lib/http.js';
import { validateRegistration } from '../lib/validation.js';
import { CONSENT_VERSION } from '../settings/defaults.js';
import { emailDomainAcceptsMail } from './email-dns.js';

export function createRegistrationService({ db, subscribers, antispam, reminders, events, signer, cipher, config, clock, logger }) {
  // Chaves de idempotência recentes (clique duplo / reenvio da mesma submissão).
  const recent = new Map();
  const IDEM_TTL = 10 * 60_000;

  function remember(key, result) {
    if (!key) return;
    const now = clock();
    recent.set(key, { at: now, result });
    if (recent.size > 5000) for (const [k, v] of recent) if (now - v.at > IDEM_TTL) recent.delete(k);
  }

  function confirmationToken(sub, isNew) {
    return signer.issue('confirm', { s: sub.public_id, n: isNew ? 1 : 0 }, 2 * 3600_000, clock());
  }

  async function register(body, { ip, idempotencyKey }) {
    const idem = /^[a-zA-Z0-9-]{8,64}$/.test(String(idempotencyKey || '')) ? `${ip}:${idempotencyKey}` : null;
    if (idem && recent.has(idem) && clock() - recent.get(idem).at < IDEM_TTL) return recent.get(idem).result;

    const spam = await antispam.check(body, ip);
    if (spam.bot) {
      logger.warn('envio descartado (honeypot)', {});
      return { status: 'ignored', redirect: '/' };
    }

    const { errors, value } = validateRegistration(body);
    if (errors) throw new HttpError(422, 'Confira os campos destacados.', { fields: errors });

    if (config.form.emailDnsCheck && !(await emailDomainAcceptsMail(value.email))) {
      throw new HttpError(422, 'Confira os campos destacados.', { fields: { email: 'Este domínio de e-mail não recebe mensagens. Confira se digitou corretamente.' } });
    }

    const now = clock();
    const data = { ...value, consentVersion: CONSENT_VERSION, ipHash: cipher.blindIndex(ip, 'ip') };

    let sub;
    let isNew = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = subscribers.findByEmail(value.email);
      if (existing) {
        sub = subscribers.reRegister(existing, data, now);
      } else {
        sub = subscribers.create(data, now);
        isNew = true;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    // Confirmação é única por canal: numa reinscrição só sai para um canal recém-autorizado.
    reminders.enqueueConfirmation(sub);
    events.emit(isNew ? 'subscriber.created' : 'subscriber.updated', { subscriber: sub });

    const result = {
      status: isNew ? 'created' : 'existing',
      subscriberId: sub.id,
      redirect: `/confirmacao?c=${encodeURIComponent(confirmationToken(sub, isNew))}`
    };
    remember(idem, result);
    return result;
  }

  return { register };
}

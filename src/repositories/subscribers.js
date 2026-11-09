// Repositório de inscritos. Nome, e-mail e telefone ficam criptografados (AES-256-GCM);
// buscas exatas usam índice cego (HMAC). Campos de atribuição e consentimento ficam em claro para estatística.
import crypto from 'node:crypto';
import { phoneVariants } from '../lib/validation.js';

export function createSubscribersRepo(db, cipher) {
  const byEmailIdx = db.prepare('SELECT * FROM subscribers WHERE email_idx = ? AND deleted_at IS NULL');
  const byId = db.prepare('SELECT * FROM subscribers WHERE id = ?');
  const byPublicId = db.prepare('SELECT * FROM subscribers WHERE public_id = ? AND deleted_at IS NULL');

  const insert = db.prepare(`
    INSERT INTO subscribers (
      public_id, name_enc, email_enc, email_idx, phone_enc, phone_idx, country,
      consent_email, consent_email_at, consent_whatsapp, consent_whatsapp_at, consent_version, consent_ip_hash,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, ttclid,
      landing_url, referrer_host, origin, visitor_id,
      created_at, updated_at, last_registered_at, registration_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);

  const emailIdx = (email) => cipher.blindIndex(email, 'email');
  const phoneIdx = (phone) => cipher.blindIndex(phone, 'phone');

  function decrypt(row) {
    if (!row) return null;
    return {
      ...row,
      name: row.name_enc ? cipher.decrypt(row.name_enc) : null,
      email: row.email_enc ? cipher.decrypt(row.email_enc) : null,
      phone: row.phone_enc ? cipher.decrypt(row.phone_enc) : null
    };
  }

  return {
    decrypt,
    findByEmail(email) {
      return decrypt(byEmailIdx.get(emailIdx(email)));
    },
    findById(id) {
      return decrypt(byId.get(id));
    },
    findByPublicId(publicId) {
      return decrypt(byPublicId.get(publicId));
    },
    findByPhoneAny(e164) {
      const idxs = phoneVariants(e164).map(phoneIdx);
      const rows = db.prepare(`SELECT * FROM subscribers WHERE deleted_at IS NULL AND phone_idx IN (${idxs.map(() => '?').join(',')})`).all(...idxs);
      return rows.map(decrypt);
    },
    create(data, now) {
      const a = data.attribution || {};
      const publicId = crypto.randomUUID();
      const r = insert.run(
        publicId, cipher.encrypt(data.name), cipher.encrypt(data.email), emailIdx(data.email),
        cipher.encrypt(data.phone), phoneIdx(data.phone), data.country,
        data.consentEmail ? 1 : 0, data.consentEmail ? now : null,
        data.consentWhatsapp ? 1 : 0, data.consentWhatsapp ? now : null,
        data.consentVersion, data.ipHash,
        a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term, a.fbclid, a.gclid, a.ttclid,
        a.landing_url, a.referrer_host, a.origin || 'direto', data.visitorId,
        now, now, now
      );
      return this.findById(Number(r.lastInsertRowid));
    },
    // Reinscrição: atualiza dados de contato e consentimentos com a manifestação mais recente; mantém a origem original.
    reRegister(existing, data, now) {
      const ce = data.consentEmail ? 1 : 0;
      const cw = data.consentWhatsapp ? 1 : 0;
      db.prepare(`
        UPDATE subscribers SET
          name_enc = ?, phone_enc = ?, phone_idx = ?, country = ?,
          consent_email = ?, consent_email_at = CASE WHEN ? = 1 AND consent_email = 0 THEN ? WHEN ? = 1 THEN consent_email_at ELSE NULL END,
          unsub_email_at = CASE WHEN ? = 1 THEN NULL ELSE unsub_email_at END,
          consent_whatsapp = ?, consent_whatsapp_at = CASE WHEN ? = 1 AND consent_whatsapp = 0 THEN ? WHEN ? = 1 THEN consent_whatsapp_at ELSE NULL END,
          unsub_whatsapp_at = CASE WHEN ? = 1 THEN NULL ELSE unsub_whatsapp_at END,
          consent_version = ?, consent_ip_hash = ?,
          updated_at = ?, last_registered_at = ?, registration_count = registration_count + 1
        WHERE id = ?`).run(
        cipher.encrypt(data.name), cipher.encrypt(data.phone), phoneIdx(data.phone), data.country,
        ce, ce, now, ce, ce,
        cw, cw, now, cw, cw,
        data.consentVersion, data.ipHash,
        now, now, existing.id
      );
      return this.findById(existing.id);
    },
    revokeConsent(id, channel, now) {
      if (channel === 'email') {
        return db.prepare('UPDATE subscribers SET consent_email = 0, unsub_email_at = ?, updated_at = ? WHERE id = ? AND consent_email = 1').run(now, now, id).changes;
      }
      if (channel === 'whatsapp') {
        return db.prepare('UPDATE subscribers SET consent_whatsapp = 0, unsub_whatsapp_at = ?, updated_at = ? WHERE id = ? AND consent_whatsapp = 1').run(now, now, id).changes;
      }
      return 0;
    },
    // Marca a conversão como disparada uma única vez (atômico).
    claimConversion(id, now) {
      return db.prepare('UPDATE subscribers SET conversion_fired_at = ? WHERE id = ? AND conversion_fired_at IS NULL').run(now, id).changes === 1;
    },
    // Direito de eliminação (LGPD): remove dados pessoais e mantém apenas atributos não identificáveis para estatística.
    erase(id, now) {
      db.prepare(`UPDATE subscribers SET name_enc = NULL, email_enc = NULL, email_idx = NULL, phone_enc = NULL, phone_idx = NULL,
        consent_email = 0, consent_whatsapp = 0, consent_ip_hash = NULL, visitor_id = NULL, fbclid = NULL, gclid = NULL, ttclid = NULL,
        landing_url = NULL, deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
      db.prepare("UPDATE deliveries SET status = 'skipped', last_error = 'inscrito removido' WHERE subscriber_id = ? AND status IN ('pending','failed')").run(id);
    },
    list({ limit = 50, offset = 0, campaign = null, origin = null } = {}) {
      const where = ['deleted_at IS NULL'];
      const args = [];
      if (campaign) { where.push('utm_campaign IS ?'); args.push(campaign === '(sem campanha)' ? null : campaign); }
      if (origin) { where.push('origin = ?'); args.push(origin); }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) c FROM subscribers WHERE ${w}`).get(...args).c;
      const rows = db.prepare(`SELECT * FROM subscribers WHERE ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
      return { total, rows: rows.map(decrypt) };
    },
    allActive() {
      return db.prepare('SELECT * FROM subscribers WHERE deleted_at IS NULL ORDER BY created_at DESC').all().map(decrypt);
    }
  };
}

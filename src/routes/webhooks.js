// Webhooks de entrada: WhatsApp Cloud API (descadastro por palavra-chave e status de entrega) e Brevo (descadastro/bounce).
import crypto from 'node:crypto';
import { readBody, sendJson, HttpError } from '../lib/http.js';
import { safeEqual } from '../lib/crypto.js';

export const WA_STOP_WORDS = ['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover', 'unsubscribe'];

export function registerWebhookRoutes(router, ctx) {
  const { config, subscribers, events, db, clock, logger } = ctx;

  // Verificação do endpoint (Meta envia hub.challenge).
  router.add('GET', '/api/webhooks/whatsapp', (req, res, { query }) => {
    if (config.whatsapp.verifyToken && query.get('hub.mode') === 'subscribe' && safeEqual(query.get('hub.verify_token') || '', config.whatsapp.verifyToken)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(String(query.get('hub.challenge') || '').slice(0, 200));
    }
    throw new HttpError(403, 'Verificação recusada.');
  });

  router.add('POST', '/api/webhooks/whatsapp', async (req, res) => {
    if (!config.whatsapp.appSecret) throw new HttpError(503, 'Webhook do WhatsApp não configurado.');
    const raw = await readBody(req, 512 * 1024);
    const sig = String(req.headers['x-hub-signature-256'] || '');
    const expected = 'sha256=' + crypto.createHmac('sha256', config.whatsapp.appSecret).update(raw).digest('hex');
    if (!safeEqual(sig, expected)) throw new HttpError(401, 'Assinatura inválida.');
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); }

    const now = clock();
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        for (const msg of v.messages || []) {
          const text = String(msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '')
            .trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          if (!WA_STOP_WORDS.includes(text)) continue;
          for (const sub of subscribers.findByPhoneAny(msg.from)) {
            if (subscribers.revokeConsent(sub.id, 'whatsapp', now)) {
              events.emit('subscriber.unsubscribed', { subscriber: sub, channel: 'whatsapp' });
              logger.info('descadastro via WhatsApp', { subscriber: sub.public_id });
            }
          }
        }
        for (const st of v.statuses || []) {
          if (!st.id) continue;
          const err = st.status === 'failed' ? String(st.errors?.[0]?.title || st.errors?.[0]?.message || 'falha').slice(0, 300) : null;
          db.prepare('UPDATE deliveries SET provider_status = ?, last_error = COALESCE(?, last_error) WHERE provider_message_id = ?').run(String(st.status).slice(0, 20), err, st.id);
        }
      }
    }
    sendJson(res, 200, { ok: true });
  });

  // Brevo: configure o webhook de marketing/transacional para https://SEU_DOMINIO/api/webhooks/brevo/<BREVO_WEBHOOK_TOKEN>
  router.add('POST', '/api/webhooks/brevo/:token', async (req, res, { params }) => {
    if (!config.brevo.webhookToken || !safeEqual(params.token, config.brevo.webhookToken)) throw new HttpError(401, 'Token inválido.');
    const raw = await readBody(req, 256 * 1024);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); }
    const list = Array.isArray(body) ? body : [body];
    const now = clock();
    for (const ev of list) {
      const type = String(ev.event || '').toLowerCase();
      if (!['unsubscribed', 'unsubscribe', 'hard_bounce', 'spam', 'complaint', 'blocked', 'invalid_email'].includes(type)) continue;
      const sub = subscribers.findByEmail(String(ev.email || '').trim().toLowerCase());
      if (sub && subscribers.revokeConsent(sub.id, 'email', now)) {
        events.emit('subscriber.unsubscribed', { subscriber: sub, channel: 'email' });
        logger.info('consentimento de e-mail revogado via Brevo', { event: type, subscriber: sub.public_id });
      }
    }
    sendJson(res, 200, { ok: true });
  });
}

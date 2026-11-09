// Encaminha eventos do sistema para um webhook do n8n, assinados com HMAC-SHA256.
// Cabeçalhos: X-Verum-Event, X-Verum-Timestamp, X-Verum-Signature (sha256=hex(HMAC(secret, `${ts}.${corpo}`))),
// e X-Verum-Token (segredo bruto, para a autenticação "Header Auth" nativa do nó Webhook do n8n).
import crypto from 'node:crypto';
import { postJson } from '../lib/outbound.js';

export function signN8nPayload(secret, ts, raw) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
}

function subscriberPayload(s) {
  return {
    id: s.public_id,
    name: s.name,
    email: s.email,
    whatsapp: s.phone ? `+${s.phone}` : null,
    country: s.country,
    consents: {
      email: !!s.consent_email,
      whatsapp: !!s.consent_whatsapp,
      version: s.consent_version
    },
    attribution: {
      origin: s.origin, utm_source: s.utm_source, utm_medium: s.utm_medium, utm_campaign: s.utm_campaign,
      utm_content: s.utm_content, utm_term: s.utm_term
    },
    created_at: new Date(s.created_at).toISOString()
  };
}

export function registerN8n(events, cfg, { clock, timeoutMs }) {
  const enabled = () => !!(cfg.webhookUrl && cfg.secret);

  async function forward(type, data) {
    if (!enabled()) return;
    const ts = String(Math.floor(clock() / 1000));
    const raw = JSON.stringify({ event: type, sent_at: new Date(clock()).toISOString(), data });
    await postJson(cfg.webhookUrl, null, {
      rawBody: raw,
      timeoutMs,
      headers: {
        'X-Verum-Event': type,
        'X-Verum-Timestamp': ts,
        'X-Verum-Signature': signN8nPayload(cfg.secret, ts, raw),
        'X-Verum-Token': cfg.secret
      }
    });
  }

  events.on('subscriber.created', ({ subscriber }) => forward('subscriber.created', subscriberPayload(subscriber)));
  events.on('subscriber.updated', ({ subscriber }) => forward('subscriber.updated', subscriberPayload(subscriber)));
  events.on('subscriber.unsubscribed', ({ subscriber, channel }) => forward('subscriber.unsubscribed', { id: subscriber.public_id, channel }));
  events.on('subscriber.erased', ({ publicId }) => forward('subscriber.erased', { id: publicId }));

  return {
    name: 'n8n',
    status: () => ({ configured: enabled(), missing: [!cfg.webhookUrl && 'N8N_WEBHOOK_URL', !cfg.secret && 'N8N_WEBHOOK_SECRET'].filter(Boolean) })
  };
}

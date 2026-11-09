// Sincroniza inscritos que autorizaram e-mail com a lista de contatos da Brevo.
import { postJson } from '../lib/outbound.js';
import { firstName } from '../lib/text.js';

export function registerBrevoContacts(events, cfg, { logger, timeoutMs }) {
  const enabled = () => !!(cfg.apiKey && cfg.listId);
  const headers = () => ({ 'api-key': cfg.apiKey });

  async function upsert(sub) {
    if (!enabled() || !sub.consent_email || !sub.email) return;
    const parts = String(sub.name || '').trim().split(/\s+/);
    await postJson(`${cfg.apiBase}/v3/contacts`, {
      email: sub.email,
      attributes: {
        FIRSTNAME: firstName(sub.name),
        LASTNAME: parts.slice(1).join(' '),
        ...(sub.consent_whatsapp ? { WHATSAPP: `+${sub.phone}` } : {})
      },
      listIds: [cfg.listId],
      updateEnabled: true
    }, { headers: headers(), timeoutMs });
  }

  async function removeFromList(email) {
    if (!enabled() || !email) return;
    await postJson(`${cfg.apiBase}/v3/contacts/lists/${cfg.listId}/contacts/remove`, { emails: [email] }, { headers: headers(), timeoutMs });
  }

  events.on('subscriber.created', ({ subscriber }) => upsert(subscriber));
  events.on('subscriber.updated', ({ subscriber }) => (subscriber.consent_email ? upsert(subscriber) : removeFromList(subscriber.email)));
  events.on('subscriber.unsubscribed', ({ subscriber, channel }) => (channel === 'email' || channel === 'all' ? removeFromList(subscriber.email) : null));
  events.on('subscriber.erased', ({ email }) => removeFromList(email));

  return { name: 'brevo-contacts', status: () => ({ configured: enabled(), missing: enabled() ? [] : ['BREVO_API_KEY', 'BREVO_LIST_ID'].filter((k) => !(k === 'BREVO_API_KEY' ? cfg.apiKey : cfg.listId)) }), logger };
}

// Canal WhatsApp via API oficial (WhatsApp Business Cloud API).
// Mensagens iniciadas pela empresa exigem MODELO APROVADO na Meta; o texto do modelo é definido no Gerenciador do WhatsApp,
// e aqui configuramos o nome do modelo, idioma e quais variáveis preenchem {{1}}, {{2}}...
import { postJson } from '../lib/outbound.js';

export function createWhatsappChannel(cfg, timeoutMs) {
  const missing = () => ['token', 'phoneNumberId'].filter((k) => !cfg[k]).map((k) => ({ token: 'WHATSAPP_TOKEN', phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID' }[k]));
  return {
    name: 'whatsapp',
    label: 'WhatsApp (Cloud API)',
    consentField: 'consent_whatsapp',
    status() {
      const m = missing();
      return { configured: m.length === 0, missing: m };
    },
    async send({ subscriber, step, vars }) {
      if (missing().length) return { skipped: 'WhatsApp Cloud API não configurada' };
      if (!step.whatsapp?.template) return { skipped: `Modelo do WhatsApp não definido para "${step.label}"` };
      const parameters = (step.whatsapp.params || []).map((p) => ({ type: 'text', text: String(vars[p] ?? '').slice(0, 1000) || '-' }));
      const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: subscriber.phone,
        type: 'template',
        template: {
          name: step.whatsapp.template,
          language: { code: step.whatsapp.language || 'pt_BR' },
          ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {})
        }
      };
      const r = await postJson(`${cfg.apiBase}/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, body, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        timeoutMs
      });
      return { providerMessageId: r.json?.messages?.[0]?.id || null };
    }
  };
}

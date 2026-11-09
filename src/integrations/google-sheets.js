// Envia cada inscrição do formulário para uma planilha Google (aba "Inscritos"),
// via Web App do Google Apps Script publicado na conta dona da planilha.
// O script (deploy/google-apps-script.gs) valida o segredo compartilhado e faz
// upsert por e-mail: cria a linha na primeira inscrição e atualiza em reinscrições.
import { postJson } from '../lib/outbound.js';

function rowPayload(s) {
  return {
    id: s.public_id,
    nome: s.name,
    email: s.email,
    whatsapp: s.phone ? `+${s.phone}` : '',
    pais: s.country || '',
    consentimento_email: s.consent_email ? 'sim' : 'não',
    consentimento_whatsapp: s.consent_whatsapp ? 'sim' : 'não',
    origem: s.origin || '',
    utm_source: s.utm_source || '',
    utm_medium: s.utm_medium || '',
    utm_campaign: s.utm_campaign || '',
    utm_content: s.utm_content || '',
    utm_term: s.utm_term || '',
    criado_em: new Date(s.created_at).toISOString()
  };
}

export function registerGoogleSheets(events, cfg, { logger, timeoutMs }) {
  const enabled = () => !!(cfg.webAppUrl && cfg.secret);

  // Apps Script tem "partida a frio" (pode passar de 10s); usa timeout maior e uma retentativa.
  const sheetsTimeoutMs = Math.max(timeoutMs, 30000);

  async function send(sub) {
    if (!enabled()) return;
    const body = { secret: cfg.secret, row: rowPayload(sub) };
    try {
      await postJson(cfg.webAppUrl, body, { timeoutMs: sheetsTimeoutMs });
    } catch (e) {
      if (!e.retryable) throw e;
      logger.warn('Google Sheets falhou, tentando de novo', { id: sub.public_id, error: e.message });
      await new Promise((r) => setTimeout(r, 2000));
      await postJson(cfg.webAppUrl, body, { timeoutMs: sheetsTimeoutMs });
    }
    logger.info('inscrição enviada ao Google Sheets', { id: sub.public_id });
  }

  events.on('subscriber.created', ({ subscriber }) => send(subscriber));
  events.on('subscriber.updated', ({ subscriber }) => send(subscriber));

  return {
    name: 'google-sheets',
    status: () => ({
      configured: enabled(),
      missing: [!cfg.webAppUrl && 'GOOGLE_SHEETS_WEBAPP_URL', !cfg.secret && 'GOOGLE_SHEETS_SECRET'].filter(Boolean)
    })
  };
}

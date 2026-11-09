// Canal de e-mail via API transacional da Brevo (/v3/smtp/email).
import { postJson } from '../lib/outbound.js';
import { renderTemplate, textToHtml, escapeHtml } from '../lib/text.js';

export function emailLayout({ bodyHtml, unsubscribeUrl, preheader = '' }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verum Cripto</title></head>
<body style="margin:0;padding:0;background:#060913;font-family:Inter,Segoe UI,Arial,sans-serif;color:#E8ECF5">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#060913;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0B1226;border:1px solid #2A2414;border-radius:16px">
<tr><td style="padding:28px 28px 8px;text-align:center">
<div style="font-size:12px;letter-spacing:4px;color:#D9A94B;font-weight:700">VERUM CRIPTO · AO VIVO</div>
<div style="font-size:26px;font-weight:800;color:#F3D48A;margin-top:8px;letter-spacing:.5px">BITCOIN: OURO DIGITAL!</div>
</td></tr>
<tr><td style="padding:16px 28px 8px;font-size:16px;line-height:1.6;color:#E8ECF5">${bodyHtml}</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:12px;line-height:1.5;color:#8A93A8;border-top:1px solid #1B2440">
Conteúdo educacional. Não constitui recomendação de investimento.<br>
Você recebeu este e-mail porque se inscreveu nas transmissões ao vivo do Canal Verum Cripto.
<a href="${escapeHtml(unsubscribeUrl)}" style="color:#B8C0D4">Cancelar o recebimento</a>.
</td></tr></table></td></tr></table></body></html>`;
}

export function createBrevoEmailChannel(cfg, timeoutMs) {
  const missing = () => ['apiKey', 'senderEmail'].filter((k) => !cfg[k]).map((k) => ({ apiKey: 'BREVO_API_KEY', senderEmail: 'BREVO_SENDER_EMAIL' }[k]));
  return {
    name: 'email',
    label: 'E-mail (Brevo)',
    consentField: 'consent_email',
    status() {
      const m = missing();
      return { configured: m.length === 0, missing: m };
    },
    async send({ subscriber, step, vars, unsubscribeUrl }) {
      if (missing().length) return { skipped: 'Brevo não configurada' };
      const subject = renderTemplate(step.email.subject, vars).replace(/[\r\n]+/g, ' ').slice(0, 200);
      const text = renderTemplate(step.email.body, vars);
      const r = await postJson(`${cfg.apiBase}/v3/smtp/email`, {
        sender: { name: cfg.senderName, email: cfg.senderEmail },
        to: [{ email: subscriber.email, name: subscriber.name }],
        subject,
        htmlContent: emailLayout({ bodyHtml: textToHtml(text), unsubscribeUrl, preheader: subject }),
        textContent: `${text}\n\n—\nPara não receber mais: ${unsubscribeUrl}`,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        },
        tags: ['verum-lives', step.key]
      }, { headers: { 'api-key': cfg.apiKey }, timeoutMs });
      return { providerMessageId: r.json?.messageId || null };
    }
  };
}

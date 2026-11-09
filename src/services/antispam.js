// Proteção contra spam: token de formulário assinado (tempo mínimo de preenchimento), honeypot,
// limite por IP e, opcionalmente, Cloudflare Turnstile verificado no servidor.
import crypto from 'node:crypto';
import { HttpError } from '../lib/http.js';

export const HONEYPOT_FIELD = 'empresa_site';

export function createAntispam({ signer, config, clock, rateLimiter }) {
  return {
    issueFormToken() {
      return signer.issue('form', { n: crypto.randomBytes(6).toString('base64url') }, config.form.maxAgeMs, clock());
    },
    turnstileEnabled() {
      return !!(config.turnstile.siteKey && config.turnstile.secretKey);
    },
    // Lança HttpError quando bloqueado; retorna { bot: true } para descartar silenciosamente.
    async check(body, ip) {
      if (!rateLimiter.hit(`reg:${ip}`, config.rateLimits.registerPerIp, config.rateLimits.registerWindowMs)) {
        throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
      }
      if (body[HONEYPOT_FIELD]) return { bot: true };
      const tok = signer.verify('form', body.form_token, clock());
      if (!tok) throw new HttpError(400, 'Sua sessão expirou. Recarregue a página e tente novamente.', { code: 'form_token' });
      if (clock() - tok._iat < config.form.minFillMs) throw new HttpError(400, 'Envio muito rápido. Confira seus dados e tente novamente.', { code: 'too_fast' });
      if (this.turnstileEnabled()) {
        const ok = await verifyTurnstile(config, body.turnstile_token, ip);
        if (!ok) throw new HttpError(400, 'Não foi possível confirmar que você é humano. Tente novamente.', { code: 'captcha' });
      }
      return { bot: false };
    }
  };
}

async function verifyTurnstile(config, token, ip) {
  if (!token || String(token).length > 4096) return false;
  try {
    const res = await fetch(config.turnstile.verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstile.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000)
    });
    const j = await res.json();
    return j.success === true;
  } catch {
    return false;
  }
}

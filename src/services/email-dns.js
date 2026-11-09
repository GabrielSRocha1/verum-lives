// Verifica se o domínio do e-mail aceita mensagens (MX ou A). Falha aberta em timeouts para não perder inscrições.
import dns from 'node:dns/promises';

export async function emailDomainAcceptsMail(email, timeoutMs = 2000) {
  const domain = String(email).split('@')[1];
  if (!domain) return false;
  const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), timeoutMs))]);
  const definitive = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    if (mx.length) return true;
  } catch (e) {
    if (!definitive.has(e.code)) return true;
  }
  try {
    const a = await withTimeout(dns.resolve4(domain));
    return a.length > 0;
  } catch (e) {
    return !definitive.has(e.code);
  }
}

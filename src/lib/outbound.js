// Cliente HTTP de saída para provedores (Brevo, WhatsApp, n8n), com timeout e classificação de erro.
export class ProviderError extends Error {
  constructor(message, { retryable = false, status = 0 } = {}) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

export async function postJson(url, body, { headers = {}, timeoutMs = 10000, rawBody = null } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: rawBody ?? JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    throw new ProviderError(`Falha de rede: ${e.name === 'TimeoutError' ? 'tempo esgotado' : e.message}`, { retryable: true });
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
  if (!res.ok) {
    const detail = json?.message || json?.error?.message || text.slice(0, 300);
    throw new ProviderError(`HTTP ${res.status}: ${detail}`, { retryable: res.status >= 500 || res.status === 429, status: res.status });
  }
  return { status: res.status, json, text };
}

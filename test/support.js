// Infraestrutura de testes: provedores simulados (Brevo, WhatsApp, n8n, Turnstile) e app com relógio controlável.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/services/events.js';

export async function startMockProviders() {
  const calls = [];
  const failures = new Map(); // caminho → [{status, count}]
  let waSeq = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(raw); } catch { body = raw; }
      const url = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: url.pathname, headers: req.headers, body, raw });
      const f = failures.get(url.pathname);
      if (f && f.count > 0) {
        f.count--;
        res.writeHead(f.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'falha simulada' }));
      }
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/v3/smtp/email') return res.end(JSON.stringify({ messageId: `<msg-${calls.length}@brevo>` }));
      if (url.pathname.startsWith('/v3/contacts')) { res.statusCode = 201; return res.end('{}'); }
      if (/\/messages$/.test(url.pathname)) return res.end(JSON.stringify({ messages: [{ id: `wamid.TEST${++waSeq}` }] }));
      if (url.pathname === '/n8n') return res.end('{"ok":true}');
      if (url.pathname === '/turnstile') {
        const p = new URLSearchParams(raw);
        return res.end(JSON.stringify({ success: p.get('response') === 'token-humano' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    calls,
    failNext(p, status, count = 1) { failures.set(p, { status, count }); },
    by(p) { return calls.filter((c) => (p instanceof RegExp ? p.test(c.path) : c.path === p)); },
    reset() { calls.length = 0; failures.clear(); },
    close: () => new Promise((r) => server.close(r))
  };
}

export async function startTestApp({ env = {}, now = Date.parse('2026-11-09T13:00:00Z'), mock } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verum-lives-test-'));
  const clock = { now };
  const k = () => crypto.randomBytes(32).toString('hex');
  const baseEnv = {
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    DATA_ENCRYPTION_KEY: k(),
    INDEX_KEY: k(),
    APP_SECRET: k(),
    FORM_MIN_FILL_MS: '1000',
    EMAIL_DNS_CHECK: '0',
    DISPATCHER_ENABLED: '0',
    TRUST_PROXY: '1',
    RL_REGISTER_PER_IP: '1000',
    ...(mock ? {
      BREVO_API_KEY: 'brevo-test-key', BREVO_API_BASE: mock.base, BREVO_SENDER_EMAIL: 'lives@verum.test', BREVO_LIST_ID: '7', BREVO_WEBHOOK_TOKEN: 'brevo-hook-token',
      WHATSAPP_TOKEN: 'wa-test-token', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_API_BASE: mock.base, WHATSAPP_APP_SECRET: 'wa-app-secret', WHATSAPP_VERIFY_TOKEN: 'wa-verify',
      N8N_WEBHOOK_URL: `${mock.base}/n8n`, N8N_WEBHOOK_SECRET: 'n8n-secret'
    } : {}),
    ...env
  };
  const keys = Object.keys(process.env);
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  // Isola a configuração do ambiente do processo.
  for (const key of keys) if (/^(BREVO|WHATSAPP|N8N|TURNSTILE|ADMIN|DATA_|INDEX_KEY|APP_SECRET|BASE_URL|PORT)/.test(key)) delete process.env[key];
  const config = loadConfig({ skipDotEnv: true, env: baseEnv });
  Object.assign(process.env, saved);
  const app = createApp({ config, clock: now === 'real' ? () => Date.now() : () => clock.now, logger: createLogger(true) });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  if (!env.BASE_URL) config.baseUrl = base;

  async function req(method, p, { json, headers = {}, raw, contentType } = {}) {
    const h = { ...headers };
    let body;
    if (json !== undefined) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    if (raw !== undefined) { body = raw; h['Content-Type'] = contentType || 'application/octet-stream'; }
    const res = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    let data = null;
    try { data = JSON.parse(text); } catch { /* html/csv */ }
    return { status: res.status, headers: res.headers, text, json: data };
  }

  return {
    app,
    ctx: app.ctx,
    config,
    base,
    clock,
    req,
    advance(ms) { clock.now += ms; },
    formToken() { return app.ctx.antispam.issueFormToken(); },
    async settle() { await app.ctx.events.idle(); await app.ctx.reminders.tick(); await app.ctx.events.idle(); },
    async close() { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  };
}

export function validBody(overrides = {}) {
  return {
    name: 'Maria Souza Lima',
    email: 'maria.souza@exemplo.com',
    country: 'BR',
    phone: '(11) 98765-4321',
    consent_email: true,
    consent_whatsapp: true,
    visitor_id: 'visitante-0001',
    attribution: { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'bitcoin-ouro-nov', referrer: 'https://l.instagram.com/' },
    ...overrides
  };
}

// Inscreve respeitando o tempo mínimo de preenchimento (avança o relógio simulado).
export async function register(t, overrides = {}, headers = {}) {
  const token = t.formToken();
  t.advance(1500);
  return t.req('POST', '/api/public/register', { json: { ...validBody(overrides), form_token: token }, headers });
}

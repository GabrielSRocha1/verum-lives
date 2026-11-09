// Configuração carregada de variáveis de ambiente (nunca do frontend).
// Em produção, chaves ausentes encerram o processo (fail-closed).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).toLowerCase());
}

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function decodeKey(value, name) {
  const buf = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (buf.length !== 32) throw new Error(`${name} deve ter 32 bytes (64 hex ou base64)`);
  return buf;
}

// Em desenvolvimento, gera chaves locais persistentes (arquivo 0600) para não perder dados entre reinícios.
function devKeys(dataDir) {
  const file = path.join(dataDir, '.dev-keys.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = {
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    INDEX_KEY: crypto.randomBytes(32).toString('hex'),
    APP_SECRET: crypto.randomBytes(32).toString('hex')
  };
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

export function loadConfig(overrides = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!overrides.skipDotEnv) loadDotEnv(path.join(root, '.env'));
  const env = { ...process.env, ...overrides.env };

  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const dataDir = path.resolve(env.DATA_DIR || path.join(root, 'data'));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  let keys = {
    DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY,
    INDEX_KEY: env.INDEX_KEY,
    APP_SECRET: env.APP_SECRET
  };
  const missing = Object.entries(keys).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    if (production) {
      throw new Error(`Variáveis obrigatórias ausentes em produção: ${missing.join(', ')}. Gere com: npm run keys:generate`);
    }
    keys = { ...devKeys(dataDir), ...Object.fromEntries(Object.entries(keys).filter(([, v]) => v)) };
  }

  const baseUrl = (env.BASE_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/+$/, '');

  const config = {
    root,
    publicDir: path.join(root, 'public'),
    nodeEnv,
    production,
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 3000),
    baseUrl,
    secureCookies: baseUrl.startsWith('https://'),
    trustProxy: bool(env.TRUST_PROXY, production),
    dataDir,
    dbFile: path.join(dataDir, env.DB_FILE || 'verum-lives.sqlite'),
    uploadsDir: path.join(dataDir, 'uploads'),
    keys: {
      data: decodeKey(keys.DATA_ENCRYPTION_KEY, 'DATA_ENCRYPTION_KEY'),
      index: decodeKey(keys.INDEX_KEY, 'INDEX_KEY'),
      app: decodeKey(keys.APP_SECRET, 'APP_SECRET')
    },
    form: {
      minFillMs: int(env.FORM_MIN_FILL_MS, 2500),
      maxAgeMs: int(env.FORM_MAX_AGE_MS, 6 * 3600 * 1000),
      emailDnsCheck: bool(env.EMAIL_DNS_CHECK, production)
    },
    rateLimits: {
      registerPerIp: int(env.RL_REGISTER_PER_IP, 6),
      registerWindowMs: int(env.RL_REGISTER_WINDOW_MS, 10 * 60 * 1000),
      loginPerIp: int(env.RL_LOGIN_PER_IP, 10),
      loginWindowMs: int(env.RL_LOGIN_WINDOW_MS, 15 * 60 * 1000)
    },
    adminBootstrap: {
      email: env.ADMIN_BOOTSTRAP_EMAIL || '',
      password: env.ADMIN_BOOTSTRAP_PASSWORD || ''
    },
    sessionTtlMs: int(env.SESSION_TTL_HOURS, 12) * 3600 * 1000,
    brevo: {
      apiKey: env.BREVO_API_KEY || '',
      apiBase: (env.BREVO_API_BASE || 'https://api.brevo.com').replace(/\/+$/, ''),
      senderEmail: env.BREVO_SENDER_EMAIL || '',
      senderName: env.BREVO_SENDER_NAME || 'Verum Cripto',
      listId: int(env.BREVO_LIST_ID, 0),
      webhookToken: env.BREVO_WEBHOOK_TOKEN || ''
    },
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      apiBase: (env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/+$/, ''),
      apiVersion: env.WHATSAPP_API_VERSION || 'v21.0'
    },
    n8n: {
      webhookUrl: env.N8N_WEBHOOK_URL || '',
      secret: env.N8N_WEBHOOK_SECRET || ''
    },
    googleSheets: {
      webAppUrl: env.GOOGLE_SHEETS_WEBAPP_URL || '',
      secret: env.GOOGLE_SHEETS_SECRET || ''
    },
    turnstile: {
      siteKey: env.TURNSTILE_SITE_KEY || '',
      secretKey: env.TURNSTILE_SECRET_KEY || '',
      verifyUrl: env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    },
    dispatcher: {
      enabled: bool(env.DISPATCHER_ENABLED, true),
      intervalMs: int(env.DISPATCHER_INTERVAL_MS, 30000),
      graceMinutes: int(env.REMINDER_GRACE_MINUTES, 20),
      batchSize: int(env.DISPATCHER_BATCH_SIZE, 200),
      concurrency: int(env.DISPATCHER_CONCURRENCY, 5),
      maxAttempts: int(env.DISPATCHER_MAX_ATTEMPTS, 4)
    },
    httpTimeoutMs: int(env.HTTP_TIMEOUT_MS, 10000),
    privacyEmail: env.PRIVACY_CONTACT_EMAIL || '',
    extraOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
  };
  return config;
}

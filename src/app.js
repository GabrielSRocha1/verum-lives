// Composição da aplicação: cria serviços, registra integrações e monta o servidor HTTP.
import http from 'node:http';
import fs from 'node:fs';
import { openDatabase } from './db/database.js';
import { createCipher, createSigner } from './lib/crypto.js';
import { createRouter, HttpError, sendJson, setSecurityHeaders, clientIp } from './lib/http.js';
import { createRateLimiter } from './lib/ratelimit.js';
import { createSettingsRepo } from './settings/settings.js';
import { createSubscribersRepo } from './repositories/subscribers.js';
import { createEventBus, createLogger } from './services/events.js';
import { createLiveService } from './services/live.js';
import { createAntispam } from './services/antispam.js';
import { createReminderService } from './services/reminders.js';
import { createRegistrationService } from './services/registration.js';
import { createAuthService, createAuditLog } from './services/auth.js';
import { createStatsService } from './services/stats.js';
import { createBrevoEmailChannel } from './channels/email-brevo.js';
import { createWhatsappChannel } from './channels/whatsapp-cloud.js';
import { registerBrevoContacts } from './integrations/brevo-contacts.js';
import { registerN8n } from './integrations/n8n.js';
import { registerGoogleSheets } from './integrations/google-sheets.js';
import { createPages } from './views/pages.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

export function createApp({ config, clock = () => Date.now(), logger = createLogger() }) {
  fs.mkdirSync(config.uploadsDir, { recursive: true, mode: 0o700 });
  const db = openDatabase(config.dbFile);
  const cipher = createCipher(config.keys.data, config.keys.index);
  const signer = createSigner(config.keys.app);
  const rateLimiter = createRateLimiter(clock);
  const settings = createSettingsRepo(db, clock);
  const subscribers = createSubscribersRepo(db, cipher);
  const events = createEventBus(logger);
  const live = createLiveService({ settings, signer, config, clock });

  // Canais de envio (Open/Closed): para um novo canal, crie o módulo e registre-o aqui.
  const channels = {
    email: createBrevoEmailChannel(config.brevo, config.httpTimeoutMs),
    whatsapp: createWhatsappChannel(config.whatsapp, config.httpTimeoutMs)
  };

  // Integrações orientadas a eventos.
  const integrations = [
    registerBrevoContacts(events, config.brevo, { logger, timeoutMs: config.httpTimeoutMs }),
    registerN8n(events, config.n8n, { clock, timeoutMs: config.httpTimeoutMs }),
    registerGoogleSheets(events, config.googleSheets, { logger, timeoutMs: config.httpTimeoutMs })
  ];

  const antispam = createAntispam({ signer, config, clock, rateLimiter });
  const reminders = createReminderService({ db, settings, subscribers, live, channels, config, clock, logger });
  const registration = createRegistrationService({ db, subscribers, antispam, reminders, events, signer, cipher, config, clock, logger });
  const auth = createAuthService({ db, clock, config, cipher });
  const audit = createAuditLog(db, clock);
  const stats = createStatsService({ db, clock, live });
  const pages = createPages({ config, settings, live, antispam, signer, subscribers, clock });

  if (auth.bootstrap()) logger.info('administrador inicial criado a partir de ADMIN_BOOTSTRAP_EMAIL');

  const ctx = {
    config, clock, logger, db, cipher, signer, rateLimiter, settings, subscribers, events, live, channels,
    integrations, antispam, reminders, registration, auth, audit, stats, pages
  };

  const router = createRouter();
  registerPublicRoutes(router, ctx);
  registerAdminRoutes(router, ctx);
  registerWebhookRoutes(router, ctx);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    req.ip = clientIp(req, config.trustProxy);
    setSecurityHeaders(res, { secure: config.secureCookies });
    try {
      const m = router.match(req.method, url.pathname);
      if (!m) return pages.notFound(req, res);
      if (m.methodNotAllowed) throw new HttpError(405, 'Método não permitido.');
      await m.handler(req, res, { params: m.params, query: url.searchParams, url });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) logger.error('erro interno', { path: url.pathname, error: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') });
      if (!res.headersSent) sendJson(res, status, { ok: false, error: status === 500 ? 'Erro interno. Tente novamente em instantes.' : e.message, ...(e.extra || {}) });
      else res.end();
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;

  return {
    server,
    ctx,
    async close() {
      reminders.stop();
      await new Promise((r) => server.close(() => r()));
      await events.idle();
      await reminders.idle();
      db.close();
    }
  };
}

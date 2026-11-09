// Ponto de entrada: carrega configuração, inicia HTTP e o despachante de lembretes, com desligamento gracioso.
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './services/events.js';

const logger = createLogger();
let app;
try {
  const config = loadConfig();
  app = createApp({ config, logger });
  app.server.listen(config.port, config.host, () => {
    logger.info('servidor iniciado', { url: config.baseUrl, listen: `${config.host}:${config.port}`, env: config.nodeEnv });
  });
  app.ctx.reminders.start();
  const admins = app.ctx.db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (!admins) logger.warn('nenhum administrador cadastrado — rode: npm run admin:create -- seu@email.com');
  for (const ch of Object.values(app.ctx.channels)) {
    const st = ch.status();
    if (!st.configured) logger.warn(`canal ${ch.name} não configurado`, { faltando: st.missing });
  }
} catch (e) {
  logger.error('falha ao iniciar', { error: e.message });
  process.exit(1);
}

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info('encerrando', { signal });
  const t = setTimeout(() => process.exit(1), 10000);
  t.unref();
  await app.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Adaptador para a Vercel (serverless): monta a aplicação uma vez por instância
// e repassa cada requisição ao servidor HTTP interno.
//
// Limitações conhecidas neste modo (ver deploy/VERCEL.md):
// - O SQLite vive em /tmp e é descartado quando a instância recicla — a fonte
//   durável dos cadastros é a planilha Google (integração google-sheets).
// - O despachante de lembretes fica desligado (não há processo contínuo).
// Para o backend completo (admin, lembretes), use a implantação da pasta deploy/.
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/verum-lives-data';
process.env.DISPATCHER_ENABLED = process.env.DISPATCHER_ENABLED || '0';

import { waitUntil } from '@vercel/functions';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/services/events.js';

const app = createApp({ config: loadConfig({ skipDotEnv: true }), logger: createLogger() });

export default function handler(req, res) {
  // Mantém a função viva até as integrações (ex.: Google Sheets) concluírem o envio.
  waitUntil(new Promise((resolve) => {
    res.on('close', () => app.ctx.events.idle().then(resolve, resolve));
  }));
  app.server.emit('request', req, res);
}

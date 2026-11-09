// Rotas públicas: páginas, inscrição, visita, agenda, descadastro e arquivos estáticos.
import { readJson, readBody, sendJson, serveFile, redirect, HttpError, isAllowedOrigin } from '../lib/http.js';

export function registerPublicRoutes(router, ctx) {
  const { config, pages, registration, stats, live, subscribers, signer, events, clock, rateLimiter } = ctx;

  router.add('GET', '/', (req, res) => pages.landing(req, res));
  router.add('GET', '/confirmacao', (req, res, { query }) => pages.confirmation(req, res, query.get('c')));
  router.add('GET', '/descadastro', (req, res, { query }) => pages.unsubscribe(req, res, query.get('t')));
  router.add('GET', '/privacidade', (req, res) => pages.privacy(req, res));
  router.add('GET', '/agenda.ics', (req, res) => pages.ics(req, res));

  router.add('POST', '/api/public/register', async (req, res) => {
    if (!isAllowedOrigin(config, req.headers.origin)) throw new HttpError(403, 'Origem não permitida.');
    const body = await readJson(req, 16 * 1024);
    const r = await registration.register(body, { ip: req.ip, idempotencyKey: req.headers['idempotency-key'] });
    sendJson(res, r.status === 'created' ? 201 : 200, { ok: true, status: r.status === 'ignored' ? 'created' : r.status, redirect: r.redirect });
  });

  // Visitas para cálculo da taxa de conversão (enviado via sendBeacon; aceita text/plain).
  router.add('POST', '/api/public/visit', async (req, res) => {
    if (!rateLimiter.hit(`visit:${req.ip}`, 60, 60_000)) return sendJson(res, 429, { ok: false });
    const raw = await readBody(req, 4096);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { /* ignora */ }
    stats.recordVisit({ visitorId: body.visitor_id, attribution: body.attribution, userAgent: req.headers['user-agent'] });
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  });

  router.add('GET', '/api/public/schedule', (req, res) => {
    const info = live.publicInfo();
    sendJson(res, 200, { ok: true, now: clock(), ...info, links: { channel: info.links.channel, watch: info.links.watch } });
  });

  // Descadastro: via página (JSON) e via List-Unsubscribe one-click (RFC 8058, form-urlencoded).
  router.add('POST', '/api/public/unsubscribe', async (req, res, { query }) => {
    if (!rateLimiter.hit(`unsub:${req.ip}`, 30, 10 * 60_000)) throw new HttpError(429, 'Muitas tentativas.');
    const ct = String(req.headers['content-type'] || '');
    let token = query.get('t');
    let channel = query.get('channel') || 'email';
    if (ct.includes('application/json')) {
      const b = await readJson(req, 4096);
      token = b.t || token;
      channel = b.channel || channel;
    } else {
      await readBody(req, 4096);
    }
    if (!['email', 'whatsapp', 'all', 'erase'].includes(channel)) throw new HttpError(400, 'Opção inválida.');
    const data = signer.verify('unsub', token);
    if (!data) throw new HttpError(400, 'Link inválido.');
    const sub = subscribers.findByPublicId(data.s);
    if (!sub) return sendJson(res, 200, { ok: true, done: channel });
    const now = clock();
    if (channel === 'erase') {
      subscribers.erase(sub.id, now);
      events.emit('subscriber.erased', { publicId: sub.public_id, email: sub.email });
      ctx.audit.write(null, 'subscriber.erase.self', { id: sub.public_id }, null);
    } else {
      if (channel === 'email' || channel === 'all') subscribers.revokeConsent(sub.id, 'email', now);
      if (channel === 'whatsapp' || channel === 'all') subscribers.revokeConsent(sub.id, 'whatsapp', now);
      events.emit('subscriber.unsubscribed', { subscriber: sub, channel });
    }
    sendJson(res, 200, { ok: true, done: channel });
  });

  router.add('GET', '/healthz', (req, res) => {
    ctx.db.prepare('SELECT 1').get();
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/robots.txt', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /confirmacao\nDisallow: /descadastro\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
  });

  router.add('GET', '/sitemap.xml', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${config.baseUrl}/</loc></url><url><loc>${config.baseUrl}/privacidade</loc></url></urlset>\n`);
  });

  router.add('GET', /^\/(favicon\.png|favicon\.svg|og\.jpg|apple-touch-icon\.png|site\.webmanifest|bitcoin-coin\.png|verum-icon\.png|presenter\.jpg)$/, (req, res, { url }) => {
    if (!serveFile(req, res, config.publicDir, url.pathname, { maxAge: 86400 })) pages.notFound(req, res);
  });
  router.add('GET', /^\/favicon\.ico$/, (req, res) => redirect(res, '/favicon.png', 301));

  router.add('GET', /^\/uploads\/presenter-[a-f0-9]{16}\.(webp|jpg|png)$/, (req, res, { url }) => {
    if (!serveFile(req, res, config.uploadsDir, url.pathname.replace('/uploads/', ''), { maxAge: 31536000 })) pages.notFound(req, res);
  });
}

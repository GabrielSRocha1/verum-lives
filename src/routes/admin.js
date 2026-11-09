// API do painel administrativo. Sessão por cookie HttpOnly/SameSite=Strict + cabeçalho CSRF em toda operação.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readBody, sendJson, parseCookies, serializeCookie, HttpError, isAllowedOrigin } from '../lib/http.js';
import { toCsv } from '../lib/text.js';
import { safeEqual } from '../lib/crypto.js';
import { formatPhone } from '../lib/validation.js';
import { zonedParts } from '../lib/schedule.js';
import { CONSENT_TEXTS, CONSENT_VERSION, TEMPLATE_VARS } from '../settings/defaults.js';

export function registerAdminRoutes(router, ctx) {
  const { config, auth, audit, stats, subscribers, settings, reminders, channels, integrations, live, events, clock, rateLimiter, pages } = ctx;
  const cookieName = config.secureCookies ? '__Host-verum_adm' : 'verum_adm';

  function requireSession(req, { role = 'viewer', csrf = true } = {}) {
    const token = parseCookies(req)[cookieName];
    const s = auth.session(token);
    if (!s) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    if (csrf) {
      if (!isAllowedOrigin(config, req.headers.origin)) throw new HttpError(403, 'Origem não permitida.');
      const h = String(req.headers['x-csrf-token'] || '');
      if (!h || !safeEqual(h, s.csrf)) {
        throw new HttpError(403, 'Token de segurança inválido. Recarregue o painel.');
      }
    }
    if (role === 'admin' && s.role !== 'admin') throw new HttpError(403, 'Seu perfil não tem permissão para esta ação.');
    return s;
  }
  const ipHash = (req) => auth.ipHash(req.ip);

  router.add('GET', '/admin', (req, res) => pages.admin(req, res));

  router.add('POST', '/api/admin/login', async (req, res) => {
    if (!isAllowedOrigin(config, req.headers.origin)) throw new HttpError(403, 'Origem não permitida.');
    if (!rateLimiter.hit(`login:${req.ip}`, config.rateLimits.loginPerIp, config.rateLimits.loginWindowMs)) {
      throw new HttpError(429, 'Muitas tentativas de login. Aguarde 15 minutos.');
    }
    const b = await readJson(req, 4096);
    const r = auth.login(b.email, b.password, req.ip);
    if (r.error) {
      audit.write(r.admin ? { id: r.admin.id, email: r.admin.email } : { email: String(b.email || '').slice(0, 120) }, 'login.fail', { reason: r.error }, ipHash(req));
      throw new HttpError(r.error === 'locked' ? 423 : 401, r.error === 'locked' ? 'Conta bloqueada temporariamente por excesso de tentativas. Tente em 15 minutos.' : 'E-mail ou senha incorretos.');
    }
    audit.write(r.admin, 'login.ok', null, ipHash(req));
    sendJson(res, 200, { ok: true, admin: r.admin, csrf: r.csrf }, {
      'Set-Cookie': serializeCookie(cookieName, r.token, { secure: config.secureCookies, maxAge: config.sessionTtlMs })
    });
  });

  router.add('POST', '/api/admin/logout', (req, res) => {
    const token = parseCookies(req)[cookieName];
    try { requireSession(req); } catch { /* sai mesmo assim */ }
    auth.logout(token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': serializeCookie(cookieName, '', { secure: config.secureCookies, maxAge: 0 }) });
  });

  // Retorna sessão e CSRF (usado ao recarregar o painel com cookie válido).
  router.add('GET', '/api/admin/me', (req, res) => {
    const s = auth.session(parseCookies(req)[cookieName]);
    if (!s) return sendJson(res, 200, { ok: false });
    sendJson(res, 200, { ok: true, admin: { id: s.id, email: s.email, role: s.role }, csrf: s.csrf });
  });

  router.add('GET', '/api/admin/overview', (req, res, { query }) => {
    requireSession(req);
    const days = Math.min(Math.max(parseInt(query.get('days'), 10) || 30, 1), 365);
    sendJson(res, 200, { ok: true, ...stats.overview({ days }), next: live.upcoming(2).map((o) => ({ start: o.start, weekday: o.weekday, date: o.date, time: o.time })) });
  });

  const fmtDate = (ms) => {
    if (!ms) return '';
    const z = zonedParts(ms, live.schedule().timezone);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(z.day)}/${p(z.month)}/${z.year} ${p(z.hour)}:${p(z.minute)}`;
  };

  const publicRow = (s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone ? formatPhone(s.phone) : '',
    country: s.country,
    consentEmail: !!s.consent_email,
    consentWhatsapp: !!s.consent_whatsapp,
    origin: s.origin,
    utm_source: s.utm_source,
    utm_medium: s.utm_medium,
    utm_campaign: s.utm_campaign,
    utm_content: s.utm_content,
    createdAt: s.created_at,
    createdAtLabel: fmtDate(s.created_at),
    registrations: s.registration_count
  });

  function filtered(query) {
    const q = String(query.get('q') || '').trim().toLowerCase().slice(0, 100);
    const campaign = query.get('campaign') || null;
    const origin = query.get('origin') || null;
    if (!q) return { q, campaign, origin };
    let rows = subscribers.allActive();
    if (campaign) rows = rows.filter((r) => (r.utm_campaign || '(sem campanha)') === campaign);
    if (origin) rows = rows.filter((r) => r.origin === origin);
    const digits = q.replace(/\D/g, '');
    rows = rows.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.email || '').includes(q) || (digits.length >= 4 && (r.phone || '').includes(digits)));
    return { q, campaign, origin, rows };
  }

  router.add('GET', '/api/admin/subscribers', (req, res, { query }) => {
    const s = requireSession(req, { role: 'admin' });
    const pageSize = Math.min(Math.max(parseInt(query.get('pageSize'), 10) || 25, 5), 200);
    const page = Math.max(parseInt(query.get('page'), 10) || 1, 1);
    const f = filtered(query);
    let total;
    let rows;
    if (f.rows) {
      total = f.rows.length;
      rows = f.rows.slice((page - 1) * pageSize, page * pageSize);
    } else {
      const r = subscribers.list({ limit: pageSize, offset: (page - 1) * pageSize, campaign: f.campaign, origin: f.origin });
      total = r.total;
      rows = r.rows;
    }
    if (page === 1) audit.write(s, 'subscribers.view', { q: f.q ? '[busca]' : null, campaign: f.campaign }, ipHash(req));
    sendJson(res, 200, { ok: true, total, page, pageSize, rows: rows.map(publicRow) });
  });

  router.add('GET', '/api/admin/subscribers.csv', (req, res, { query }) => {
    const s = requireSession(req, { role: 'admin' });
    const f = filtered(query);
    const rows = f.rows || subscribers.allActive().filter((r) => (!f.campaign || (r.utm_campaign || '(sem campanha)') === f.campaign) && (!f.origin || r.origin === f.origin));
    const csv = toCsv(
      ['data_inscricao', 'nome', 'email', 'whatsapp', 'link_whatsapp', 'pais', 'aceita_email', 'aceita_whatsapp', 'origem', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'inscricoes'],
      rows.map((r) => [fmtDate(r.created_at), r.name, r.email, r.phone ? formatPhone(r.phone).replace(/^\+/, '') : '', r.phone ? `https://wa.me/${r.phone}` : '', r.country, r.consent_email ? 'sim' : 'não', r.consent_whatsapp ? 'sim' : 'não',
        r.origin, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.utm_term, r.registration_count])
    );
    audit.write(s, 'subscribers.export', { count: rows.length, campaign: f.campaign, origin: f.origin }, ipHash(req));
    const stamp = new Date(clock()).toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="inscritos-verum-${stamp}.csv"`,
      'Cache-Control': 'no-store'
    });
    res.end(csv);
  });

  router.add('DELETE', '/api/admin/subscribers/:id', (req, res, { params }) => {
    const s = requireSession(req, { role: 'admin' });
    const sub = subscribers.findById(parseInt(params.id, 10));
    if (!sub || sub.deleted_at) throw new HttpError(404, 'Inscrito não encontrado.');
    subscribers.erase(sub.id, clock());
    events.emit('subscriber.erased', { publicId: sub.public_id, email: sub.email });
    audit.write(s, 'subscriber.erase', { id: sub.public_id }, ipHash(req));
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/admin/settings', (req, res) => {
    requireSession(req, { role: 'admin' });
    sendJson(res, 200, { ok: true, settings: settings.all(), templateVars: TEMPLATE_VARS, consent: { version: CONSENT_VERSION, texts: CONSENT_TEXTS } });
  });

  router.add('PUT', '/api/admin/settings/:section', async (req, res, { params }) => {
    const s = requireSession(req, { role: 'admin' });
    const body = await readJson(req, 64 * 1024);
    const r = settings.update(params.section, body, s.email);
    if (r.errors) throw new HttpError(422, r.errors.join(' '), { errors: r.errors });
    audit.write(s, 'settings.update', { section: params.section }, ipHash(req));
    if (params.section === 'schedule' || params.section === 'reminders') reminders.kick();
    sendJson(res, 200, { ok: true, value: r.value });
  });

  // Upload da foto do apresentador (o painel redimensiona para WebP antes do envio). Valida assinatura do arquivo.
  router.add('POST', '/api/admin/presenter-photo', async (req, res) => {
    const s = requireSession(req, { role: 'admin' });
    const buf = await readBody(req, 2 * 1024 * 1024);
    let ext = null;
    if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') ext = 'webp';
    else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
    else if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
    if (!ext) throw new HttpError(415, 'Envie uma imagem WebP, JPEG ou PNG.');
    const name = `presenter-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, name), buf, { mode: 0o644 });
    const previous = settings.get('presenter').photo;
    settings.update('presenter', { photo: `/uploads/${name}` }, s.email);
    if (previous && previous !== `/uploads/${name}`) {
      try { fs.unlinkSync(path.join(config.uploadsDir, path.basename(previous))); } catch { /* já removida */ }
    }
    audit.write(s, 'presenter.photo', { file: name }, ipHash(req));
    sendJson(res, 200, { ok: true, photo: `/uploads/${name}` });
  });

  router.add('DELETE', '/api/admin/presenter-photo', (req, res) => {
    const s = requireSession(req, { role: 'admin' });
    const previous = settings.get('presenter').photo;
    settings.update('presenter', { photo: '' }, s.email);
    if (previous) { try { fs.unlinkSync(path.join(config.uploadsDir, path.basename(previous))); } catch { /* já removida */ } }
    audit.write(s, 'presenter.photo.remove', null, ipHash(req));
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/admin/integrations', (req, res) => {
    requireSession(req, { role: 'admin' });
    const out = {
      channels: Object.values(channels).map((c) => ({ name: c.name, label: c.label, ...c.status() })),
      integrations: integrations.map((i) => ({ name: i.name, ...i.status() })),
      turnstile: { configured: ctx.antispam.turnstileEnabled() },
      deliveries: reminders.summary(),
      plan: reminders.plan(12),
      webhooks: {
        whatsapp: `${config.baseUrl}/api/webhooks/whatsapp`,
        brevo: config.brevo.webhookToken ? `${config.baseUrl}/api/webhooks/brevo/<BREVO_WEBHOOK_TOKEN>` : null
      }
    };
    sendJson(res, 200, { ok: true, ...out });
  });

  // Envia uma etapa como teste para o e-mail do próprio administrador logado.
  router.add('POST', '/api/admin/test-email', async (req, res) => {
    const s = requireSession(req, { role: 'admin' });
    if (!rateLimiter.hit(`test-email:${s.id}`, 10, 60 * 60_000)) throw new HttpError(429, 'Limite de testes atingido. Tente mais tarde.');
    const b = await readJson(req, 4096);
    const step = settings.get('reminders').steps.find((x) => x.key === b.step);
    if (!step) throw new HttpError(400, 'Etapa inválida.');
    const fake = { name: 'Administrador Teste', email: s.email, public_id: 'teste' };
    const vars = live.vars(fake, null);
    try {
      const r = await channels.email.send({ subscriber: fake, step, vars, unsubscribeUrl: config.baseUrl });
      if (r.skipped) throw new HttpError(409, r.skipped);
      audit.write(s, 'test.email', { step: step.key }, ipHash(req));
      sendJson(res, 200, { ok: true, to: s.email });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `Brevo recusou o envio: ${e.message}`);
    }
  });

  router.add('GET', '/api/admin/audit', (req, res) => {
    requireSession(req, { role: 'admin' });
    sendJson(res, 200, { ok: true, rows: audit.list(200) });
  });

  router.add('POST', '/api/admin/password', async (req, res) => {
    const s = requireSession(req);
    const b = await readJson(req, 4096);
    const err = auth.changePassword(s.id, b.current, b.next);
    if (err) throw new HttpError(422, err);
    audit.write(s, 'password.change', null, ipHash(req));
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': serializeCookie(cookieName, '', { secure: config.secureCookies, maxAge: 0 }) });
  });
}

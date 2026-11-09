import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startMockProviders, startTestApp, register } from './support.js';

let mock;
let t;
const PASS = 'Verum-Painel-2026!';
before(async () => { mock = await startMockProviders(); });
after(async () => { await mock.close(); if (t) await t.close(); });
beforeEach(async () => {
  if (t) await t.close();
  mock.reset();
  t = await startTestApp({ mock });
  t.ctx.auth.createAdmin('admin@verum.test', PASS, 'admin');
  t.ctx.auth.createAdmin('leitor@verum.test', PASS, 'viewer');
});

async function login(email = 'admin@verum.test', password = PASS, ip = '192.0.2.1') {
  const r = await t.req('POST', '/api/admin/login', { json: { email, password }, headers: { 'X-Forwarded-For': ip } });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { r, cookie, csrf: r.json?.csrf, h: (extra = {}) => ({ Cookie: cookie, 'X-CSRF-Token': r.json?.csrf, ...extra }) };
}

test('login: cookie seguro, erro genérico, bloqueio após 5 falhas e trilha de auditoria', async () => {
  assert.equal((await t.req('GET', '/api/admin/overview')).status, 401);
  const bad = await login('admin@verum.test', 'errada');
  assert.equal(bad.r.status, 401);
  assert.equal(bad.r.json.error, 'E-mail ou senha incorretos.');
  assert.equal((await login('ninguem@verum.test', 'x')).r.json.error, 'E-mail ou senha incorretos.', 'não revela se o e-mail existe');

  const ok = await login();
  assert.equal(ok.r.status, 200);
  const sc = ok.r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  assert.equal(ok.r.json.admin.role, 'admin');

  for (let i = 0; i < 5; i++) await login('leitor@verum.test', 'errada', '192.0.2.50');
  const locked = await login('leitor@verum.test', PASS, '192.0.2.50');
  assert.equal(locked.r.status, 423, 'conta bloqueada mesmo com a senha certa');
  t.advance(16 * 60_000);
  assert.equal((await login('leitor@verum.test', PASS, '192.0.2.51')).r.status, 200, 'desbloqueia após 15 min');

  const actions = t.ctx.audit.list().map((a) => a.action);
  assert.ok(actions.includes('login.fail') && actions.includes('login.ok'));
});

test('limite de tentativas de login por IP', async () => {
  for (let i = 0; i < 10; i++) await login(`x${i}@verum.test`, 'errada', '192.0.2.99');
  assert.equal((await login('admin@verum.test', PASS, '192.0.2.99')).r.status, 429);
});

test('CSRF e origem são exigidos nas operações do painel', async () => {
  const s = await login();
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: { Cookie: s.cookie } })).status, 403, 'sem token CSRF');
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: { Cookie: s.cookie, 'X-CSRF-Token': 'falso' } })).status, 403);
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: s.h({ Origin: 'https://atacante.example' }) })).status, 403);
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: s.h() })).status, 200);
  const me = await t.req('GET', '/api/admin/me', { headers: { Cookie: s.cookie } });
  assert.equal(me.json.csrf, s.csrf, 'painel recupera o CSRF ao recarregar');
});

test('painel: indicadores, lista descriptografada, busca, filtro, exportação CSV e exclusão (LGPD)', async () => {
  await t.req('POST', '/api/public/visit', { raw: JSON.stringify({ visitor_id: 'vis-admin-0001', attribution: { utm_campaign: 'bitcoin-ouro-nov' } }), contentType: 'text/plain' });
  await register(t);
  await register(t, { name: 'João Pedro Alves', email: 'joao@exemplo.com', phone: '(21) 99876-5432', consent_email: false, attribution: { utm_source: 'tiktok', utm_campaign: 'tiktok-nov' } });
  const s = await login();

  const ov = await t.req('GET', '/api/admin/overview?days=30', { headers: s.h() });
  assert.equal(ov.json.totals.subscribers, 2);
  assert.equal(ov.json.totals.consentEmail, 1);
  assert.equal(ov.json.totals.consentWhatsapp, 2);
  assert.ok(ov.json.campaigns.find((c) => c.campaign === 'tiktok-nov' && c.registrations === 1));
  assert.equal(ov.json.next[0].weekday, 'terça-feira');

  const list = await t.req('GET', '/api/admin/subscribers?page=1', { headers: s.h() });
  assert.equal(list.json.total, 2);
  const joao = list.json.rows.find((r) => r.email === 'joao@exemplo.com');
  assert.equal(joao.name, 'João Pedro Alves');
  assert.equal(joao.phone, '+55 21 99876-5432');
  assert.equal(joao.consentEmail, false);
  assert.equal(joao.origin, 'tiktok');
  assert.match(joao.createdAtLabel, /^09\/11\/2026 10:00$/);

  const search = await t.req('GET', '/api/admin/subscribers?q=pedro', { headers: s.h() });
  assert.deepEqual(search.json.rows.map((r) => r.email), ['joao@exemplo.com']);
  const byPhone = await t.req('GET', '/api/admin/subscribers?q=987654321', { headers: s.h() });
  assert.deepEqual(byPhone.json.rows.map((r) => r.email), ['maria.souza@exemplo.com']);
  const byCamp = await t.req('GET', '/api/admin/subscribers?campaign=bitcoin-ouro-nov', { headers: s.h() });
  assert.equal(byCamp.json.total, 1);

  const csv = await t.req('GET', '/api/admin/subscribers.csv', { headers: s.h() });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /inscritos-verum-2026-11-09\.csv/);
  assert.ok(csv.text.startsWith('﻿data_inscricao;nome;email;whatsapp'));
  assert.match(csv.text, /João Pedro Alves;joao@exemplo\.com;55 21 99876-5432;https:\/\/wa\.me\/5521998765432;BR;não;sim;tiktok/);
  assert.equal((await t.req('GET', '/api/admin/subscribers.csv', { headers: { Cookie: s.cookie } })).status, 403, 'exportar exige CSRF');

  const del = await t.req('DELETE', `/api/admin/subscribers/${joao.id}`, { headers: s.h() });
  assert.equal(del.status, 200);
  assert.equal((await t.req('GET', '/api/admin/subscribers', { headers: s.h() })).json.total, 1);
  assert.equal((await t.req('DELETE', `/api/admin/subscribers/${joao.id}`, { headers: s.h() })).status, 404);
  const actions = t.ctx.audit.list().map((a) => a.action);
  for (const a of ['subscribers.view', 'subscribers.export', 'subscriber.erase']) assert.ok(actions.includes(a), a);
});

test('perfil leitura vê só indicadores agregados', async () => {
  await register(t);
  const v = await login('leitor@verum.test');
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: v.h() })).status, 200);
  for (const [m, p] of [['GET', '/api/admin/subscribers'], ['GET', '/api/admin/subscribers.csv'], ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings/links'], ['GET', '/api/admin/integrations'], ['GET', '/api/admin/audit']]) {
    const r = await t.req(m, p, { headers: v.h(), json: m === 'PUT' ? {} : undefined });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});

test('configurações: agenda, links, rastreamento e lembretes refletem na página', async () => {
  const s = await login();
  let r = await t.req('PUT', '/api/admin/settings/links', { headers: s.h(), json: { youtubeChannel: 'https://www.youtube.com/@verumcripto', liveUrl: '', whatsappGroup: 'http://grupo' } });
  assert.equal(r.status, 422);
  r = await t.req('PUT', '/api/admin/settings/schedule', { headers: s.h(), json: { days: [1, 3, 5], time: '20:30', timezone: 'America/Sao_Paulo', timezoneLabel: 'horário de Brasília', durationMinutes: 90 } });
  assert.equal(r.status, 200);
  r = await t.req('PUT', '/api/admin/settings/tracking', { headers: s.h(), json: { metaPixelId: '123456789012345', ga4Id: 'G-TEST1234', gtmId: 'GTM-TEST12', requireConsent: true } });
  assert.equal(r.status, 200);
  const page = await t.req('GET', '/');
  assert.match(page.text, /SEGUNDAS, QUARTAS E SEXTAS-FEIRAS — <span class="hl">20H30/);
  assert.match(page.text, /"metaPixelId":"123456789012345"/);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /connect\.facebook\.net/);
  assert.match(csp, /googletagmanager\.com/);

  const cfg = await t.req('GET', '/api/admin/settings', { headers: s.h() });
  const steps = cfg.json.settings.reminders.steps;
  steps.find((x) => x.key === 'd1').email.subject = 'Amanhã tem live, {{primeiro_nome}}!';
  steps.find((x) => x.key === 'd1').whatsapp.template = 'Inválido Com Espaço';
  assert.equal((await t.req('PUT', '/api/admin/settings/reminders', { headers: s.h(), json: { steps } })).status, 422);
  steps.find((x) => x.key === 'd1').whatsapp.template = 'lembrete_d1';
  assert.equal((await t.req('PUT', '/api/admin/settings/reminders', { headers: s.h(), json: { steps } })).status, 200);
  assert.equal(t.ctx.settings.get('reminders').steps.find((x) => x.key === 'd1').email.subject, 'Amanhã tem live, {{primeiro_nome}}!');
  assert.equal((await t.req('PUT', '/api/admin/settings/desconhecida', { headers: s.h(), json: {} })).status, 422);

  const integ = await t.req('GET', '/api/admin/integrations', { headers: s.h() });
  assert.ok(integ.json.channels.every((c) => c.configured));
  assert.equal(integ.json.plan[0].step, 'h3', 'segunda 20h30 → aviso de 3h às 17h30 de hoje');
  assert.match(integ.json.webhooks.whatsapp, /\/api\/webhooks\/whatsapp$/);
});

test('e-mail de teste vai para o administrador logado', async () => {
  const s = await login();
  const r = await t.req('POST', '/api/admin/test-email', { headers: s.h(), json: { step: 'd1' } });
  assert.equal(r.status, 200, r.text);
  const [mail] = mock.by('/v3/smtp/email');
  assert.equal(mail.body.to[0].email, 'admin@verum.test');
  assert.equal((await t.req('POST', '/api/admin/test-email', { headers: s.h(), json: { step: 'x' } })).status, 400);
});

test('foto do apresentador: valida assinatura do arquivo e aparece na landing', async () => {
  const s = await login();
  const fake = await t.req('POST', '/api/admin/presenter-photo', { headers: s.h(), raw: Buffer.from('<?php echo 1; ?>') });
  assert.equal(fake.status, 415);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
  const up = await t.req('POST', '/api/admin/presenter-photo', { headers: s.h(), raw: png });
  assert.equal(up.status, 200);
  assert.match(up.json.photo, /^\/uploads\/presenter-[a-f0-9]{16}\.png$/);
  const img = await t.req('GET', up.json.photo);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const page = await t.req('GET', '/');
  assert.ok(page.text.includes(`src="${up.json.photo}"`));
  assert.doesNotMatch(page.text, /<div class="presenter-monogram"/);
  assert.equal((await t.req('DELETE', '/api/admin/presenter-photo', { headers: s.h() })).status, 200);
  assert.equal((await t.req('GET', up.json.photo)).status, 404);
  assert.match((await t.req('GET', '/')).text, /<div class="presenter-monogram"/);
});

test('logout e troca de senha encerram a sessão', async () => {
  const s = await login();
  assert.equal((await t.req('POST', '/api/admin/password', { headers: s.h(), json: { current: PASS, next: 'fraca' } })).status, 422);
  assert.equal((await t.req('POST', '/api/admin/password', { headers: s.h(), json: { current: 'errada', next: 'Nova-Senha-Forte-2026' } })).status, 422);
  assert.equal((await t.req('POST', '/api/admin/password', { headers: s.h(), json: { current: PASS, next: 'Nova-Senha-Forte-2026' } })).status, 200);
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: s.h() })).status, 401);
  const s2 = await login('admin@verum.test', 'Nova-Senha-Forte-2026');
  assert.equal(s2.r.status, 200);
  await t.req('POST', '/api/admin/logout', { headers: s2.h() });
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: s2.h() })).status, 401);
  t.ctx.db.prepare('SELECT 1').get();
});

test('sessão expira após o tempo configurado', async () => {
  const s = await login();
  t.advance(13 * 3600_000);
  assert.equal((await t.req('GET', '/api/admin/overview', { headers: s.h() })).status, 401);
});

test('página do painel: noindex, CSP sem domínios de terceiros e sem estilos inline', async () => {
  const r = await t.req('GET', '/admin');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.doesNotMatch(r.headers.get('content-security-policy'), /facebook|google-analytics/);
  assert.doesNotMatch(r.text, /\sstyle="/);
});

// ---------- Webhooks ----------
const waSign = (raw) => 'sha256=' + crypto.createHmac('sha256', 'wa-app-secret').update(raw).digest('hex');

test('webhook WhatsApp: verificação, assinatura, "SAIR" (wa_id sem o 9) e status de entrega', async () => {
  let r = await t.req('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=987');
  assert.equal(r.status, 200);
  assert.equal(r.text, '987');
  assert.equal((await t.req('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status, 403);

  const tpl = t.ctx.settings.get('reminders');
  tpl.steps[0].whatsapp.template = 'confirmacao';
  t.ctx.settings.update('reminders', tpl, 'teste');
  await register(t);
  await t.settle();
  const wamid = t.ctx.db.prepare("SELECT provider_message_id FROM deliveries WHERE channel = 'whatsapp'").get().provider_message_id;

  const payload = JSON.stringify({ entry: [{ changes: [{ value: {
    messages: [{ from: '551187654321', type: 'text', text: { body: '  Sair ' } }],
    statuses: [{ id: wamid, status: 'read' }]
  } }] }] });
  r = await t.req('POST', '/api/webhooks/whatsapp', { raw: payload, contentType: 'application/json', headers: { 'X-Hub-Signature-256': 'sha256=00' } });
  assert.equal(r.status, 401);
  r = await t.req('POST', '/api/webhooks/whatsapp', { raw: payload, contentType: 'application/json', headers: { 'X-Hub-Signature-256': waSign(payload) } });
  assert.equal(r.status, 200);
  const sub = t.ctx.subscribers.findByEmail('maria.souza@exemplo.com');
  assert.equal(sub.consent_whatsapp, 0);
  assert.equal(sub.consent_email, 1, 'e-mail continua autorizado');
  assert.equal(t.ctx.db.prepare('SELECT provider_status FROM deliveries WHERE provider_message_id = ?').get(wamid).provider_status, 'read');
  await t.ctx.events.idle();
  assert.ok(mock.by('/n8n').some((c) => c.body.event === 'subscriber.unsubscribed' && c.body.data.channel === 'whatsapp'));

  const other = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '5511987654321', type: 'text', text: { body: 'Quero saber mais' } }] } }] }] });
  await t.req('POST', '/api/webhooks/whatsapp', { raw: other, contentType: 'application/json', headers: { 'X-Hub-Signature-256': waSign(other) } });
});

test('webhook Brevo: token obrigatório e descadastro/bounce revogam o e-mail', async () => {
  await register(t);
  const body = JSON.stringify({ event: 'hard_bounce', email: 'Maria.Souza@exemplo.com' });
  assert.equal((await t.req('POST', '/api/webhooks/brevo/errado', { raw: body, contentType: 'application/json' })).status, 401);
  const r = await t.req('POST', '/api/webhooks/brevo/brevo-hook-token', { raw: body, contentType: 'application/json' });
  assert.equal(r.status, 200);
  assert.equal(t.ctx.subscribers.findByEmail('maria.souza@exemplo.com').consent_email, 0);
});

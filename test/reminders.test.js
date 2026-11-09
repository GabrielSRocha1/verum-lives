import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockProviders, startTestApp, register } from './support.js';

// Live de terça 10/11/2026 às 19h (Brasília) = 22:00Z.
const LIVE = Date.parse('2026-11-10T22:00:00Z');
const MIN = 60_000;

let mock;
let t;
before(async () => { mock = await startMockProviders(); });
after(async () => { await mock.close(); if (t) await t.close(); });
beforeEach(async () => {
  if (t) await t.close();
  mock.reset();
  t = await startTestApp({ mock, now: Date.parse('2026-11-06T12:00:00Z') });
  const r = t.ctx.settings.get('reminders');
  for (const s of r.steps) s.whatsapp.template = `lembrete_${s.key}`;
  t.ctx.settings.update('reminders', r, 'teste');
  t.ctx.settings.update('links', { youtubeChannel: 'https://www.youtube.com/@verumcripto', liveUrl: 'https://youtube.com/live/abc123', whatsappGroup: 'https://chat.whatsapp.com/G1' }, 'teste');
});

const sentFor = (step, channel) => t.ctx.db.prepare(
  "SELECT s.id FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id WHERE d.step_key = ? AND d.channel = ? AND d.status = 'sent' AND d.occurrence = ?"
).all(step, channel, new Date(LIVE).toISOString()).map((r) => r.id).sort();

test('sequência completa respeita horários, consentimentos e data de inscrição', async () => {
  const A = (await register(t, { email: 'a@exemplo.com' })).json && t.ctx.subscribers.findByEmail('a@exemplo.com').id;
  await register(t, { email: 'b@exemplo.com', consent_whatsapp: false });
  const B = t.ctx.subscribers.findByEmail('b@exemplo.com').id;
  await register(t, { email: 'c@exemplo.com', consent_email: false, consent_whatsapp: false });
  await t.settle();
  mock.reset();

  // D-3: sábado 07/11 19h → apenas e-mail (padrão), A e B.
  t.clock.now = LIVE - 3 * 1440 * MIN + 5000;
  await t.settle();
  assert.deepEqual(sentFor('d3', 'email'), [A, B].sort());
  assert.deepEqual(sentFor('d3', 'whatsapp'), [], 'WhatsApp desligado nesta etapa por padrão');

  // Inscrito depois do D-3 não recebe o D-3, mas recebe as etapas seguintes.
  t.advance(2 * 3600_000);
  await register(t, { email: 'd@exemplo.com' });
  const D = t.ctx.subscribers.findByEmail('d@exemplo.com').id;

  // D-1: segunda 09/11 19h → e-mail + WhatsApp.
  t.clock.now = LIVE - 1440 * MIN + 1000;
  await t.settle();
  assert.deepEqual(sentFor('d1', 'email'), [A, B, D].sort());
  assert.deepEqual(sentFor('d1', 'whatsapp'), [A, D].sort());
  assert.ok(!sentFor('d3', 'email').includes(D));

  // Rodar de novo não duplica.
  const before = mock.calls.length;
  await t.settle();
  assert.equal(mock.calls.length, before, 'idempotente');

  // H-3, M-30 e início.
  t.clock.now = LIVE - 180 * MIN + 1000; await t.settle();
  t.clock.now = LIVE - 30 * MIN + 1000; await t.settle();
  t.clock.now = LIVE + 1000; await t.settle();
  assert.deepEqual(sentFor('h3', 'email'), [A, B, D].sort());
  assert.deepEqual(sentFor('m30', 'whatsapp'), [A, D].sort());
  assert.deepEqual(sentFor('start', 'whatsapp'), [A, D].sort());
  assert.deepEqual(sentFor('start', 'email'), [], 'e-mail desligado no início por padrão');

  const m30 = mock.by('/v21.0/123456/messages').find((c) => c.body.template.name === 'lembrete_m30');
  assert.deepEqual(m30.body.template.components[0].parameters.map((p) => p.text), ['Maria', 'https://youtube.com/live/abc123']);
  const h3 = mock.by('/v3/smtp/email').find((c) => /Hoje às 19h/.test(c.body.subject));
  assert.match(h3.body.textContent, /https:\/\/youtube\.com\/live\/abc123/);

  // Nenhuma mensagem para quem não autorizou.
  const C = t.ctx.subscribers.findByEmail('c@exemplo.com').id;
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) c FROM deliveries WHERE subscriber_id = ?').get(C).c, 0);
});

test('janela de tolerância: servidor fora do ar não dispara lembrete atrasado', async () => {
  await register(t);
  await t.settle();
  mock.reset();
  t.clock.now = LIVE - 1440 * MIN + 45 * MIN; // 45 min após o horário do D-1 (tolerância padrão: 20 min)
  await t.settle();
  assert.equal(mock.by('/v3/smtp/email').length, 0);
});

test('retentativa com backoff em falha temporária e desistência em erro definitivo', async () => {
  await register(t, { consent_whatsapp: false });
  await t.settle();
  mock.reset();
  mock.failNext('/v3/smtp/email', 503, 1);
  t.clock.now = LIVE - 1440 * MIN + 1000;
  await t.settle();
  let d = t.ctx.db.prepare("SELECT * FROM deliveries WHERE step_key = 'd1'").get();
  assert.equal(d.status, 'failed');
  assert.equal(d.attempts, 1);
  assert.match(d.last_error, /503/);
  t.advance(61_000);
  await t.settle();
  d = t.ctx.db.prepare("SELECT * FROM deliveries WHERE step_key = 'd1'").get();
  assert.equal(d.status, 'sent');
  assert.equal(d.attempts, 2);

  mock.failNext('/v3/smtp/email', 400, 1);
  t.clock.now = LIVE - 180 * MIN + 1000;
  await t.settle();
  d = t.ctx.db.prepare("SELECT * FROM deliveries WHERE step_key = 'h3'").get();
  assert.equal(d.status, 'failed');
  assert.equal(d.attempts, t.config.dispatcher.maxAttempts, 'erro 4xx não é repetido');
  t.advance(3600_000);
  const calls = mock.calls.length;
  await t.settle();
  assert.equal(mock.calls.length, calls);
});

test('mensagem vencida é descartada (aviso de 30 min não sai depois do início)', async () => {
  await register(t, { consent_whatsapp: false });
  await t.settle();
  mock.reset();
  mock.failNext('/v3/smtp/email', 503, 10);
  t.clock.now = LIVE - 30 * MIN + 1000;
  await t.settle();
  t.clock.now = LIVE + 31 * MIN;
  await t.settle();
  const d = t.ctx.db.prepare("SELECT * FROM deliveries WHERE step_key = 'm30'").get();
  assert.equal(d.status, 'skipped');
  assert.equal(d.last_error, 'expirado');
});

test('consentimento revogado entre o agendamento e o envio é respeitado', async () => {
  await register(t);
  await t.settle();
  mock.reset();
  mock.failNext('/v3/smtp/email', 503, 1);
  t.clock.now = LIVE - 1440 * MIN + 1000;
  await t.settle();
  const sub = t.ctx.subscribers.findByEmail('maria.souza@exemplo.com');
  t.ctx.subscribers.revokeConsent(sub.id, 'email', t.clock.now);
  t.advance(61_000);
  await t.settle();
  const d = t.ctx.db.prepare("SELECT * FROM deliveries WHERE step_key = 'd1' AND channel = 'email'").get();
  assert.equal(d.status, 'skipped');
  assert.equal(d.last_error, 'sem consentimento no momento do envio');
});

test('etapa desativada, canal sem modelo e WhatsApp não configurado ficam registrados como ignorados', async () => {
  const r = t.ctx.settings.get('reminders');
  r.steps.find((s) => s.key === 'd1').whatsapp.template = '';
  r.steps.find((s) => s.key === 'h3').enabled = false;
  t.ctx.settings.update('reminders', r, 'teste');
  await register(t);
  await t.settle();
  t.clock.now = LIVE - 1440 * MIN + 1000;
  await t.settle();
  const wa = t.ctx.db.prepare("SELECT * FROM deliveries WHERE step_key = 'd1' AND channel = 'whatsapp'").get();
  assert.equal(wa.status, 'skipped');
  assert.match(wa.last_error, /Modelo do WhatsApp não definido/);
  t.clock.now = LIVE - 180 * MIN + 1000;
  await t.settle();
  assert.equal(t.ctx.db.prepare("SELECT COUNT(*) c FROM deliveries WHERE step_key = 'h3'").get().c, 0);
});

test('mudança de agenda no painel reprograma os lembretes (quarta às 20h, fuso de Assunção)', async () => {
  t.ctx.settings.update('schedule', { days: [3], time: '20:00', timezone: 'America/Asuncion', timezoneLabel: 'horário de Assunção', durationMinutes: 60 }, 'teste');
  await register(t, { consent_whatsapp: false });
  await t.settle();
  mock.reset();
  const wed = Date.parse('2026-11-11T23:00:00Z');
  t.clock.now = wed - 1440 * MIN + 1000;
  await t.settle();
  const [mail] = mock.by('/v3/smtp/email');
  assert.ok(mail);
  assert.match(mail.body.subject, /É amanhã: live às 20h/);
  assert.match(mail.body.textContent, /11 de novembro, às 20h \(horário de Assunção\)/);
  const plan = t.ctx.reminders.plan(3);
  assert.equal(plan[0].step, 'h3');
  assert.equal(plan[0].at, wed - 180 * MIN);
});

test('dispatcher automático: confirmação sai sem chamada manual', async () => {
  await t.close();
  mock.reset();
  t = await startTestApp({ mock, env: { DISPATCHER_ENABLED: '1', DISPATCHER_INTERVAL_MS: '60000' } });
  t.ctx.reminders.start();
  await register(t, { consent_whatsapp: false });
  for (let i = 0; i < 50 && !mock.by('/v3/smtp/email').length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(mock.by('/v3/smtp/email').length, 1);
});

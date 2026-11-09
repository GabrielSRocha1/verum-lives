import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startMockProviders, startTestApp, register, validBody } from './support.js';
import { signN8nPayload } from '../src/integrations/n8n.js';

let mock;
let t;
before(async () => { mock = await startMockProviders(); });
after(async () => { await mock.close(); });
beforeEach(async () => {
  if (t) await t.close();
  mock.reset();
  t = await startTestApp({ mock });
  // Modelo aprovado do WhatsApp para a confirmação + link do grupo.
  const r = t.ctx.settings.get('reminders');
  r.steps.find((s) => s.key === 'confirmation').whatsapp.template = 'confirmacao_inscricao';
  t.ctx.settings.update('reminders', r, 'teste');
  t.ctx.settings.update('links', { youtubeChannel: 'https://www.youtube.com/@verumcripto', liveUrl: '', whatsappGroup: 'https://chat.whatsapp.com/GrupoVerum123' }, 'teste');
});
after(async () => { if (t) await t.close(); });

test('landing: HTML completo, CSP com nonce, cabeçalhos de segurança e SEO', async () => {
  const r = await t.req('GET', '/');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /%%[A-Z_]+%%/, 'nenhum placeholder sobrando');
  const csp = r.headers.get('content-security-policy');
  const nonce = csp.match(/'nonce-([^']+)'/)[1];
  const scripts = [...r.text.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 4);
  for (const attrs of scripts) assert.ok(attrs.includes(`nonce="${nonce}"`), `script sem nonce: ${attrs}`);
  assert.doesNotMatch(r.text, /\sstyle="/, 'sem estilos inline bloqueados pela CSP');
  assert.doesNotMatch(r.text, /\son[a-z]+="/, 'sem handlers inline');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.text, /BITCOIN: OURO DIGITAL!/);
  assert.match(r.text, /TERÇAS E QUINTAS-FEIRAS — <span class="hl">19H/);
  assert.match(r.text, /QUERO GARANTIR MINHA INSCRIÇÃO GRATUITA/);
  assert.match(r.text, /CONFIRMAR MINHA INSCRIÇÃO GRATUITA/);
  assert.match(r.text, /Especialista em Blockchain e C\.E\.O do ecossistema Verum\./);
  assert.match(r.text, /href="https:\/\/www\.youtube\.com\/@verumcripto"/);
  const ld = JSON.parse(r.text.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'Event');
  assert.equal(ld.startDate, '2026-11-10T22:00:00.000Z');
  const boot = JSON.parse(r.text.match(/window\.__BOOT=(\{[\s\S]*?\});document/)[1]);
  assert.equal(boot.occurrences[0].start, Date.parse('2026-11-10T22:00:00Z'));
  assert.equal(boot.tracking.requireConsent, true);
  assert.ok(!('whatsappGroup' in boot.links), 'link do grupo não vaza na landing');
  // Consentimentos nunca vêm pré-marcados (LGPD).
  assert.doesNotMatch(r.text, /type="checkbox"[^>]*checked/);
});

test('inscrição completa: grava criptografado, confirma por e-mail e WhatsApp, sincroniza Brevo e n8n', async () => {
  const r = await register(t, {}, { 'Idempotency-Key': 'chave-unica-001', 'X-Forwarded-For': '203.0.113.9' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'created');
  assert.match(r.json.redirect, /^\/confirmacao\?c=/);

  const row = t.ctx.db.prepare('SELECT * FROM subscribers').get();
  const raw = JSON.stringify(row);
  assert.ok(!raw.includes('maria.souza@exemplo.com'), 'e-mail não fica em claro');
  assert.ok(!raw.includes('987654321'), 'telefone não fica em claro');
  assert.ok(!raw.includes('Maria Souza'), 'nome não fica em claro');
  assert.ok(!raw.includes('203.0.113.9'), 'IP não fica em claro');
  assert.equal(row.utm_campaign, 'bitcoin-ouro-nov');
  assert.equal(row.origin, 'instagram');
  assert.equal(row.consent_email, 1);
  assert.equal(row.consent_whatsapp, 1);
  assert.equal(row.created_at, t.clock.now, 'data/hora da inscrição registrada');
  assert.equal(row.consent_version, '2026-11-v1');

  await t.settle();
  const [mail] = mock.by('/v3/smtp/email');
  assert.ok(mail, 'e-mail de confirmação enviado');
  assert.equal(mail.headers['api-key'], 'brevo-test-key');
  assert.equal(mail.body.to[0].email, 'maria.souza@exemplo.com');
  assert.match(mail.body.subject, /^Maria, sua inscrição está confirmada/);
  assert.match(mail.body.textContent, /terça-feira, 10 de novembro, às 19h \(horário de Brasília\)/);
  assert.match(mail.body.textContent, /https:\/\/chat\.whatsapp\.com\/GrupoVerum123/);
  assert.match(mail.body.headers['List-Unsubscribe'], /\/descadastro\?t=/);

  const [wa] = mock.by('/v21.0/123456/messages');
  assert.ok(wa, 'WhatsApp de confirmação enviado');
  assert.equal(wa.headers.authorization, 'Bearer wa-test-token');
  assert.equal(wa.body.to, '5511987654321');
  assert.equal(wa.body.template.name, 'confirmacao_inscricao');
  assert.deepEqual(wa.body.template.components[0].parameters.map((p) => p.text), ['Maria', '10 de novembro', '19h']);

  const [contact] = mock.by('/v3/contacts');
  assert.deepEqual(contact.body.listIds, [7]);
  assert.equal(contact.body.attributes.FIRSTNAME, 'Maria');
  assert.equal(contact.body.attributes.WHATSAPP, '+5511987654321');

  const [hook] = mock.by('/n8n');
  assert.equal(hook.headers['x-verum-event'], 'subscriber.created');
  assert.equal(hook.headers['x-verum-signature'], signN8nPayload('n8n-secret', hook.headers['x-verum-timestamp'], hook.raw));
  assert.equal(hook.body.data.email, 'maria.souza@exemplo.com');
  assert.equal(hook.body.data.attribution.utm_campaign, 'bitcoin-ouro-nov');

  const deliveries = t.ctx.db.prepare("SELECT channel, status, provider_message_id FROM deliveries WHERE step_key = 'confirmation' ORDER BY channel").all();
  assert.deepEqual(deliveries.map((d) => [d.channel, d.status]), [['email', 'sent'], ['whatsapp', 'sent']]);
  assert.equal(deliveries[1].provider_message_id, 'wamid.TEST1');
});

test('página de confirmação: conversão disparada uma única vez e botão do grupo', async () => {
  const r = await register(t);
  const page = await t.req('GET', r.json.redirect);
  assert.equal(page.status, 200);
  assert.match(page.text, /PARABÉNS!|Parabéns!/);
  assert.match(page.text, /Sua inscrição foi confirmada\./);
  assert.match(page.text, /<strong>Maria<\/strong>, você está a um passo/);
  assert.match(page.text, /href="https:\/\/chat\.whatsapp\.com\/GrupoVerum123"[^>]*id="group-link"/);
  assert.match(page.text, /ENTRAR NO GRUPO EXCLUSIVO DO WHATSAPP/);
  assert.match(page.text, /A participação no grupo é opcional\./);
  const boot = JSON.parse(page.text.match(/window\.__BOOT=(\{[\s\S]*?\});<\/script>/)[1]);
  const sub = t.ctx.db.prepare('SELECT public_id FROM subscribers').get();
  assert.deepEqual(boot.conversion, { eventId: sub.public_id });

  const again = await t.req('GET', r.json.redirect);
  const boot2 = JSON.parse(again.text.match(/window\.__BOOT=(\{[\s\S]*?\});<\/script>/)[1]);
  assert.equal(boot2.conversion, null, 'recarregar não duplica a conversão');

  assert.equal((await t.req('GET', '/confirmacao')).status, 302, 'sem token não há página de conversão');
  assert.equal((await t.req('GET', r.json.redirect.slice(0, -3) + 'abc')).status, 302, 'token adulterado');
  t.advance(3 * 3600_000);
  assert.equal((await t.req('GET', r.json.redirect)).status, 302, 'token expira');
});

test('sem link do grupo configurado: não exibe botão sem ação', async () => {
  t.ctx.settings.update('links', { youtubeChannel: '', liveUrl: '', whatsappGroup: '' }, 'teste');
  const r = await register(t);
  const page = await t.req('GET', r.json.redirect);
  assert.doesNotMatch(page.text, /id="group-link"/);
  assert.match(page.text, /será disponibilizado em breve/);
});

test('duplicidade: mesmo e-mail não cria segundo registro nem segunda conversão', async () => {
  const a = await register(t);
  const b = await register(t, { email: 'MARIA.SOUZA@exemplo.com', consent_whatsapp: false, attribution: { utm_campaign: 'outra' } });
  assert.equal(b.status, 200);
  assert.equal(b.json.status, 'existing');
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) c FROM subscribers').get().c, 1);
  const row = t.ctx.db.prepare('SELECT * FROM subscribers').get();
  assert.equal(row.registration_count, 2);
  assert.equal(row.consent_whatsapp, 0, 'a manifestação mais recente prevalece');
  assert.equal(row.utm_campaign, 'bitcoin-ouro-nov', 'origem original preservada');
  const page = await t.req('GET', b.json.redirect);
  assert.match(page.text, /"conversion":null/);
  assert.ok(a.json.redirect !== b.json.redirect);
});

test('clique duplo / envio simultâneo: um único inscrito', async () => {
  const token = t.formToken();
  t.advance(1500);
  const body = { ...validBody(), form_token: token };
  const same = await Promise.all([1, 2, 3].map(() => t.req('POST', '/api/public/register', { json: body, headers: { 'Idempotency-Key': 'mesma-chave-123' } })));
  assert.equal(new Set(same.map((r) => r.json.redirect)).size, 1, 'mesma resposta para a mesma chave');
  const diff = await Promise.all([1, 2].map((i) => t.req('POST', '/api/public/register', { json: body, headers: { 'Idempotency-Key': `outra-chave-${i}00` } })));
  assert.ok(diff.every((r) => r.status === 200 || r.status === 201));
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) c FROM subscribers').get().c, 1);
  await t.settle();
  assert.equal(mock.by('/v3/smtp/email').length, 1, 'uma única confirmação');
});

test('validação: erros por campo (422) e nada é gravado', async () => {
  const r = await register(t, { name: 'Ana', email: 'ana@', phone: '(20) 1234' });
  assert.equal(r.status, 422);
  assert.ok(r.json.fields.name && r.json.fields.email && r.json.fields.phone);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) c FROM subscribers').get().c, 0);
});

test('sem autorizações: inscreve, mas não envia nada', async () => {
  const r = await register(t, { consent_email: false, consent_whatsapp: false });
  assert.equal(r.status, 201);
  await t.settle();
  assert.equal(mock.by('/v3/smtp/email').length, 0);
  assert.equal(mock.by(/\/messages$/).length, 0);
  assert.equal(mock.by('/v3/contacts').length, 0, 'não entra na lista de e-mail');
  const page = await t.req('GET', r.json.redirect);
  assert.match(page.text, /grupo é a melhor forma/);
});

test('antispam: token ausente, envio rápido, honeypot, origem cruzada e limite por IP', async () => {
  let r = await t.req('POST', '/api/public/register', { json: validBody() });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'form_token');

  const tok = t.formToken();
  t.advance(200);
  r = await t.req('POST', '/api/public/register', { json: { ...validBody(), form_token: tok } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'too_fast');

  r = await register(t, { empresa_site: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.equal(t.ctx.db.prepare('SELECT COUNT(*) c FROM subscribers').get().c, 0, 'robô descartado');

  const old = t.formToken();
  t.advance(7 * 3600_000);
  r = await t.req('POST', '/api/public/register', { json: { ...validBody(), form_token: old } });
  assert.equal(r.json.code, 'form_token', 'token expirado');

  r = await t.req('POST', '/api/public/register', { json: { ...validBody(), form_token: t.formToken() }, headers: { Origin: 'https://site-falso.example' } });
  assert.equal(r.status, 403);

  r = await t.req('POST', '/api/public/register', { raw: 'name=x', contentType: 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
});

test('limite de inscrições por IP', async () => {
  await t.close();
  t = await startTestApp({ mock, env: { RL_REGISTER_PER_IP: '3' } });
  const ip = { 'X-Forwarded-For': '198.51.100.7' };
  for (let i = 0; i < 3; i++) assert.notEqual((await register(t, { email: `p${i}@exemplo.com` }, ip)).status, 429);
  const r = await register(t, { email: 'p9@exemplo.com' }, ip);
  assert.equal(r.status, 429);
  assert.notEqual((await register(t, { email: 'outro@exemplo.com' }, { 'X-Forwarded-For': '198.51.100.8' })).status, 429);
});

test('Turnstile: exige token humano quando configurado', async () => {
  await t.close();
  t = await startTestApp({ mock, env: { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_VERIFY_URL: `${mock.base}/turnstile` } });
  const page = await t.req('GET', '/');
  assert.match(page.headers.get('content-security-policy'), /challenges\.cloudflare\.com/);
  assert.equal((await register(t, { turnstile_token: 'robo' })).json.code, 'captcha');
  assert.equal((await register(t, { turnstile_token: 'token-humano' })).status, 201);
});

test('visitas e taxa de conversão por campanha', async () => {
  for (let i = 0; i < 4; i++) {
    await t.req('POST', '/api/public/visit', { raw: JSON.stringify({ visitor_id: `vis-camp-${i}000`, attribution: { utm_source: 'instagram', utm_campaign: 'bitcoin-ouro-nov' } }), contentType: 'text/plain' });
  }
  await t.req('POST', '/api/public/visit', { raw: JSON.stringify({ visitor_id: 'vis-camp-0000', attribution: {} }), contentType: 'text/plain' });
  const bot = await t.req('POST', '/api/public/visit', { raw: JSON.stringify({ visitor_id: 'robo-12345678' }), contentType: 'text/plain', headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
  assert.equal(bot.status, 204);
  await register(t);
  const ov = t.ctx.stats.overview({ days: 30 });
  assert.equal(ov.totals.visitors, 4, 'visitante único por dia; robôs ignorados');
  assert.equal(ov.totals.subscribers, 1);
  assert.equal(ov.totals.conversionRate, 0.25);
  const camp = ov.campaigns.find((c) => c.campaign === 'bitcoin-ouro-nov');
  assert.equal(camp.visitors, 4);
  assert.equal(camp.registrations, 1);
  assert.equal(ov.series.at(-1).registrations, 1);
});

test('agenda pública, .ics e arquivos estáticos protegidos', async () => {
  const s = await t.req('GET', '/api/public/schedule');
  assert.equal(s.json.daysLabel, 'terças e quintas-feiras');
  assert.equal(s.json.occurrences.length, 6);
  assert.ok(!('whatsappGroup' in s.json.links));
  const ics = await t.req('GET', '/agenda.ics');
  assert.match(ics.text, /RRULE:FREQ=WEEKLY;BYDAY=TU,TH/);
  assert.match(ics.text, /DTSTART:20261110T220000Z/);
  for (const p of ['/uploads/../.dev-keys.json', '/uploads/%2e%2e/verum-lives.sqlite', '/../package.json', '/favicon.svg/../../src/config.js']) {
    const r = await t.req('GET', p);
    assert.ok([404, 405].includes(r.status), `${p} → ${r.status}`);
  }
  assert.equal((await t.req('GET', '/favicon.svg')).status, 200);
  assert.equal((await t.req('GET', '/og.jpg')).status, 200);
  const robots = await t.req('GET', '/robots.txt');
  assert.match(robots.text, /Disallow: \/admin/);
});

test('descadastro por link: e-mail, one-click (RFC 8058) e exclusão total', async () => {
  await register(t);
  await t.settle();
  const sub = t.ctx.subscribers.findByEmail('maria.souza@exemplo.com');
  const link = t.ctx.live.unsubscribeUrl(sub);
  const token = new URL(link).searchParams.get('t');
  const page = await t.req('GET', `/descadastro?t=${encodeURIComponent(token)}`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /class="invalid"/);

  let r = await t.req('POST', '/api/public/unsubscribe', { json: { t: token, channel: 'whatsapp' } });
  assert.equal(r.status, 200);
  assert.equal(t.ctx.subscribers.findById(sub.id).consent_whatsapp, 0);

  r = await t.req('POST', `/api/public/unsubscribe?t=${encodeURIComponent(token)}&channel=email`, { raw: 'List-Unsubscribe=One-Click', contentType: 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 200);
  const after1 = t.ctx.subscribers.findById(sub.id);
  assert.equal(after1.consent_email, 0);
  assert.ok(after1.unsub_email_at);
  await t.ctx.events.idle();
  assert.ok(mock.by('/v3/contacts/lists/7/contacts/remove').length >= 1, 'removido da lista da Brevo');

  r = await t.req('POST', '/api/public/unsubscribe', { json: { t: token, channel: 'erase' } });
  assert.equal(r.status, 200);
  const erased = t.ctx.db.prepare('SELECT * FROM subscribers WHERE id = ?').get(sub.id);
  assert.equal(erased.email_enc, null);
  assert.equal(erased.name_enc, null);
  assert.equal(erased.phone_enc, null);
  assert.ok(erased.deleted_at);
  await t.ctx.events.idle();
  assert.ok(mock.by('/n8n').some((c) => c.body.event === 'subscriber.erased'));
  assert.equal((await t.req('POST', '/api/public/unsubscribe', { json: { t: 'falso', channel: 'email' } })).status, 400);
  assert.equal((await t.req('POST', '/api/public/unsubscribe', { json: { t: token, channel: 'tudo' } })).status, 400);
});

test('reinscrição concede novo canal: confirmação só para o canal recém-autorizado', async () => {
  await register(t, { consent_whatsapp: false });
  await t.settle();
  assert.equal(mock.by(/\/messages$/).length, 0);
  await register(t, { consent_whatsapp: true });
  await t.settle();
  assert.equal(mock.by(/\/messages$/).length, 1);
  assert.equal(mock.by('/v3/smtp/email').length, 1, 'e-mail de confirmação não repete');
});

test('produção sem chaves não inicia (fail-closed)', async () => {
  const { loadConfig } = await import('../src/config.js');
  const saved = { ...process.env };
  for (const k of ['DATA_ENCRYPTION_KEY', 'INDEX_KEY', 'APP_SECRET']) delete process.env[k];
  try {
    assert.throws(() => loadConfig({ skipDotEnv: true, env: { NODE_ENV: 'production', DATA_DIR: t.config.dataDir } }), /obrigatórias ausentes/);
    assert.throws(() => loadConfig({ skipDotEnv: true, env: { NODE_ENV: 'production', DATA_DIR: t.config.dataDir, DATA_ENCRYPTION_KEY: 'curta', INDEX_KEY: crypto.randomBytes(32).toString('hex'), APP_SECRET: crypto.randomBytes(32).toString('hex') } }), /32 bytes/);
  } finally {
    Object.assign(process.env, saved);
  }
});

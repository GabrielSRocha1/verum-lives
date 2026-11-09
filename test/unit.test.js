import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateName, validateEmail, validatePhone, sanitizeAttribution, phoneVariants, validateRegistration } from '../src/lib/validation.js';
import { upcomingOccurrences, zonedToUtc, daysLabel, timeLabel, formatOccurrence, nextOccurrence } from '../src/lib/schedule.js';
import { createCipher, createSigner, hashPassword, verifyPassword } from '../src/lib/crypto.js';
import { toCsv, renderTemplate, textToHtml } from '../src/lib/text.js';
import { validators } from '../src/settings/settings.js';
import { DEFAULT_SETTINGS } from '../src/settings/defaults.js';
import { buildCsp } from '../src/lib/http.js';
import { validatePasswordStrength } from '../src/services/auth.js';

test('nome completo: exige nome e sobrenome, aceita acentos', () => {
  assert.equal(validateName('  José   da  Silva ').value, 'José da Silva');
  assert.equal(validateName("Ana D'Ávila").value, "Ana D'Ávila");
  assert.ok(validateName('Maria').error);
  assert.ok(validateName('').error);
  assert.ok(validateName('João <script>').error);
  assert.ok(validateName('a'.repeat(120) + ' b').error);
});

test('e-mail: normaliza e rejeita formatos inválidos', () => {
  assert.equal(validateEmail(' Fulano.Tal@Gmail.COM ').value, 'fulano.tal@gmail.com');
  for (const bad of ['fulano', 'a@b', 'a..b@x.com', '.a@x.com', 'a@x.c', 'a b@x.com', 'a@-x.com']) assert.ok(validateEmail(bad).error, bad);
});

test('telefone: Brasil com máscara, DDD inválido, fixo, colado com +55', () => {
  assert.deepEqual(validatePhone('BR', '(11) 98765-4321'), { value: '5511987654321', country: 'BR', display: '+55 11 98765-4321' });
  assert.equal(validatePhone('BR', '+55 21 99876-5432').value, '5521998765432');
  assert.equal(validatePhone('BR', '5511987654321').value, '5511987654321');
  assert.equal(validatePhone('BR', '(41) 3333-4444').value, '554133334444');
  assert.ok(validatePhone('BR', '(20) 98765-4321').error, 'DDD 20 não existe');
  assert.ok(validatePhone('BR', '(11) 88765-4321').error, 'celular com 11 dígitos precisa do 9');
  assert.ok(validatePhone('BR', '1234').error);
  assert.ok(validatePhone('XX', '11987654321').error);
});

test('telefone: Paraguai, EUA, Portugal e genérico', () => {
  assert.equal(validatePhone('PY', '0981 123 456').value, '595981123456');
  assert.ok(validatePhone('PY', '021 123 456').error);
  assert.equal(validatePhone('US', '(201) 555-0123').value, '12015550123');
  assert.ok(validatePhone('US', '(101) 555-0123').error);
  assert.equal(validatePhone('PT', '912 345 678').value, '351912345678');
  assert.equal(validatePhone('AR', '11 2345-6789').value, '541123456789');
});

test('variações do wa_id brasileiro (com e sem o 9)', () => {
  assert.deepEqual(phoneVariants('5511987654321').sort(), ['551187654321', '5511987654321'].sort());
  assert.deepEqual(phoneVariants('551187654321').sort(), ['551187654321', '5511987654321'].sort());
});

test('atribuição: sanitiza UTMs e deriva origem', () => {
  const a = sanitizeAttribution({ utm_source: ' Instagram<script> ', utm_campaign: 'x'.repeat(400), referrer: 'https://l.facebook.com/abc' });
  assert.equal(a.utm_source, 'Instagramscript');
  assert.equal(a.utm_campaign.length, 150);
  assert.equal(a.origin, 'instagramscript');
  assert.equal(sanitizeAttribution({ referrer: 'https://www.tiktok.com/@x' }).origin, 'tiktok');
  assert.equal(sanitizeAttribution({ fbclid: 'abc' }).origin, 'facebook');
  assert.equal(sanitizeAttribution({}).origin, 'direto');
  assert.equal(sanitizeAttribution({ referrer: 'nao-e-url' }).referrer_host, null);
});

test('validateRegistration agrega erros por campo', () => {
  const r = validateRegistration({ name: 'A', email: 'x', country: 'BR', phone: '1' });
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'name', 'phone']);
  const ok = validateRegistration({ name: 'Ana Lima', email: 'ana@x.com', country: 'BR', phone: '11987654321', consent_email: 'on' });
  assert.equal(ok.value.consentEmail, true);
  assert.equal(ok.value.consentWhatsapp, false);
});

test('agenda: próximas terças e quintas às 19h (horário de Brasília)', () => {
  const s = { days: [2, 4], time: '19:00', timezone: 'America/Sao_Paulo' };
  const mon = Date.parse('2026-11-09T13:00:00Z');
  const occ = upcomingOccurrences(s, mon, 4).map((t) => new Date(t).toISOString());
  assert.deepEqual(occ, ['2026-11-10T22:00:00.000Z', '2026-11-12T22:00:00.000Z', '2026-11-17T22:00:00.000Z', '2026-11-19T22:00:00.000Z']);
  // Logo após o início da live de terça, a próxima é quinta.
  assert.equal(new Date(nextOccurrence(s, Date.parse('2026-11-10T22:00:01Z'))).toISOString(), '2026-11-12T22:00:00.000Z');
  assert.equal(formatOccurrence(Date.parse('2026-11-10T22:00:00Z'), 'America/Sao_Paulo').weekday, 'terça-feira');
});

test('agenda: fuso com horário de verão (Nova York, fim do DST em 01/11/2026)', () => {
  assert.equal(new Date(zonedToUtc(2026, 10, 31, 19, 0, 'America/New_York')).toISOString(), '2026-10-31T23:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 11, 2, 19, 0, 'America/New_York')).toISOString(), '2026-11-03T00:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 11, 10, 19, 0, 'America/Asuncion')).toISOString(), '2026-11-10T22:00:00.000Z');
});

test('rótulos da agenda', () => {
  assert.equal(daysLabel([4, 2]), 'terças e quintas-feiras');
  assert.equal(daysLabel([2]), 'terças-feiras');
  assert.equal(daysLabel([6, 1, 3]), 'segundas-feiras, quartas-feiras e sábados');
  assert.equal(timeLabel('19:00'), '19h');
  assert.equal(timeLabel('19:26'), '19h26');
});

test('criptografia de campo: ida e volta, adulteração detectada, índice cego estável', () => {
  const c = createCipher(crypto.randomBytes(32), crypto.randomBytes(32));
  const enc = c.encrypt('maria@exemplo.com');
  assert.notEqual(enc, c.encrypt('maria@exemplo.com'), 'IV aleatório');
  assert.equal(c.decrypt(enc), 'maria@exemplo.com');
  const parts = enc.split(':');
  parts[3] = Buffer.from('outra coisa').toString('base64');
  assert.throws(() => c.decrypt(parts.join(':')));
  assert.equal(c.blindIndex('a@b.com', 'email'), c.blindIndex('a@b.com', 'email'));
  assert.notEqual(c.blindIndex('a@b.com', 'email'), c.blindIndex('a@b.com', 'phone'));
});

test('tokens assinados: finalidade, expiração e adulteração', () => {
  const s = createSigner(crypto.randomBytes(32));
  const t = s.issue('confirm', { s: 'abc' }, 1000, 0);
  assert.equal(s.verify('confirm', t, 500).s, 'abc');
  assert.equal(s.verify('confirm', t, 1500), null);
  assert.equal(s.verify('unsub', t, 500), null);
  assert.equal(s.verify('confirm', t.slice(0, -2) + 'xx', 500), null);
  assert.equal(s.verify('confirm', 'lixo', 500), null);
});

test('senhas: scrypt e política de força', () => {
  const h = hashPassword('Senha-Forte-2026');
  assert.ok(verifyPassword('Senha-Forte-2026', h));
  assert.ok(!verifyPassword('senha-errada', h));
  assert.ok(validatePasswordStrength('curta'));
  assert.ok(validatePasswordStrength('somenteletrasminusculas'));
  assert.equal(validatePasswordStrength('Verum-Lives-2026'), null);
});

test('CSV: BOM, separador ";", aspas e proteção contra fórmulas', () => {
  const csv = toCsv(['a', 'b'], [['=HYPERLINK("x")', 'Silva; Souza'], ['+5511', 'linha\nquebrada']]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"Silva; Souza"'));
  assert.ok(csv.includes("'+5511"));
  assert.ok(csv.includes('"linha\nquebrada"'));
});

test('templates de mensagem e HTML seguro', () => {
  assert.equal(renderTemplate('Oi {{primeiro_nome}}, {{desconhecida}}', { primeiro_nome: 'Ana' }), 'Oi Ana, {{desconhecida}}');
  const html = textToHtml('<b>x</b>\n\nhttps://exemplo.com/a?b=1');
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('<a href="https://exemplo.com/a?b=1"'));
});

test('validação de configurações do painel', () => {
  assert.ok(validators.links({ whatsappGroup: 'http://chat.whatsapp.com/x' }).errors.length);
  assert.ok(validators.links({ whatsappGroup: 'https://evil.com/x' }).errors.length);
  assert.equal(validators.links({ whatsappGroup: 'https://chat.whatsapp.com/AbC123', youtubeChannel: 'https://www.youtube.com/@verum' }).errors.length, 0);
  assert.ok(validators.tracking({ metaPixelId: 'abc' }).errors.length);
  assert.ok(validators.tracking({ ga4Id: 'UA-123' }).errors.length);
  assert.equal(validators.tracking({ metaPixelId: '123456789012345', ga4Id: 'g-abc1234', gtmId: 'GTM-ABC123' }).value.ga4Id, 'G-ABC1234');
  assert.ok(validators.schedule({ days: [], time: '19:00', timezone: 'America/Sao_Paulo', durationMinutes: 90 }).errors.length);
  assert.ok(validators.schedule({ days: [2], time: '25:00', timezone: 'Marte/Base', durationMinutes: 90 }).errors.length >= 2);
  const steps = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.reminders.steps));
  assert.equal(validators.reminders({ steps }).errors.length, 0);
  steps[1].offsetMinutes = 60;
  assert.ok(validators.reminders({ steps }).errors.length);
  assert.ok(validators.reminders({ steps: steps.slice(1) }).errors.length);
});

test('CSP: nonce obrigatório e domínios só quando configurados', () => {
  const none = buildCsp('abc', {});
  assert.ok(none.includes("script-src 'nonce-abc' 'strict-dynamic'"));
  assert.ok(!none.includes('facebook'));
  assert.ok(none.includes("frame-ancestors 'none'"));
  const all = buildCsp('abc', { tracking: { metaPixelId: '1', gtmId: 'GTM-X' }, turnstile: true });
  assert.ok(all.includes('https://www.facebook.com') && all.includes('google-analytics.com') && all.includes('challenges.cloudflare.com'));
});

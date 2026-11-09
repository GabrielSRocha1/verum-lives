// Teste de ponta a ponta no navegador (Playwright/Chromium): celular e desktop.
// Cobre: carregamento sem erros/violação de CSP, consentimento de cookies, PageView, contador, máscara e validação
// do formulário, sugestão de e-mail, inscrição real no backend, redirecionamento, CompleteRegistration único,
// botão do grupo do WhatsApp, envios (e-mail/WhatsApp) e o painel administrativo.
// Uso: npm run test:browser   (requer `npm i -D playwright && npx playwright install chromium`)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startMockProviders, startTestApp } from '../test/support.js';

const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const PIXEL = '123456789012345';
const GROUP = 'https://chat.whatsapp.com/GrupoVerumTeste';
let passed = 0;
const check = (cond, msg) => { assert.ok(cond, msg); passed++; console.log(`  ✓ ${msg}`); };

const mock = await startMockProviders();
const t = await startTestApp({ mock, now: 'real', env: { FORM_MIN_FILL_MS: '1500' } });
t.ctx.settings.update('links', { youtubeChannel: 'https://www.youtube.com/@verumcripto', liveUrl: '', whatsappGroup: GROUP }, 'e2e');
t.ctx.settings.update('tracking', { metaPixelId: PIXEL, ga4Id: 'G-E2ETEST1', gtmId: '', requireConsent: true }, 'e2e');
const rem = t.ctx.settings.get('reminders');
rem.steps[0].whatsapp.template = 'confirmacao_inscricao';
t.ctx.settings.update('reminders', rem, 'e2e');
t.ctx.auth.createAdmin('admin@verum.test', 'Verum-Painel-2026!', 'admin');

const browser = await chromium.launch();

async function prepare(context) {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route(/googletagmanager\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__gtagLoaded=true;' }));
  await context.route(/connect\.facebook\.net/, (r) => r.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'window.__fb=window.__fb||[];(window.fbq.queue||[]).forEach(function(a){window.__fb.push(Array.prototype.slice.call(a))});window.fbq.queue=[];window.fbq.callMethod=function(){window.__fb.push(Array.prototype.slice.call(arguments))};'
  }));
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}

function watchErrors(page, bag) {
  page.on('pageerror', (e) => bag.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') bag.push(`console: ${m.text()}`); });
}

try {
  // ======================= CELULAR =======================
  console.log('\nCelular (iPhone 13):');
  const mctx = await browser.newContext({ ...devices['iPhone 13'] });
  await prepare(mctx);
  const page = await mctx.newPage();
  const errors = [];
  watchErrors(page, errors);
  const t0 = Date.now();
  await page.goto(`${t.base}/?utm_source=instagram&utm_medium=paid&utm_campaign=bitcoin-ouro-nov&fbclid=ABC123`, { waitUntil: 'load' });
  check(Date.now() - t0 < 3000, `página carregou em ${Date.now() - t0} ms`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'sem rolagem horizontal no celular');
  await page.screenshot({ path: path.join(shots, 'mobile-1-dobra.png') });

  check(await page.isVisible('#cookie-banner'), 'aviso de cookies exibido antes de ativar o Pixel');
  check(await page.evaluate(() => typeof window.fbq === 'undefined'), 'Meta Pixel não carrega sem consentimento');
  await page.click('#cookie-banner [data-consent="granted"]');
  await page.waitForFunction(() => Array.isArray(window.__fb) && window.__fb.length >= 2);
  const fbLanding = await page.evaluate(() => window.__fb);
  check(fbLanding.some((c) => c[0] === 'init' && c[1] === '123456789012345'), 'Pixel inicializado após aceite');
  check(fbLanding.some((c) => c[0] === 'track' && c[1] === 'PageView'), 'evento PageView disparado');
  check(!fbLanding.some((c) => c[1] === 'CompleteRegistration'), 'nenhuma conversão na landing');
  check(await page.evaluate(() => window.dataLayer.some((a) => a[0] === 'config' && a[1] === 'G-E2ETEST1')), 'GA4 configurado (page_view automático)');

  const s1 = await page.textContent('#cd-s');
  await page.waitForTimeout(1200);
  check(s1 !== (await page.textContent('#cd-s')), 'contador regressivo em funcionamento');
  check(/terça-feira|quinta-feira/.test(await page.textContent('#cd-when')), `próxima live: ${await page.textContent('#cd-when')}`);

  await page.tap('#hero-cta');
  await page.waitForTimeout(700);
  check(await page.evaluate(() => { const r = document.getElementById('reg-form').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; }), 'botão principal leva ao formulário');

  await page.tap('#submit-btn');
  check((await page.textContent('#e-name')).length > 0 && (await page.textContent('#e-email')).length > 0, 'validação dos campos no envio vazio');
  check(await page.evaluate(() => document.activeElement.id === 'f-name'), 'foco vai para o primeiro campo inválido');

  await page.fill('#f-name', 'Carlos Eduardo Teste');
  await page.fill('#f-email', 'carlos.teste@gmial.com');
  await page.locator('#f-email').blur();
  check(await page.isVisible('#e-email .suggest'), 'sugestão de correção de e-mail (gmial → gmail)');
  await page.tap('#e-email .suggest');
  check((await page.inputValue('#f-email')) === 'carlos.teste@gmail.com', 'e-mail corrigido com um toque');
  await page.locator('#f-phone').pressSequentially('11987654321');
  check((await page.inputValue('#f-phone')) === '(11) 98765-4321', 'máscara de telefone brasileira');
  await page.tap('label.check:has(#c-email)');
  await page.tap('label.check:has(#c-wa)');
  check(await page.isChecked('#c-email') && await page.isChecked('#c-wa'), 'autorizações separadas marcadas');

  const small = await page.evaluate(() => [...document.querySelectorAll('.btn, .input, .select, .check input')]
    .filter((el) => el.offsetParent !== null).map((el) => [el.id || el.className, el.getBoundingClientRect().height]).filter(([, h]) => h < 24));
  const btnH = await page.evaluate(() => [...document.querySelectorAll('#submit-btn, #hero-cta, .input, .select')].map((el) => el.getBoundingClientRect().height));
  check(small.length === 0 && Math.min(...btnH) >= 48, `alvos de toque ≥ 48px (menor: ${Math.round(Math.min(...btnH))}px)`);
  await page.screenshot({ path: path.join(shots, 'mobile-2-formulario.png') });

  const tFill = Date.now();
  await Promise.all([page.waitForURL(/\/confirmacao\?c=/), page.tap('#submit-btn')]);
  check(true, `inscrição enviada e redirecionada à confirmação (${Date.now() - tFill} ms)`);
  check(Date.now() - t0 < 60_000, `jornada completa em ${Math.round((Date.now() - t0) / 1000)} s (< 1 minuto)`);

  await page.waitForFunction(() => Array.isArray(window.__fb) && window.__fb.some((c) => c[1] === 'CompleteRegistration'));
  const sub = t.ctx.subscribers.findByEmail('carlos.teste@gmail.com');
  const conv = (await page.evaluate(() => window.__fb)).filter((c) => c[1] === 'CompleteRegistration');
  check(conv.length === 1 && conv[0][3].eventID === sub.public_id, 'CompleteRegistration único com eventID (deduplicação)');
  check(await page.evaluate(() => window.dataLayer.some((e) => e.event === 'complete_registration')), 'evento complete_registration no dataLayer');
  check((await page.getAttribute('#group-link', 'href')) === GROUP, 'botão do grupo aponta para o convite configurado');
  check(/Carlos/.test(await page.textContent('.msg')), 'confirmação personalizada com o nome');
  await page.screenshot({ path: path.join(shots, 'mobile-3-confirmacao.png'), fullPage: true });

  await page.reload();
  await page.waitForTimeout(400);
  check(!(await page.evaluate(() => (window.__fb || []).some((c) => c[1] === 'CompleteRegistration'))), 'recarregar não repete a conversão');

  check(sub.utm_campaign === 'bitcoin-ouro-nov' && sub.utm_source === 'instagram' && sub.fbclid === 'ABC123', 'UTMs e fbclid gravados no banco');
  check(sub.consent_email === 1 && sub.consent_whatsapp === 1 && sub.phone === '5511987654321', 'consentimentos e telefone E.164 gravados');
  await t.settle();
  check(mock.by('/v3/smtp/email').some((c) => c.body.to[0].email === 'carlos.teste@gmail.com'), 'e-mail de confirmação enviado (Brevo)');
  check(mock.by(/\/messages$/).some((c) => c.body.to === '5511987654321'), 'WhatsApp de confirmação enviado (Cloud API)');
  check(t.ctx.db.prepare('SELECT COUNT(*) c FROM visits').get().c >= 1, 'visita registrada para taxa de conversão');

  const csp = await page.evaluate(() => window.__csp);
  const realErrors = errors.filter((e) => !/favicon|ERR_TUNNEL|net::/.test(e));
  check(csp.length === 0, 'nenhuma violação de CSP');
  check(realErrors.length === 0, `nenhum erro de JavaScript${realErrors.length ? ': ' + realErrors.join(' | ') : ''}`);
  await mctx.close();

  // ======================= DESKTOP + PAINEL =======================
  console.log('\nDesktop e painel:');
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(dctx);
  const d = await dctx.newPage();
  const derr = [];
  watchErrors(d, derr);
  await d.goto(t.base + '/');
  await d.click('#cookie-banner [data-consent="denied"]');
  check(await d.evaluate(() => typeof window.fbq === 'undefined'), 'recusar cookies mantém o Pixel desligado');
  await d.screenshot({ path: path.join(shots, 'desktop-1-dobra.png') });
  await d.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
  await d.screenshot({ path: path.join(shots, 'desktop-2-pagina-completa.png'), fullPage: true });

  await d.goto(t.base + '/admin');
  await d.fill('#l-email', 'admin@verum.test');
  await d.fill('#l-pass', 'Verum-Painel-2026!');
  await d.click('#l-btn');
  await d.waitForSelector('#kpis .kpi');
  check((await d.textContent('#kpis')).includes('Total de inscritos'), 'painel autenticado com indicadores');
  check(/bitcoin-ouro-nov/.test(await d.textContent('#camp')), 'inscrições por campanha');
  await d.screenshot({ path: path.join(shots, 'admin-1-visao-geral.png') });
  await d.click('[data-tab="subs"]');
  await d.waitForSelector('#subs tr td');
  check((await d.textContent('#subs')).includes('carlos.teste@gmail.com'), 'lista de inscritos descriptografada');
  const [download] = await Promise.all([d.waitForEvent('download'), d.click('#export')]);
  const csvPath = await download.path();
  check(fs.readFileSync(csvPath, 'utf8').includes('Carlos Eduardo Teste'), `exportação CSV (${download.suggestedFilename()})`);
  await d.screenshot({ path: path.join(shots, 'admin-2-inscritos.png') });
  await d.click('[data-tab="reminders"]');
  await d.waitForSelector('#steps .step');
  check((await d.$$('#steps .step')).length === 6, 'seis etapas de lembrete editáveis');
  await d.screenshot({ path: path.join(shots, 'admin-3-lembretes.png') });
  await d.click('[data-tab="lives"]');
  await d.uncheck('#days input[value="4"]');
  await d.check('#days input[value="3"]');
  await d.click('#f-schedule button');
  await d.waitForTimeout(400);
  await d.goto(t.base + '/');
  check((await d.textContent('.facts li')).includes('TERÇAS E QUARTAS-FEIRAS'), 'alteração da agenda no painel reflete na landing');
  await d.goto(t.base + '/admin');
  await d.waitForSelector('#kpis .kpi');
  await d.click('[data-tab="integrations"]');
  await d.waitForSelector('#int-status tr');
  await d.screenshot({ path: path.join(shots, 'admin-4-integracoes.png') });
  const dErrors = derr.filter((e) => !/favicon|ERR_TUNNEL|net::/.test(e));
  check(dErrors.length === 0, `desktop/painel sem erros de JavaScript${dErrors.length ? ': ' + dErrors.join(' | ') : ''}`);
  await dctx.close();

  console.log(`\n${passed} verificações de navegador aprovadas. Capturas em docs/screenshots/`);
} catch (e) {
  console.error('\nFALHA:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await t.close();
  await mock.close();
}

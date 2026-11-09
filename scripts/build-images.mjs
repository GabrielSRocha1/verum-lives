// Gera public/og.jpg (1200×630, compartilhamento em redes) e public/apple-touch-icon.png (180×180)
// a partir da arte vetorial da landing. Requer Playwright (apenas em desenvolvimento):
//   PLAYWRIGHT_MODULE=/caminho/para/playwright/index.mjs node scripts/build-images.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const landing = fs.readFileSync(path.join(root, 'src/views/templates/landing.html'), 'utf8');
const coin = landing.match(/<div class="hero-visual"[^>]*>\s*(<svg[\s\S]*?<\/svg>)\s*<\/div>/)[1];
const logo = fs.readFileSync(path.join(root, 'src/views/templates/partials/logo.svg'), 'utf8');

const og = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:Inter,"Segoe UI",Arial,sans-serif;color:#fff;
background:radial-gradient(800px 500px at 85% 20%,rgba(40,80,190,.5),transparent 60%),radial-gradient(700px 500px at 0% 100%,rgba(217,169,75,.15),transparent 60%),linear-gradient(160deg,#071027,#04060D)}
.wrap{display:flex;align-items:center;height:100%;padding:0 70px;gap:30px}
.copy{flex:1}
.brand{display:flex;align-items:center;gap:14px;margin-bottom:34px}.brand svg{width:56px;height:46px}
.brand b{font:800 26px/1 Sora,Arial;letter-spacing:.24em;color:#F3DDA0}.brand small{display:block;font:600 13px/1 Inter,Arial;letter-spacing:.22em;color:#A7B2CC;margin-top:6px}
.pill{display:inline-flex;align-items:center;gap:10px;padding:10px 18px;border-radius:999px;border:1px solid rgba(255,80,80,.45);background:rgba(255,59,59,.1);font:800 16px/1 Sora,Arial;letter-spacing:.16em;color:#FFD9D9}
.pill i{width:12px;height:12px;border-radius:50%;background:#FF3B3B}
h1{font:800 76px/.98 Sora,"Arial Black",Arial;margin:22px 0 20px;letter-spacing:-.02em}
h1 span{display:block;white-space:nowrap;background:linear-gradient(100deg,#B98A33,#F6DE9C 45%,#D9A94B 65%,#F2D07A);-webkit-background-clip:text;color:transparent}
.when{font:800 22px/1.2 Sora,Arial;letter-spacing:.06em;color:#F6DE9C}.when em{font-style:normal;color:#fff}
.coin{width:400px;height:400px;flex:none}.coin svg{width:100%;height:100%}
</style></head><body>${logo}<div class="wrap"><div class="copy">
<div class="brand"><svg><use href="#verum-v"/></svg><div><b>VERUM</b><small>CANAL VERUM CRIPTO</small></div></div>
<div class="pill"><i></i>TRANSMISSÕES GRATUITAS AO VIVO</div>
<h1>BITCOIN:<span>OURO DIGITAL!</span></h1>
<div class="when"><em>TERÇAS E QUINTAS</em> · 19H · INSCRIÇÃO GRATUITA</div>
</div><div class="coin">${coin}</div></div></body></html>`;

const icon = `<!doctype html><html><body style="margin:0;width:180px;height:180px;background:#060A16;display:grid;place-items:center">${logo}
<svg style="width:120px;height:100px"><use href="#verum-v"/></svg></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(og);
await page.screenshot({ path: path.join(root, 'public/og.jpg'), type: 'jpeg', quality: 84 });
await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(icon);
await page.screenshot({ path: path.join(root, 'public/apple-touch-icon.png') });
await browser.close();
console.log('Imagens geradas em public/');

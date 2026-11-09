// Camada HTTP mínima sobre node:http: roteador, corpo, cookies, cabeçalhos de segurança e arquivos estáticos.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      const keys = [];
      const re = pattern instanceof RegExp
        ? pattern
        : new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
      routes.push({ method, re, keys, handler });
    },
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    }
  };
}

export function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Conteúdo muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) throw new HttpError(415, 'Envie JSON.');
  const raw = await readBody(req, limit);
  try {
    const obj = JSON.parse(raw.toString('utf8') || '{}');
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw new Error();
    return obj;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || '/'}`, 'HttpOnly', `SameSite=${opts.sameSite || 'Strict'}`];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  return parts.join('; ');
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

export function newNonce() {
  return crypto.randomBytes(16).toString('base64');
}

// CSP por requisição com nonce. Domínios extras só entram quando a integração está configurada.
export function buildCsp(nonce, { tracking = {}, turnstile = false, admin = false } = {}) {
  const script = [`'nonce-${nonce}'`, "'strict-dynamic'", 'https:'];
  const connect = ["'self'"];
  const img = ["'self'", 'data:', 'blob:'];
  const frame = [];
  if (!admin) {
    if (tracking.gtmId || tracking.ga4Id) {
      connect.push('https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com', 'https://www.google.com');
      img.push('https://*.google-analytics.com', 'https://*.googletagmanager.com', 'https://www.google.com', 'https://*.google.com.br');
      frame.push('https://www.googletagmanager.com');
    }
    if (tracking.metaPixelId) {
      connect.push('https://www.facebook.com', 'https://connect.facebook.net');
      img.push('https://www.facebook.com');
    }
    if (turnstile) {
      frame.push('https://challenges.cloudflare.com');
      connect.push('https://challenges.cloudflare.com');
    }
  }
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    `img-src ${img.join(' ')}`,
    `connect-src ${connect.join(' ')}`,
    `frame-src ${frame.length ? frame.join(' ') : "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

export function setSecurityHeaders(res, { secure, csp } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (csp) res.setHeader('Content-Security-Policy', csp);
}

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(html);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

// Serve arquivo de um diretório raiz, bloqueando path traversal e dotfiles.
export function serveFile(req, res, rootDir, relPath, { maxAge = 0 } = {}) {
  const decoded = (() => { try { return decodeURIComponent(relPath); } catch { return null; } })();
  if (!decoded || decoded.includes('\0')) return false;
  const full = path.resolve(rootDir, '.' + path.posix.normalize('/' + decoded));
  if (!full.startsWith(path.resolve(rootDir) + path.sep)) return false;
  if (path.basename(full).startsWith('.')) return false;
  let stat;
  try { stat = fs.statSync(full); } catch { return false; }
  if (!stat.isFile()) return false;
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-cache',
    ETag: etag
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(full).pipe(res);
  return true;
}

// Origem permitida para requisições que alteram estado (domínio principal + ALLOWED_ORIGINS).
export function isAllowedOrigin(config, origin) {
  if (!origin) return true;
  return origin === new URL(config.baseUrl).origin || config.extraOrigins.includes(origin);
}

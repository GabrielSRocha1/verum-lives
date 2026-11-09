// Criptografia de dados pessoais (AES-256-GCM), índice cego (HMAC) para buscas exatas,
// hash de senhas (scrypt) e tokens assinados de curta duração.
import crypto from 'node:crypto';

const VERSION = 'v1';

export function createCipher(dataKey, indexKey) {
  return {
    encrypt(plain) {
      if (plain === null || plain === undefined || plain === '') return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
      const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      const tag = c.getAuthTag();
      return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
    },
    decrypt(payload) {
      if (!payload) return null;
      const [ver, ivB, tagB, encB] = String(payload).split(':');
      if (ver !== VERSION || !encB) throw new Error('Formato de dado criptografado inválido');
      const d = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(ivB, 'base64'));
      d.setAuthTag(Buffer.from(tagB, 'base64'));
      return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
    },
    blindIndex(value, domain = 'generic') {
      if (!value) return null;
      return crypto.createHmac('sha256', indexKey).update(`${domain}:${String(value)}`).digest('base64url');
    }
  };
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB, hashB] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB, 'base64');
    const got = crypto.scryptSync(password, Buffer.from(saltB, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

// Hash fictício para igualar o tempo de resposta quando o usuário não existe.
export const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Tokens assinados: base64url(json).assinatura — com finalidade (purpose) e expiração.
export function createSigner(secret) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    issue(purpose, payload, ttlMs, now = Date.now()) {
      const body = Buffer.from(JSON.stringify({ p: purpose, d: payload, iat: now, exp: ttlMs ? now + ttlMs : 0 })).toString('base64url');
      return `${body}.${sign(`${purpose}.${body}`)}`;
    },
    verify(purpose, token, now = Date.now()) {
      if (typeof token !== 'string' || token.length > 2048) return null;
      const [body, sig] = token.split('.');
      if (!body || !sig) return null;
      if (!safeEqual(sig, sign(`${purpose}.${body}`))) return null;
      try {
        const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (obj.p !== purpose) return null;
        if (obj.exp && now > obj.exp) return null;
        return { ...obj.d, _iat: obj.iat };
      } catch {
        return null;
      }
    },
    hmacHex(data) {
      return crypto.createHmac('sha256', secret).update(data).digest('hex');
    }
  };
}

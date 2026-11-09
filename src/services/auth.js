// Autenticação do painel: senhas scrypt, bloqueio após falhas, sessões com token aleatório (armazenado como hash),
// token CSRF por sessão e papéis (admin = tudo; viewer = apenas indicadores agregados, sem dados pessoais).
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH, randomToken, sha256 } from '../lib/crypto.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

export function validatePasswordStrength(pw) {
  const s = String(pw || '');
  if (s.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (s.length > 200) return 'Senha muito longa.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(s)).length;
  if (classes < 3) return 'Use ao menos 3 tipos: minúsculas, maiúsculas, números e símbolos.';
  return null;
}

export function createAuthService({ db, clock, config, cipher }) {
  const ipHash = (ip) => cipher.blindIndex(ip, 'ip');

  function createAdmin(email, password, role = 'admin') {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('E-mail inválido.');
    if (!['admin', 'viewer'].includes(role)) throw new Error('Papel inválido.');
    const weak = validatePasswordStrength(password);
    if (weak) throw new Error(weak);
    const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(e);
    if (existing) {
      db.prepare('UPDATE admins SET password_hash = ?, role = ?, failed_attempts = 0, locked_until = NULL, disabled = 0 WHERE id = ?')
        .run(hashPassword(password), role, existing.id);
      db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing.id);
      return { id: existing.id, email: e, role, updated: true };
    }
    const r = db.prepare('INSERT INTO admins (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(e, hashPassword(password), role, clock());
    return { id: Number(r.lastInsertRowid), email: e, role, updated: false };
  }

  function bootstrap() {
    const count = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
    if (count === 0 && config.adminBootstrap.email && config.adminBootstrap.password) {
      createAdmin(config.adminBootstrap.email, config.adminBootstrap.password, 'admin');
      return true;
    }
    return false;
  }

  function login(email, password, ip) {
    const now = clock();
    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!admin) {
      verifyPassword(String(password || ''), DUMMY_PASSWORD_HASH);
      return { error: 'invalid' };
    }
    if (admin.disabled) return { error: 'invalid' };
    if (admin.locked_until && admin.locked_until > now) return { error: 'locked', until: admin.locked_until };
    if (!verifyPassword(String(password || ''), admin.password_hash)) {
      const fails = admin.failed_attempts + 1;
      db.prepare('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now + LOCK_MS : null, admin.id);
      return { error: fails >= MAX_FAILS ? 'locked' : 'invalid', admin };
    }
    db.prepare('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now, admin.id);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    const token = randomToken(32);
    const csrf = randomToken(24);
    db.prepare('INSERT INTO sessions (id_hash, admin_id, csrf, created_at, expires_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), admin.id, csrf, now, now + config.sessionTtlMs, ipHash(ip));
    return { token, csrf, admin: { id: admin.id, email: admin.email, role: admin.role } };
  }

  function session(token) {
    if (!token || token.length > 200) return null;
    const row = db.prepare(`SELECT s.csrf, s.expires_at, a.id, a.email, a.role, a.disabled FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.id_hash = ?`).get(sha256(token));
    if (!row || row.disabled || row.expires_at < clock()) return null;
    return { id: row.id, email: row.email, role: row.role, csrf: row.csrf };
  }

  function logout(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  }

  function changePassword(adminId, current, next) {
    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(adminId);
    if (!admin || !verifyPassword(String(current || ''), admin.password_hash)) return 'Senha atual incorreta.';
    const weak = validatePasswordStrength(next);
    if (weak) return weak;
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(next), adminId);
    db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId);
    return null;
  }

  return { createAdmin, bootstrap, login, session, logout, changePassword, ipHash };
}

export function createAuditLog(db, clock) {
  return {
    write(admin, action, detail, ipHashValue) {
      db.prepare('INSERT INTO audit_log (at, admin_id, admin_email, action, detail, ip_hash) VALUES (?, ?, ?, ?, ?, ?)')
        .run(clock(), admin?.id ?? null, admin?.email ?? null, action, detail ? JSON.stringify(detail) : null, ipHashValue || null);
    },
    list(limit = 100) {
      return db.prepare('SELECT at, admin_email, action, detail FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
    }
  };
}

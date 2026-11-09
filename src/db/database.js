// Banco SQLite embutido (node:sqlite). Migrações versionadas via PRAGMA user_version.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  // 1 — esquema inicial
  `
  CREATE TABLE subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    name_enc TEXT,
    email_enc TEXT,
    email_idx TEXT UNIQUE,
    phone_enc TEXT,
    phone_idx TEXT,
    country TEXT,
    consent_email INTEGER NOT NULL DEFAULT 0,
    consent_email_at INTEGER,
    consent_whatsapp INTEGER NOT NULL DEFAULT 0,
    consent_whatsapp_at INTEGER,
    consent_version TEXT,
    consent_ip_hash TEXT,
    unsub_email_at INTEGER,
    unsub_whatsapp_at INTEGER,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
    fbclid TEXT, gclid TEXT, ttclid TEXT,
    landing_url TEXT,
    referrer_host TEXT,
    origin TEXT,
    visitor_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_registered_at INTEGER NOT NULL,
    registration_count INTEGER NOT NULL DEFAULT 1,
    conversion_fired_at INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX idx_sub_created ON subscribers(created_at);
  CREATE INDEX idx_sub_campaign ON subscribers(utm_campaign);
  CREATE INDEX idx_sub_origin ON subscribers(origin);
  CREATE INDEX idx_sub_phone ON subscribers(phone_idx);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
  );

  CREATE TABLE visits (
    visitor_id TEXT NOT NULL,
    day TEXT NOT NULL,
    origin TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (visitor_id, day)
  );
  CREATE INDEX idx_visits_day ON visits(day);
  CREATE INDEX idx_visits_campaign ON visits(utm_campaign);

  CREATE TABLE deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
    occurrence TEXT NOT NULL,
    step_key TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_error TEXT,
    provider_message_id TEXT,
    provider_status TEXT,
    created_at INTEGER NOT NULL,
    sent_at INTEGER,
    UNIQUE (subscriber_id, occurrence, step_key, channel)
  );
  CREATE INDEX idx_deliv_due ON deliveries(status, next_attempt_at);
  CREATE INDEX idx_deliv_provider ON deliveries(provider_message_id);

  CREATE TABLE reminder_runs (
    occurrence TEXT NOT NULL,
    step_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    queued INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (occurrence, step_key)
  );

  CREATE TABLE admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip_hash TEXT
  );
  CREATE INDEX idx_sessions_exp ON sessions(expires_at);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    admin_id INTEGER,
    admin_email TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip_hash TEXT
  );
  CREATE INDEX idx_audit_at ON audit_log(at);
  `
];

export function openDatabase(file) {
  const isNew = file !== ':memory:' && !fs.existsSync(file);
  const db = new DatabaseSync(file);
  if (isNew) {
    try { fs.chmodSync(file, 0o600); } catch { /* plataforma sem chmod */ }
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

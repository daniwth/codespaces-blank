import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
try {
  chmodSync(config.dataDir, 0o700);
} catch {
  // Not owner of the directory: keep existing permissions.
}

const dbPath = join(config.dataDir, 'hash-harvest.db');
export const db = new DatabaseSync(dbPath);
try {
  chmodSync(dbPath, 0o600);
} catch {
  // ignore
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    stripe_customer_id TEXT,
    plan TEXT,
    sub_id TEXT,
    sub_status TEXT NOT NULL DEFAULT 'none',
    period_end INTEGER NOT NULL DEFAULT 0,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS saves (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    blob TEXT NOT NULL,
    checksum TEXT NOT NULL,
    save_version INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    summary TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL
  );
`);

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
  stripe_customer_id: string | null;
  plan: string | null;
  sub_id: string | null;
  sub_status: string;
  period_end: number;
  cancel_at_period_end: number;
}

export interface SaveSummary {
  lifetimeEarnings: string;
  playTimeSec: number;
  halvings: number;
  scLifetime: number;
  gpuCount: number;
}

export interface SaveRow {
  user_id: string;
  blob: string;
  checksum: string;
  save_version: number;
  revision: number;
  updated_at: number;
  summary: string;
}

const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userByCustomer: db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
  insertUser: db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  setCustomer: db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?'),
  setSubscription: db.prepare(
    'UPDATE users SET plan = ?, sub_id = ?, sub_status = ?, period_end = ?, cancel_at_period_end = ? WHERE id = ?',
  ),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionUser: db.prepare(
    'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  saveByUser: db.prepare('SELECT * FROM saves WHERE user_id = ?'),
  saveMetaByUser: db.prepare('SELECT revision, updated_at, summary, save_version, checksum FROM saves WHERE user_id = ?'),
  upsertSave: db.prepare(`
    INSERT INTO saves (user_id, blob, checksum, save_version, revision, updated_at, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET blob = excluded.blob, checksum = excluded.checksum,
      save_version = excluded.save_version, revision = excluded.revision,
      updated_at = excluded.updated_at, summary = excluded.summary
  `),
  insertEvent: db.prepare('INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)'),
  hasEvent: db.prepare('SELECT 1 AS hit FROM webhook_events WHERE id = ?'),
  purgeEvents: db.prepare('DELETE FROM webhook_events WHERE received_at < ?'),
  setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  expireDemoSubs: db.prepare(
    "UPDATE users SET sub_status = 'canceled', period_end = 0, cancel_at_period_end = 0 WHERE sub_id LIKE 'demo\\_%' ESCAPE '\\' AND sub_status <> 'canceled'",
  ),
};

const asUser = (row: unknown): UserRow | undefined => (row ? (row as UserRow) : undefined);

export const users = {
  byId: (id: string) => asUser(q.userById.get(id)),
  byEmail: (email: string) => asUser(q.userByEmail.get(email)),
  byCustomer: (customerId: string) => asUser(q.userByCustomer.get(customerId)),
  insert: (id: string, email: string, passwordHash: string) => q.insertUser.run(id, email, passwordHash, Date.now()),
  remove: (id: string) => q.deleteUser.run(id),
  setCustomer: (id: string, customerId: string) => q.setCustomer.run(customerId, id),
  setPasswordHash: (id: string, hash: string) => q.setPassword.run(hash, id),
  /** Demo subscriptions are void once real billing is enabled. Returns rows changed. */
  expireDemoSubscriptions: () => Number(q.expireDemoSubs.run().changes),
  setSubscription: (
    id: string,
    sub: { plan: string | null; subId: string | null; status: string; periodEnd: number; cancelAtPeriodEnd: boolean },
  ) => q.setSubscription.run(sub.plan, sub.subId, sub.status, sub.periodEnd, sub.cancelAtPeriodEnd ? 1 : 0, id),
};

export const sessions = {
  insert: (tokenHash: string, userId: string, expiresAt: number) => q.insertSession.run(tokenHash, userId, Date.now(), expiresAt),
  user: (tokenHash: string) => asUser(q.sessionUser.get(tokenHash, Date.now())),
  remove: (tokenHash: string) => q.deleteSession.run(tokenHash),
  purgeExpired: () => q.purgeSessions.run(Date.now()),
};

export const saves = {
  get: (userId: string) => {
    const row = q.saveByUser.get(userId);
    return row ? (row as unknown as SaveRow) : undefined;
  },
  meta: (userId: string) => {
    const row = q.saveMetaByUser.get(userId) as { revision: number; updated_at: number; summary: string; save_version: number; checksum: string } | undefined;
    return row
      ? { revision: row.revision, updatedAt: row.updated_at, saveVersion: row.save_version, checksum: row.checksum, summary: JSON.parse(row.summary) as SaveSummary }
      : null;
  },
  upsert: (userId: string, blob: string, checksum: string, saveVersion: number, revision: number, summary: SaveSummary) =>
    q.upsertSave.run(userId, blob, checksum, saveVersion, revision, Date.now(), JSON.stringify(summary)),
};

/** Records a webhook event id; returns false if it was already processed. */
export const markWebhookEvent = (id: string): boolean => Number(q.insertEvent.run(id, Date.now()).changes) > 0;
export const webhookEventSeen = (id: string): boolean => q.hasEvent.get(id) !== undefined;
export const purgeWebhookEvents = (olderThanMs: number) => q.purgeEvents.run(Date.now() - olderThanMs);

/** Run a function inside a SQLite transaction. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

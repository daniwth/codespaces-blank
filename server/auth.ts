import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import { config } from './config.ts';
import { emailTokens, sessions, type EmailTokenKind, type UserRow } from './db.ts';
import { createSemaphore, HttpError } from './http.ts';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// OWASP 2024 minimum for scrypt: N=2^17, r=8, p=1 (~128 MiB per hash).
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 64 };
const MAXMEM = 256 * 1024 * 1024;
/** At most 2 hashes run at once; beyond 64 queued requests the server answers 503. */
const hashSlot = createSemaphore(2, 64);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function validatePassword(password: string): void {
  if (password.length < 8) throw new HttpError(400, 'weak_password', 'Password must be at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'weak_password', 'Password is too long.');
}

export function validateCredentials(email: string, password: string): void {
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  validatePassword(password);
}

/** Encodes as scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await hashSlot(() => scryptAsync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: MAXMEM }));
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!(params.N >= 1024 && params.N <= 2 ** 20 && params.r >= 1 && params.r <= 32 && params.p >= 1 && params.p <= 16)) return false;
  const actual = await hashSlot(() => scryptAsync(password, Buffer.from(saltB64, 'base64url'), expected.length, { ...params, maxmem: MAXMEM }));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when a stored hash uses weaker parameters than the current ones (rehash on next login). */
export const needsRehash = (stored: string): boolean => {
  const [, n, r, p] = stored.split('$');
  return Number(n) < SCRYPT.N || Number(r) < SCRYPT.r || Number(p) < SCRYPT.p;
};

/** A precomputed hash so unknown emails cost the same time as wrong passwords. */
let dummyHash: Promise<string> | null = null;
export const burnPasswordCheck = async (password: string): Promise<void> => {
  dummyHash ??= hashPassword('timing-equalizer-password');
  await verifyPassword(password, await dummyHash);
};

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + config.sessionDays * 86_400_000;
  sessions.insert(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

export const VERIFY_TTL_MS = 24 * 3_600_000;
export const RESET_TTL_MS = 3_600_000;

/** Creates a single-use emailed token (stored as SHA-256) and invalidates older ones of the same kind. */
export function issueEmailToken(userId: string, kind: EmailTokenKind): string {
  const token = randomBytes(32).toString('base64url');
  emailTokens.replace(hashToken(token), userId, kind, Date.now() + (kind === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS));
  return token;
}

/** Consumes a token; returns the user id, or null when it is unknown, used or expired. */
export const consumeEmailToken = (token: string, kind: EmailTokenKind): string | null => emailTokens.take(hashToken(token), kind);

const bearer = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization;
  const match = header ? /^bearer\s+(\S+)$/i.exec(header.trim()) : null;
  if (!match) return null;
  const token = match[1];
  return token.length >= 20 && token.length <= 128 ? token : null;
};

export function optionalUser(req: IncomingMessage): UserRow | undefined {
  const token = bearer(req);
  return token ? sessions.user(hashToken(token)) : undefined;
}

export function requireUser(req: IncomingMessage): UserRow {
  const user = optionalUser(req);
  if (!user) throw new HttpError(401, 'unauthorized', 'Please log in again.');
  return user;
}

export function revokeSession(req: IncomingMessage): void {
  const token = bearer(req);
  if (token) sessions.remove(hashToken(token));
}

export const newUserId = (): string => `usr_${randomUUID().replace(/-/g, '')}`;

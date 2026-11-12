/**
 * Development test account: a known login with 1000 gems and no progress, to try the gem features
 * without grinding. It exists only on a local/dev server (never in production, see `seedAllowed`):
 * the credentials are public, in this file.
 */
import { createHash } from 'node:crypto';
import { hashPassword, newUserId } from './auth.ts';
import { devBilling, devLinks, MAX_SAVE_VERSION, SAVE_FORMAT, SAVE_SALT } from './config.ts';
import { saves, users } from './db.ts';
import { inspectSave } from './saves.ts';

export const TEST_ACCOUNT = { login: 'danitest', password: 'AITEST', gems: 1000 } as const;

/** Demo billing + console mailer + not production: the three things only a development server has. */
export const seedAllowed = (): boolean => devBilling && devLinks && process.env.NODE_ENV !== 'production' && process.env.SEED_TEST_ACCOUNT !== '0';

/** A cloud save holding only the gems: the game fills everything else with a brand new farm when it loads it. */
export function testSaveBlob(): string {
  const data = { saveVersion: MAX_SAVE_VERSION, gems: TEST_ACCOUNT.gems };
  const checksum = createHash('sha256').update(SAVE_SALT + JSON.stringify(data)).digest('hex');
  return Buffer.from(JSON.stringify({ format: SAVE_FORMAT, version: MAX_SAVE_VERSION, exportedAt: Date.now(), checksum, data })).toString('base64');
}

/**
 * Create the account if it is missing (or put it back to 1000 gems and no progress with `reset`).
 * An existing account keeps its password, subscription and whatever was played on it.
 */
export async function seedTestAccount(reset = false): Promise<'created' | 'reset' | 'kept' | 'skipped' | 'removed'> {
  if (!seedAllowed()) {
    // A database that once served development must not carry the public login anywhere else.
    // No real sign-up can own this name: registration only accepts email addresses.
    const stale = users.byEmail(TEST_ACCOUNT.login);
    if (stale) users.remove(stale.id);
    return stale ? 'removed' : 'skipped';
  }
  let user = users.byEmail(TEST_ACCOUNT.login);
  const existed = !!user;
  if (!user) {
    const id = newUserId();
    users.insert(id, TEST_ACCOUNT.login, await hashPassword(TEST_ACCOUNT.password));
    users.markVerified(id);
    user = users.byId(id);
  }
  if (!user) return 'skipped';
  if (existed && !reset) return 'kept';
  if (reset) users.setPasswordHash(user.id, await hashPassword(TEST_ACCOUNT.password));
  // Miner Pass (demo) so the account can also save to the cloud.
  users.setSubscription(user.id, { plan: 'yearly', subId: `demo_${user.id}`, status: 'active', periodEnd: Date.now() + 3650 * 86_400_000, cancelAtPeriodEnd: false });
  const blob = testSaveBlob();
  const info = inspectSave(blob);
  saves.upsert(user.id, blob, info.checksum, info.version, (saves.meta(user.id)?.revision ?? 0) + 1, info.summary);
  return existed ? 'reset' : 'created';
}

#!/usr/bin/env node
/**
 * Create the development test account, or put it back to 1000 gems and no progress.
 * Usage: npm run seed:test   (same DATA_DIR / .env as the dev server)
 */
const { seedTestAccount, seedAllowed, TEST_ACCOUNT } = await import('../server/seed.ts');
if (!seedAllowed()) {
  console.error('[seed] refused: the test account only exists on a development server (demo billing, console mailer, not production).');
  process.exit(1);
}
const result = await seedTestAccount(true);
if (result === 'skipped' || result === 'removed') process.exit(1);
console.log(`[seed] test account ${result}: log in as "${TEST_ACCOUNT.login}" / "${TEST_ACCOUNT.password}" (${TEST_ACCOUNT.gems} gems, no progress).`);

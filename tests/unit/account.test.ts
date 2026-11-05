/**
 * Account store regression tests (game-qa-tester). fetch is mocked: no server needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountUser, CloudSaveMeta } from '../../src/services/cloudApi';
import { useAccountStore } from '../../src/store/useAccountStore';

const user: AccountUser = {
  id: 'u1',
  email: 'qa@example.com',
  createdAt: 0,
  subscription: { active: true, status: 'active', plan: 'monthly', periodEnd: null, cancelAtPeriodEnd: false },
};
const cloudMeta: CloudSaveMeta = {
  revision: 5,
  updatedAt: 0,
  saveVersion: 2,
  summary: { lifetimeEarnings: '0', playTimeSec: 0, halvings: 0, scLifetime: 0, gpuCount: 1 },
};

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  useAccountStore.setState({
    token: 'tok', user, cloud: null, baseRevision: 4, syncState: 'idle', conflict: null, error: null, notice: null, busy: false,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('account store', () => {
  // Bug: DELETE /api/me answers 401 bad_credentials for a wrong confirmation
  // password, and run() treats every 401 as an expired session, so a typo in the
  // "Delete account" password box logs the player out (token wiped locally while
  // the server session stays alive).
  it('a wrong password on "Delete account" keeps the player logged in', async () => {
    fetchMock.mockImplementation(() => json(401, { error: { code: 'bad_credentials', message: 'Wrong password.' } }));
    const ok = await useAccountStore.getState().deleteAccount('not-my-password');
    expect(ok).toBe(false);
    expect(useAccountStore.getState().error).toBe('Wrong password.');
    expect(useAccountStore.getState().token).toBe('tok');
    expect(useAccountStore.getState().user?.email).toBe(user.email);
  });

  // Bug: deleteAccount (and the 401 handler) do not clear syncState/conflict like
  // logout does, so the next account registered on this device shows the deleted
  // account's "Keep cloud / Keep this device" conflict card and auto-sync stays off.
  it('deleting the account clears a pending cloud conflict', async () => {
    useAccountStore.setState({ syncState: 'conflict', conflict: cloudMeta });
    fetchMock.mockImplementation(() => json(200, { ok: true }));
    expect(await useAccountStore.getState().deleteAccount('correct-password')).toBe(true);
    expect(useAccountStore.getState().conflict).toBeNull();
    expect(useAccountStore.getState().syncState).not.toBe('conflict');
  });

  // Fixed in e56567c (kept as a guard): browsers reject keepalive fetches over 64 KiB,
  // which made "upload on tab hide" fail with "Account server unreachable." for
  // saves with ~120+ GPUs.
  it('large saves are not sent as keepalive requests', async () => {
    fetchMock.mockImplementation(() => json(200, { save: { ...cloudMeta, revision: 5 } }));
    const { useGameStore } = await import('../../src/store/useGameStore');
    const g0 = Object.values(useGameStore.getState().gpus)[0];
    const gpus = { ...useGameStore.getState().gpus };
    for (let i = 0; i < 300; i += 1) gpus[`gpu-qa-${i}`] = { ...g0, uid: `gpu-qa-${i}` };
    useGameStore.setState({ gpus });
    expect(await useAccountStore.getState().uploadSave({ silent: true, keepalive: true })).toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(init.body).length).toBeGreaterThan(65_536);
    expect(init.keepalive).toBe(false);
  });
});

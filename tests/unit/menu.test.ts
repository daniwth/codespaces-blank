/**
 * Title screen / main menu store logic: screen state, New game / Continue /
 * Main menu, guest choice and the cloud-safety of a fresh run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTING_CASH } from '../../src/config/gameBalance';
import type { AccountUser } from '../../src/services/cloudApi';
import { createInitialData } from '../../src/store/initialState';
import { goToMainMenu, shouldOfferCloudLoad, startFreshRun } from '../../src/store/session';
import { useAccountStore } from '../../src/store/useAccountStore';
import { PROGRESS_MIN_PLAY_SEC, hasProgress, useGameStore } from '../../src/store/useGameStore';
import { formatAgo } from '../../src/utils/formatters';

const game = () => useGameStore.getState();
const user: AccountUser = {
  id: 'u1',
  email: 'menu@example.com',
  createdAt: 0,
  subscription: { active: true, status: 'active', plan: 'monthly', periodEnd: null, cancelAtPeriodEnd: false },
};
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  useGameStore.setState({ ...createInitialData(), screen: 'menu', wikiOpen: false, selectedRack: null, biosGpu: null });
  useAccountStore.setState({ token: null, user: null, cloud: null, baseRevision: null, guest: false, autoSync: true, syncState: 'idle', conflict: null, busy: false });
});
afterEach(() => vi.unstubAllGlobals());

describe('hasProgress', () => {
  it('a brand-new starter save has nothing worth continuing', () => {
    expect(hasProgress(createInitialData())).toBe(false);
  });

  it('earnings, an extra GPU, a past Halving or real play time count as progress', () => {
    const d = createInitialData();
    expect(hasProgress({ ...d, lifetimeEarnings: '0.5' })).toBe(true);
    const g = Object.values(d.gpus)[0];
    expect(hasProgress({ ...d, gpus: { ...d.gpus, extra: { ...g, uid: 'extra' } } })).toBe(true);
    expect(hasProgress({ ...d, stats: { ...d.stats, halvings: 1 } })).toBe(true);
    expect(hasProgress({ ...d, stats: { ...d.stats, playTimeSec: PROGRESS_MIN_PLAY_SEC } })).toBe(false);
    expect(hasProgress({ ...d, stats: { ...d.stats, playTimeSec: PROGRESS_MIN_PLAY_SEC + 1 } })).toBe(true);
  });
});

describe('title menu actions', () => {
  it('every launch starts on the menu with the wiki closed', () => {
    expect(game().screen).toBe('menu');
    expect(game().wikiOpen).toBe(false);
  });

  it('Continue enters the game without touching the save (the loop credits offline time)', () => {
    const lastTick = Date.now() - 3_600_000;
    useGameStore.setState({ cash: '12345', lastTick });
    game().continueGame();
    expect(game().screen).toBe('game');
    expect(game().cash).toBe('12345');
    expect(game().lastTick).toBe(lastTick);
  });

  it('New game wipes progress, keeps the starter bench rig and settings, and stamps lastTick = now', () => {
    const before = Date.now();
    useGameStore.setState({
      cash: '999999', lifetimeEarnings: '5000000', lastTick: before - 86_400_000, sc: 7,
      settings: { ...game().settings, volume: 0.15, muted: true },
      stats: { ...game().stats, playTimeSec: 9000, halvings: 2 },
    });
    game().startNewGame();
    const s = game();
    expect(s.screen).toBe('game');
    expect(Number(s.cash)).toBe(STARTING_CASH);
    expect(s.lifetimeEarnings).toBe('0');
    expect(s.sc).toBe(0);
    expect(s.stats.playTimeSec).toBe(0);
    expect(s.lastTick).toBeGreaterThanOrEqual(before);
    expect(Object.keys(s.gpus)).toHaveLength(1);
    expect(Object.values(s.racks)[0].modelId).toBe('bench');
    expect(s.settings.volume).toBe(0.15);
    expect(s.settings.muted).toBe(true);
    expect(s.offlineReport).toBeNull();
    expect(hasProgress(s)).toBe(false);
  });

  it('Main menu pauses the game and closes in-game overlays', () => {
    game().continueGame();
    const rack = Object.keys(game().racks)[0];
    useGameStore.setState({ selectedRack: rack, biosGpu: Object.keys(game().gpus)[0], wikiOpen: true });
    const cash = game().cash;
    game().returnToMenu();
    expect(game().screen).toBe('menu');
    expect(game().selectedRack).toBeNull();
    expect(game().biosGpu).toBeNull();
    expect(game().wikiOpen).toBe(false);
    expect(game().cash).toBe(cash);
  });

  it('a factory reset or save import does not kick the player out of the current screen', async () => {
    game().continueGame();
    game().hardReset();
    expect(game().screen).toBe('game');
    game().returnToMenu();
    game().setWikiOpen(true);
    const code = await game().exportSave();
    const res = await game().importSave(code);
    expect(res.ok).toBe(true);
    expect(game().screen).toBe('menu');
    expect(game().wikiOpen).toBe(true);
  });

  it('setWikiOpen toggles the wiki overlay', () => {
    game().setWikiOpen(true);
    expect(game().wikiOpen).toBe(true);
    game().setWikiOpen(false);
    expect(game().wikiOpen).toBe(false);
  });
});

describe('guest choice and cloud safety', () => {
  it('playing as guest is remembered, and signing in clears it', async () => {
    useAccountStore.getState().playAsGuest();
    expect(useAccountStore.getState().guest).toBe(true);
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/login') ? json(200, { token: 't1', user }) : json(200, { user, save: null }),
    );
    expect(await useAccountStore.getState().login('menu@example.com', 'password1')).toBe(true);
    expect(useAccountStore.getState().guest).toBe(false);
    expect(useAccountStore.getState().token).toBe('t1');
  });

  it('a New game forgets the cloud base revision so the next sync cannot silently overwrite the cloud save', () => {
    useAccountStore.setState({ token: 'tok', user, baseRevision: 9, syncState: 'ok' });
    useGameStore.setState({ lifetimeEarnings: '1000' });
    startFreshRun();
    expect(useAccountStore.getState().baseRevision).toBeNull();
    expect(useAccountStore.getState().token).toBe('tok');
    expect(game().screen).toBe('game');
    expect(game().lifetimeEarnings).toBe('0');
  });

  it('going back to the menu uploads the save when auto-sync is on', () => {
    fetchMock.mockImplementation(() => json(200, { save: { revision: 3, updatedAt: 0, saveVersion: 5, summary: { lifetimeEarnings: '0', playTimeSec: 0, halvings: 0, scLifetime: 0, gpuCount: 1 } } }));
    useAccountStore.setState({ token: 'tok', user, baseRevision: 2 });
    game().continueGame();
    goToMainMenu();
    expect(game().screen).toBe('menu');
    return vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('going back to the menu does not upload for guests', async () => {
    game().continueGame();
    goToMainMenu();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(game().screen).toBe('menu');
  });
});

describe('menu helpers', () => {
  it('formatAgo renders relative "last played" times', () => {
    const now = 1_700_000_000_000;
    expect(formatAgo(now - 5_000, now)).toBe('just now');
    expect(formatAgo(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAgo(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(formatAgo(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(formatAgo(now + 10_000, now)).toBe('just now');
  });

});

describe('cloud save offer on the menu', () => {
  const meta = { revision: 4, updatedAt: 0, saveVersion: 5, checksum: 'abc', summary: { lifetimeEarnings: '10', playTimeSec: 60, halvings: 0, scLifetime: 0, gpuCount: 2 } };

  it('offers a cloud save this device is not based on', () => {
    expect(shouldOfferCloudLoad({ cloud: meta, baseRevision: null, pendingChecksum: null })).toBe(true);
    expect(shouldOfferCloudLoad({ cloud: meta, baseRevision: 3, pendingChecksum: null })).toBe(true);
  });

  it('does not offer the save this device already synced, its own lost unload upload, or nothing', () => {
    expect(shouldOfferCloudLoad({ cloud: meta, baseRevision: 4, pendingChecksum: null })).toBe(false);
    expect(shouldOfferCloudLoad({ cloud: meta, baseRevision: 3, pendingChecksum: 'abc' })).toBe(false);
    expect(shouldOfferCloudLoad({ cloud: null, baseRevision: null, pendingChecksum: null })).toBe(false);
  });
});

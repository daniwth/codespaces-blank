import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SAVE_VERSION } from '../../server/config';
import { EVENT_EFFECTS, NETWORK_EVENTS, POOLS, SAVE_VERSION, earningsForLevel, forkHashMul, levelFromEarnings } from '../../src/config/gameBalance';
import { runModifiers } from '../../src/config/modifiers';
import { ABILITIES, RANKS, abilityLevel, abilityUnlocked, nextRank, rankIndex, rankOf, rankOfEarnings } from '../../src/config/ranks';
import { ES } from '../../src/i18n/es';
import { flashQuote, poolYieldMul, rentRate, simulate } from '../../src/store/gamePhysics';
import { createInitialData } from '../../src/store/initialState';
import { migrateSave } from '../../src/store/migrations';
import { useGameStore } from '../../src/store/useGameStore';
import { bnToNumber } from '../../src/utils/bignum';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000 - (1_800_000_000_000 % 600_000) + 60_000;
const online = { offline: false, maxStep: 1 } as const;
const store = () => useGameStore.getState();
/** Lifetime earnings that sit exactly on a level. */
const earned = (level: number): string => String(Math.ceil(earningsForLevel(level) * 1.001));

afterEach(() => vi.restoreAllMocks());

describe('rank ladder', () => {
  it('starts at level 1, climbs with the level and never skips backwards', () => {
    expect(RANKS[0].level).toBe(1);
    RANKS.slice(1).forEach((r, i) => {
      expect(r.level).toBeGreaterThan(RANKS[i].level);
      expect(r.gems).toBeGreaterThan(RANKS[i].gems);
      // Bonuses are totals: a higher rank is never worse.
      expect(r.hashMul).toBeGreaterThanOrEqual(RANKS[i].hashMul);
      expect(r.electricityMul).toBeLessThanOrEqual(RANKS[i].electricityMul);
    });
    expect(new Set(RANKS.map((r) => r.id)).size).toBe(RANKS.length);
    expect(rankIndex(1)).toBe(0);
    expect(rankIndex(0)).toBe(0);
    RANKS.forEach((r, i) => {
      expect(rankIndex(r.level)).toBe(i);
      if (i > 0) expect(rankIndex(r.level - 1)).toBe(i - 1);
      expect(rankOfEarnings(Number(earned(r.level)))).toBe(r);
    });
    expect(rankIndex(999)).toBe(RANKS.length - 1);
    expect(nextRank(1)).toBe(RANKS[1]);
    expect(nextRank(999)).toBeNull();
  });

  it('only the high ranks carry permanent bonuses, and each ability belongs to one rank', () => {
    RANKS.filter((r) => r.level < 13).forEach((r) => {
      expect(r.hashMul).toBe(1);
      expect(r.electricityMul).toBe(1);
    });
    expect(RANKS[RANKS.length - 1].hashMul).toBeGreaterThan(1.1);
    expect(RANKS[RANKS.length - 1].electricityMul).toBeLessThan(0.95);
    expect(abilityLevel('flash')).toBe(10);
    expect(abilityLevel('partner')).toBe(13);
    expect(abilityUnlocked('flash', 9)).toBe(false);
    expect(abilityUnlocked('flash', 10)).toBe(true);
    expect(RANKS.filter((r) => r.unlock === 'flash')).toHaveLength(1);
    RANKS.forEach((r) => expect(ES[r.name], r.name).toBeTruthy());
  });

  it('the bonuses reach the modifiers and the simulation through the lifetime earnings', () => {
    expect(runModifiers({}).hashMul).toBe(1);
    expect(runModifiers({}, {}, { lifetimeEarnings: earned(12) }).hashMul).toBe(1);
    expect(runModifiers({}, {}, { lifetimeEarnings: earned(13) }).hashMul).toBeCloseTo(1.03, 12);
    expect(runModifiers({}, {}, { lifetimeEarnings: earned(16) }).electricityMul).toBeCloseTo(0.96, 12);
    const w = starterWorld();
    const base = simulate(w.input, 1, NOW, online).live;
    const legend = simulate({ ...w.input, lifetimeEarnings: earned(25) }, 1, NOW, online).live;
    expect(legend.totalHash).toBeCloseTo(base.totalHash * rankOf(25).hashMul, 6);
    expect(legend.electricityPerSec).toBeCloseTo(base.electricityPerSec * rankOf(25).electricityMul, 10);
    // A new player is untouched.
    expect(simulate({ ...w.input, lifetimeEarnings: earned(9) }, 1, NOW, online).live.totalHash).toBeCloseTo(base.totalHash, 9);
  });

  describe('rank up', () => {
    beforeEach(() => {
      useGameStore.setState({ ...starterWorld().data, gems: 0, rankSeen: 0, rankToast: null, screen: 'game' });
    });

    it('pays the gems of every rank passed, once, and shows the banner', () => {
      store().checkRank();
      expect(store().rankSeen).toBe(0);
      expect(store().rankToast).toBeNull();
      useGameStore.setState({ lifetimeEarnings: earned(4) });
      store().checkRank();
      expect(store().rankSeen).toBe(1);
      expect(store().gems).toBe(RANKS[1].gems);
      expect(store().rankToast).toBe(1);
      store().dismissRankToast();
      store().checkRank();
      expect(store().gems).toBe(RANKS[1].gems);
      expect(store().rankToast).toBeNull();
      // Jumping several ranks at once (a big sale) pays all of them.
      useGameStore.setState({ lifetimeEarnings: earned(13) });
      store().checkRank();
      expect(store().rankSeen).toBe(4);
      expect(store().gems).toBe(RANKS.slice(1, 5).reduce((a, r) => a + r.gems, 0));
      expect(store().log.some((l) => l.key?.startsWith('RANK UP'))).toBe(true);
    });

    it('a simulation tick checks the rank', () => {
      useGameStore.setState({ lifetimeEarnings: earned(7) });
      store().applyTick(simulate(store(), 1, NOW, online));
      expect(store().rankSeen).toBe(2);
    });
  });

  it('save v11: older saves start at the rank they hold, and the rank seen is never ahead of the level', () => {
    expect(SAVE_VERSION).toBe(11);
    expect(MAX_SAVE_VERSION).toBe(SAVE_VERSION);
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    raw.lifetimeEarnings = earned(16);
    raw.gems = 5;
    const old = migrateSave({ ...raw, rankSeen: 0 }, 10);
    expect(old.rankSeen).toBe(rankIndex(16));
    expect(old.gems).toBe(5);
    expect(migrateSave({ ...raw, rankSeen: 99 }, 11).rankSeen).toBe(rankIndex(16));
    expect(migrateSave({ ...raw, rankSeen: 2 }, 11).rankSeen).toBe(2);
    expect(migrateSave({ ...raw, rankSeen: -3 }, 11).rankSeen).toBe(0);
    expect(migrateSave({ ...raw, rankSeen: 'x' }, 11).rankSeen).toBe(rankIndex(16));
    // The Halving keeps the lifetime earnings, so it keeps the rank already paid.
    expect(createInitialData({ lifetimeEarnings: earned(16), rankSeen: 3 }).rankSeen).toBe(3);
    expect(createInitialData({ lifetimeEarnings: earned(16) }).rankSeen).toBe(rankIndex(16));
    expect(createInitialData().rankSeen).toBe(0);
  });
});

describe('Flash Mining', () => {
  it('rented hashrate yields a little less than the farm own hashrate, never more', () => {
    const own = 500e6;
    const extra = rentRate('CC', own, own);
    const first = rentRate('CC', 0, own);
    expect(extra).toBeGreaterThan(0);
    expect(extra).toBeLessThanOrEqual(first + 1e-12);
    expect(rentRate('CC', own, 0)).toBe(0);
    expect(rentRate('CC', own, -5)).toBe(0);
    expect(rentRate('CC', own, own, 1.4)).toBeCloseTo(extra / 1.4, 12);
  });

  it('the fee is most of what the rental is expected to mine at the current price', () => {
    const w = starterWorld();
    const live = simulate(w.input, 1, NOW, online).live;
    const quote = flashQuote(live, 'public', 'CC', 2);
    expect(quote.hash).toBe(live.totalHash * ABILITIES.flash.hashShare);
    expect(quote.coins).toBeCloseTo(rentRate('CC', live.totalHash, quote.hash) * poolYieldMul('public') * ABILITIES.flash.durationSec, 10);
    expect(quote.fee).toBeCloseTo(quote.coins * 2 * ABILITIES.flash.feeShare, 2);
    expect(flashQuote({ totalHash: 0 }, 'public', 'CC', 2)).toEqual({ hash: 0, coins: 0, fee: 0 });
  });

  it('while it lasts the rental mints what was quoted, without heat, bill or own hashrate', () => {
    const w = starterWorld();
    const plain = simulate(w.input, 10, NOW, online);
    const quote = flashQuote(plain.live, 'public', 'CC', w.input.market.CC.price);
    const buffs = { ...w.input.buffs, rentHash: quote.hash, rentUntil: NOW + 600_000, rentCooldownUntil: NOW + 900_000 };
    const rented = simulate({ ...w.input, buffs }, 10, NOW, online);
    expect(rented.coinMined - plain.coinMined).toBeCloseTo((quote.coins / ABILITIES.flash.durationSec) * 10, 6);
    expect(rented.live.totalHash).toBeCloseTo(plain.live.totalHash, 9);
    expect(rented.live.rentedHash).toBe(quote.hash);
    expect(rented.electricityPaid).toBeCloseTo(plain.electricityPaid, 12);
    expect(rented.live.hottest).toBeCloseTo(plain.live.hottest, 9);
    // Over, it mints nothing more.
    const over = simulate({ ...w.input, buffs: { ...buffs, rentUntil: NOW - 20_000 } }, 10, NOW, online);
    expect(over.coinMined).toBeCloseTo(plain.coinMined, 12);
    expect(over.live.rentedHash).toBe(0);
  });

  describe('store', () => {
    beforeEach(() => {
      const w = starterWorld();
      useGameStore.setState({ ...w.data, cash: '1000', screen: 'game' });
      useGameStore.setState({ live: simulate(store(), 1, NOW, online).live });
    });

    it('is locked below Farm Operator', () => {
      useGameStore.setState({ lifetimeEarnings: earned(9) });
      expect(store().rentHashrate(NOW)).toBe(false);
      expect(store().buffs.rentUntil).toBe(0);
      expect(bnToNumber(store().cash)).toBe(1000);
    });

    it('charges the quoted fee, rents for the duration and then cools down', () => {
      useGameStore.setState({ lifetimeEarnings: earned(10) });
      const quote = flashQuote(store().live, store().pool, 'CC', store().market.CC.price);
      expect(store().rentHashrate(NOW)).toBe(true);
      expect(bnToNumber(store().cash)).toBeCloseTo(1000 - quote.fee, 6);
      expect(store().buffs.rentHash).toBe(quote.hash);
      expect(store().buffs.rentUntil).toBe(NOW + ABILITIES.flash.durationSec * 1000);
      expect(store().rentHashrate(NOW + 1000)).toBe(false);
      expect(store().rentHashrate(NOW + ABILITIES.flash.durationSec * 1000 + 1000)).toBe(false);
      expect(store().rentHashrate(NOW + ABILITIES.flash.cooldownSec * 1000)).toBe(true);
    });

    it('needs the cash and a farm that hashes', () => {
      useGameStore.setState({ lifetimeEarnings: earned(10), cash: '0' });
      expect(store().rentHashrate(NOW)).toBe(false);
      useGameStore.setState({ cash: '1000', live: { ...store().live, totalHash: 0 } });
      expect(store().rentHashrate(NOW)).toBe(false);
      expect(store().buffs.rentCooldownUntil).toBe(0);
    });

    it('at a flat price a full rental pays back the fee plus the margin', () => {
      useGameStore.setState({ lifetimeEarnings: earned(10) });
      const price = store().market.CC.price;
      const quote = flashQuote(store().live, 'public', 'CC', price);
      expect((quote.coins * price) / quote.fee).toBeCloseTo(1 / ABILITIES.flash.feeShare, 1);
    });
  });

  it('save: a tampered rental is clamped to one rental and one cooldown', () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    raw.buffs = { ...(raw.buffs as object), rentHash: -5, rentUntil: Date.now() + 9e12, rentCooldownUntil: Date.now() + 9e12, partnerCooldownUntil: Date.now() + 9e12 };
    const b = migrateSave(raw, 11).buffs;
    expect(b.rentHash).toBe(0);
    expect(b.rentUntil - Date.now()).toBeLessThanOrEqual(ABILITIES.flash.durationSec * 1000);
    expect(b.rentCooldownUntil - Date.now()).toBeLessThanOrEqual(ABILITIES.flash.cooldownSec * 1000);
    expect(b.partnerCooldownUntil - Date.now()).toBeLessThanOrEqual(ABILITIES.partner.cooldownSec * 1000);
    // Older saves have no rental.
    const old = { ...raw, buffs: { techUntil: 0, techCooldownUntil: 0, nitroUntil: 0, blockMulUntil: 0, auditClaims: 0 } };
    expect(migrateSave(old, 10).buffs).toMatchObject({ rentHash: 0, rentUntil: 0, rentCooldownUntil: 0, partnerCooldownUntil: 0 });
  });
});

describe('Pool Partner', () => {
  it('pays more in the partner pool, and only there and only while it lasts', () => {
    const w = starterWorld();
    const plain = simulate(w.input, 10, NOW, online);
    const partner = { pool: 'public' as const, until: NOW + 60_000 };
    const on = simulate({ ...w.input, partner }, 10, NOW, online);
    expect(on.coinMined).toBeCloseTo(plain.coinMined * ABILITIES.partner.payoutMul, 10);
    expect(on.live.partnerMul).toBe(ABILITIES.partner.payoutMul);
    expect(on.live.coinPerSec).toBeCloseTo(plain.live.coinPerSec * ABILITIES.partner.payoutMul, 10);
    const elsewhere = simulate({ ...w.input, partner: { pool: 'pplns', until: NOW + 60_000 } }, 10, NOW, online);
    expect(elsewhere.coinMined).toBeCloseTo(plain.coinMined, 12);
    const over = simulate({ ...w.input, partner: { pool: 'public', until: NOW - 20_000 } }, 10, NOW, online);
    expect(over.coinMined).toBeCloseTo(plain.coinMined, 12);
    expect(over.live.partnerMul).toBe(1);
  });

  describe('store', () => {
    beforeEach(() => {
      useGameStore.setState({ ...starterWorld().data, lifetimeEarnings: earned(13), screen: 'game' });
    });

    it('is locked below Hash Baron', () => {
      useGameStore.setState({ lifetimeEarnings: earned(12) });
      expect(store().signPartner(NOW)).toBe(false);
      expect(store().partner).toBeNull();
    });

    it('signs with the current pool, once', () => {
      expect(store().signPartner(NOW)).toBe(true);
      expect(store().partner).toEqual({ pool: 'public', until: NOW + ABILITIES.partner.durationSec * 1000 });
      expect(store().signPartner(NOW + 1000)).toBe(false);
    });

    it('leaving the partner pool early costs reputation and a cooldown', () => {
      const now = Date.now();
      useGameStore.setState({ reputation: { ...store().reputation, points: 10 } });
      store().signPartner(now);
      expect(store().setPool('pplns')).toBe(true);
      expect(store().partner).toBeNull();
      expect(store().reputation.points).toBe(10 - ABILITIES.partner.breakPoints);
      expect(store().buffs.partnerCooldownUntil).toBeGreaterThan(now);
      expect(store().signPartner(Date.now())).toBe(false);
      expect(store().signPartner(Date.now() + ABILITIES.partner.cooldownSec * 1000 + 1000)).toBe(true);
      // Reputation never goes below zero.
      useGameStore.setState({ reputation: { ...store().reputation, points: 2 } });
      store().setPool('public');
      expect(store().reputation.points).toBe(0);
    });

    it('re-selecting the same pool or a deal that ran out costs nothing', () => {
      const now = Date.now();
      useGameStore.setState({ reputation: { ...store().reputation, points: 10 } });
      store().signPartner(now);
      store().setPool('public');
      expect(store().partner).not.toBeNull();
      expect(store().reputation.points).toBe(10);
      // The deal ends on its own with the next tick after its term.
      useGameStore.setState({ partner: { pool: 'public', until: NOW - 1 } });
      store().applyTick(simulate(store(), 1, NOW, online));
      expect(store().partner).toBeNull();
      // (The tick may have expired old contracts: compare against the reputation it left.)
      const after = store().reputation.points;
      store().setPool('pplns');
      expect(store().reputation.points).toBe(after);
    });
  });

  it('save: a deal with an unknown pool or already over is dropped; a new run has none', () => {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(createInitialData()));
    expect(migrateSave({ ...raw, partner: { pool: 'public', until: Date.now() + 60_000 } }, 11).partner?.pool).toBe('public');
    expect(migrateSave({ ...raw, partner: { pool: 'public', until: Date.now() + 9e12 } }, 11).partner?.until).toBeLessThanOrEqual(Date.now() + ABILITIES.partner.durationSec * 1000 + 50);
    expect(migrateSave({ ...raw, partner: { pool: 'moon', until: Date.now() + 60_000 } }, 11).partner).toBeNull();
    expect(migrateSave({ ...raw, partner: { pool: 'public', until: Date.now() - 1 } }, 11).partner).toBeNull();
    expect(migrateSave({ ...raw, partner: { pool: 'public', until: Date.now() + 60_000 } }, 10).partner).toBeNull();
    expect(createInitialData({ partner: { pool: 'public', until: Date.now() + 60_000 } }).partner).toBeNull();
    expect(Object.keys(POOLS)).toContain('pplns');
  });
});

describe('Hard Fork event', () => {
  it('cuts the hashrate of stock firmware and each Firmware Tuning level recovers part of it', () => {
    expect(forkHashMul(0)).toBe(EVENT_EFFECTS.forkHashMul);
    expect(forkHashMul(2)).toBeCloseTo(EVENT_EFFECTS.forkHashMul + 2 * EVENT_EFFECTS.forkPerFirmware, 12);
    expect(forkHashMul(5)).toBe(1);
    expect(forkHashMul(99)).toBe(1);
    const w = starterWorld();
    const fork = { id: 'hard_fork' as const, startedAt: NOW - 1000, endsAt: NOW + 60_000, roomId: null };
    const base = simulate(w.input, 1, NOW, online).live.totalHash;
    expect(simulate({ ...w.input, event: fork }, 1, NOW, online).live.totalHash).toBeCloseTo(base * EVENT_EFFECTS.forkHashMul, 6);
    const tuned = { levels: { firmware: 3 }, active: null };
    const tunedBase = simulate({ ...w.input, research: tuned }, 1, NOW, online).live.totalHash;
    expect(simulate({ ...w.input, research: tuned, event: fork }, 1, NOW, online).live.totalHash).toBeCloseTo(tunedBase * forkHashMul(3), 6);
    const maxed = { levels: { firmware: 5 }, active: null };
    expect(simulate({ ...w.input, research: maxed, event: fork }, 1, NOW, online).live.totalHash)
      .toBeCloseTo(simulate({ ...w.input, research: maxed }, 1, NOW, online).live.totalHash, 6);
  });

  it('is a translated network event whose text matches its numbers', () => {
    const def = NETWORK_EVENTS.hard_fork;
    expect(def.positive).toBe(false);
    expect(ES[def.name]).toBeTruthy();
    expect(ES[def.description]).toBeTruthy();
    expect(def.description).toContain(`${Math.round(EVENT_EFFECTS.forkHashMul * 100)}%`);
    expect(def.description).toContain(`${Math.round(EVENT_EFFECTS.forkPerFirmware * 100)}%`);
    expect(levelFromEarnings(1)).toBe(1);
  });
});

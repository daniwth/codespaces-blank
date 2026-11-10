import { tr } from '../i18n';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { CHALLENGE_BY_ID } from '../config/challenges';
import { SAVE_KEY, SAVE_VERSION } from '../config/gameBalance';
import type { GameData, RoomId } from '../types/player';
import { bnAdd, bnMax, bnToNumber } from '../utils/bignum';
import { fxBus, sfxBus, type SfxCue } from '../utils/eventBus';
import { decodeSave, encodeSave } from '../utils/saveCodec';
import { emptyLive, type SimInput, type SimOutput, type SoundCue } from './gamePhysics';
import { pruneGpuEdits, reconcileGpuUpdate } from './editLedger';
import { createInitialData } from './initialState';
import { migrateSave } from './migrations';
import { createChallengesSlice } from './slices/challengesSlice';
import { createContractsSlice } from './slices/contractsSlice';
import { createEconomySlice } from './slices/economySlice';
import { createHardwareSlice } from './slices/hardwareSlice';
import { createMarketSlice } from './slices/marketSlice';
import { createRoomsSlice } from './slices/roomsSlice';
import type { CoreActions, GameStore, GetState, SetState, UiState } from './storeTypes';
import { bumpWorldEpoch } from './worldEpoch';

const DATA_KEYS: (keyof GameData)[] = [
  'saveVersion', 'createdAt', 'lastTick', 'cash', 'cc', 'meme', 'memeCostBasis', 'ccCostBasis', 'gems', 'sc', 'scLifetime',
  'runEarnings', 'lifetimeEarnings', 'runStartedAt', 'gpus', 'psus', 'coolers', 'racks', 'ownedRooms', 'activeRoom',
  'roomTemps', 'technicians', 'pool', 'market', 'bots', 'event', 'nextEventAt', 'talents', 'vip',
  'achievements', 'stats', 'settings', 'contracts', 'challenge', 'challengeRecords',
];

export const extractData = (s: GameStore): GameData => {
  const out: Record<string, unknown> = {};
  DATA_KEYS.forEach((k) => {
    out[k] = s[k];
  });
  return out as unknown as GameData;
};

/** Snapshot sent to the simulation worker each tick. */
export const selectSimInput = (s: GameStore): SimInput => ({
  gpus: s.gpus, psus: s.psus, coolers: s.coolers, racks: s.racks, ownedRooms: s.ownedRooms,
  roomTemps: s.roomTemps, technicians: s.technicians, pool: s.pool, market: s.market, bots: s.bots,
  event: s.event, nextEventAt: s.nextEventAt, talents: s.talents, vip: s.vip, cash: s.cash, cc: s.cc,
  meme: s.meme, memeCostBasis: s.memeCostBasis, ccCostBasis: s.ccCostBasis, lastTick: s.lastTick, challenge: s.challenge,
});

/**
 * localStorage adapter that coalesces writes: the game mutates state 4×/s,
 * but we only hit storage every ~2s (and flush on tab hide / unload).
 */
function createThrottledStorage(delay = 2000): StateStorage & { flush: () => void } {
  let pending: { name: string; value: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    try {
      localStorage.setItem(pending.name, pending.value);
    } catch {
      // Quota / private mode: the game keeps running in memory.
    }
    pending = null;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', write);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') write();
    });
  }
  return {
    getItem: (name) => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (!timer) timer = setTimeout(write, delay);
    },
    removeItem: (name) => {
      pending = null;
      try {
        localStorage.removeItem(name);
      } catch {
        // ignore
      }
    },
    flush: write,
  };
}

export const gameStorage = createThrottledStorage();

const SOUND_MAP: Record<SoundCue, SfxCue> = {
  block: 'block', alarm: 'alarm', raid: 'raid', event: 'event', shutdown: 'shutdown', sell: 'sell', restart: 'restart',
};

let logId = 0;

/** Rooms whose racks a raid just put into inspection reboot (raids are the only simulated reboots). */
export function raidRooms(out: Pick<SimOutput, 'rackReboots' | 'now'>, racks: GameData['racks']): Map<RoomId, number> {
  const rooms = new Map<RoomId, number>();
  Object.entries(out.rackReboots).forEach(([uid, until]) => {
    const roomId = racks[uid]?.roomId;
    if (roomId && until > out.now) rooms.set(roomId, Math.max(rooms.get(roomId) ?? 0, until));
  });
  return rooms;
}

const initialUi = (): UiState => ({
  live: emptyLive(),
  log: [],
  selectedRack: null,
  biosGpu: null,
  offlineReport: null,
  sideTab: 'shop',
  lottery: null,
  contractToast: null,
  screen: 'menu',
  wikiOpen: false,
});

/** Navigation state that survives a save import / factory reset (only the data is replaced). */
const keepNav = (s: GameStore): Pick<UiState, 'screen' | 'wikiOpen'> => ({ screen: s.screen, wikiOpen: s.wikiOpen });

/** Play time (s) after which a fresh save counts as "real progress" worth continuing. */
export const PROGRESS_MIN_PLAY_SEC = 5;

/**
 * True when the local save holds progress worth protecting: anything earned,
 * more than the starter GPU, a past Halving, or more than a few seconds played.
 */
export function hasProgress(d: Pick<GameData, 'lifetimeEarnings' | 'gpus' | 'stats'>): boolean {
  return (
    bnToNumber(d.lifetimeEarnings) > 0 ||
    Object.keys(d.gpus).length > 1 ||
    d.stats.halvings > 0 ||
    d.stats.playTimeSec > PROGRESS_MIN_PLAY_SEC
  );
}

function createCoreActions(set: SetState, get: GetState): CoreActions {
  const mergeTick = (out: SimOutput) => {
    set((s) => {
      const gpus = { ...s.gpus };
      Object.entries(out.gpuUpdates).forEach(([uid, upd]) => {
        if (gpus[uid]) gpus[uid] = { ...gpus[uid], ...reconcileGpuUpdate(uid, upd, out.now) };
      });
      pruneGpuEdits(out.now);
      let racks = s.racks;
      const rebootEntries = Object.entries(out.rackReboots);
      if (rebootEntries.length) {
        racks = { ...s.racks };
        rebootEntries.forEach(([uid, until]) => {
          if (racks[uid]) racks[uid] = { ...racks[uid], rebootUntil: Math.max(racks[uid].rebootUntil, until) };
        });
      }
      const fires = out.botFires;
      return {
        gpus,
        racks,
        roomTemps: { ...s.roomTemps, ...out.roomTemps },
        cash: bnMax(0, bnAdd(s.cash, out.cashDelta)),
        cc: bnMax(0, bnAdd(s.cc, out.ccDelta)),
        meme: Math.max(0, s.meme + out.memeDelta),
        memeCostBasis: Math.max(0, s.memeCostBasis + out.memeCostDelta),
        ccCostBasis: Math.max(0, s.ccCostBasis + out.ccCostDelta),
        gems: s.gems + out.gemsDelta,
        runEarnings: bnAdd(s.runEarnings, out.earnedCash),
        lifetimeEarnings: bnAdd(s.lifetimeEarnings, out.earnedCash),
        market: out.market,
        bots: s.bots.map((b) => (fires[b.id] !== undefined ? { ...b, lastFiredAt: fires[b.id] } : b)),
        event: out.event,
        nextEventAt: out.nextEventAt,
        stats: {
          ...s.stats,
          blocksFound: s.stats.blocksFound + out.blocksFound,
          raids: s.stats.raids + out.raids,
          overheats: s.stats.overheats + out.overheats,
          playTimeSec: s.stats.playTimeSec + out.dt,
          maxHashrate: Math.max(s.stats.maxHashrate, out.live.totalHash),
          bestTrade: Math.max(s.stats.bestTrade, out.bestTrade),
        },
        lastTick: out.now,
        live: out.live,
      };
    });
  };

  return {
    applyTick: (out) => {
      mergeTick(out);
      const { pushLog, checkAchievements, advanceContractBoard, checkChallenge } = get();
      out.messages.forEach((m) => {
        if (!m.key) return pushLog(m.text, m.tone);
        const params: Record<string, string | number> = {};
        Object.entries(m.params ?? {}).forEach(([k, v]) => { params[k] = typeof v === 'string' ? tr(v) : v; });
        pushLog(tr(m.key, params), m.tone);
      });
      advanceContractBoard(out, false);
      out.sounds.forEach((cue) => sfxBus.emit(SOUND_MAP[cue]));
      if (out.blocksFound > 0) fxBus.emit({ kind: 'block' });
      if (out.raids > 0) raidRooms(out, get().racks).forEach((until, roomId) => fxBus.emit({ kind: 'raid', roomId, until }));
      checkChallenge();
      checkAchievements();
    },

    applyOffline: (out, requested) => {
      mergeTick(out);
      set({
        offlineReport: {
          seconds: out.dt,
          requested,
          ccMined: out.ccMined,
          electricity: out.electricityPaid,
          earnedCash: out.earnedCash,
          ccDelta: out.ccDelta,
          cashDelta: out.cashDelta,
        },
      });
      get().advanceContractBoard(out, true);
      get().checkChallenge();
      get().checkAchievements();
    },

    dismissOffline: () => set({ offlineReport: null }),

    pushLog: (text, tone = 'info') => {
      logId += 1;
      const entry = { id: logId, t: Date.now(), text, tone };
      set((s) => ({ log: [...s.log.slice(-59), entry] }));
    },

    setSideTab: (tab) => set({ sideTab: tab }),
    selectRack: (uid) => set({ selectedRack: uid }),
    openBios: (uid) => set({ biosGpu: uid }),
    dismissLottery: () => set({ lottery: null }),
    updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

    exportSave: async () => encodeSave(extractData(get())),

    importSave: async (text) => {
      const result = await decodeSave(text);
      if (!result.ok) {
        sfxBus.emit('error');
        return { ok: false, message: tr(result.error) };
      }
      const data = migrateSave(result.data, result.version);
      bumpWorldEpoch();
      set({ ...data, ...initialUi(), ...keepNav(get()), sideTab: 'system', lastTick: Date.now() });
      gameStorage.flush();
      sfxBus.emit('success');
      get().pushLog(tr('Save imported and verified (SHA-256 OK).'), 'good');
      return { ok: true, message: tr('Save imported successfully.') };
    },

    hardReset: () => {
      bumpWorldEpoch();
      set({ ...createInitialData(), ...initialUi(), ...keepNav(get()), sideTab: 'system' });
      gameStorage.flush();
      get().pushLog(tr('Factory reset complete. Welcome back to the bedroom.'), 'info');
    },

    continueGame: () => {
      if (get().screen === 'game') return;
      set({ screen: 'game', wikiOpen: false });
      sfxBus.emit('start');
    },

    startNewGame: (challenge) => {
      // createInitialData stamps lastTick = now, so the loop credits no offline time.
      bumpWorldEpoch();
      set({ ...createInitialData({ settings: get().settings }, challenge ?? null), ...initialUi(), screen: 'game' });
      gameStorage.flush();
      sfxBus.emit('start');
      get().pushLog(tr('New farm founded: one PX-460 on a bench in your bedroom. Happy hashing!'), 'good');
      const active = get().challenge;
      if (active) get().pushLog(tr('Challenge started: {name}. {description}', { name: tr(CHALLENGE_BY_ID[active.id].name), description: tr(CHALLENGE_BY_ID[active.id].description) }), 'warn');
    },

    returnToMenu: () => {
      set({ screen: 'menu', selectedRack: null, biosGpu: null, lottery: null, contractToast: null, offlineReport: null, wikiOpen: false });
      gameStorage.flush();
    },

    setWikiOpen: (open) => set({ wikiOpen: open }),
  };
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => {
      const s = set as SetState;
      const g = get as GetState;
      return {
        ...createInitialData(),
        ...initialUi(),
        ...createHardwareSlice(s, g),
        ...createRoomsSlice(s, g),
        ...createMarketSlice(s, g),
        ...createEconomySlice(s, g),
        ...createContractsSlice(s, g),
        ...createChallengesSlice(s, g),
        ...createCoreActions(s, g),
      };
    },
    {
      name: SAVE_KEY,
      version: SAVE_VERSION,
      storage: createJSONStorage(() => gameStorage),
      partialize: (s) => extractData(s),
      migrate: (persisted, version) => migrateSave(persisted, version),
      merge: (persisted, current) => ({ ...current, ...migrateSave(persisted, SAVE_VERSION) }),
    },
  ),
);

/** Shallow-compared selector hook for picking several fields at once. */
export function useGameShallow<T>(selector: (s: GameStore) => T): T {
  return useGameStore(useShallow(selector));
}

export const getCashNumber = (): number => bnToNumber(useGameStore.getState().cash);

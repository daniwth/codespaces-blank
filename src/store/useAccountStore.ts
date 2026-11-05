import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ApiError, cloudApi, type AccountUser, type CloudSaveMeta, type Plan, type PlanId } from '../services/cloudApi';
import { sfxBus } from '../utils/eventBus';
import { useGameStore } from './useGameStore';

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error' | 'conflict';

interface AccountState {
  // persisted
  token: string | null;
  /** Cloud revision this device's progress is based on (optimistic locking). */
  baseRevision: number | null;
  autoSync: boolean;
  lastSyncAt: number | null;
  /**
   * Checksum of an upload whose response may never arrive (sent while the page
   * unloads). If the server later reports a "conflict" with exactly this save,
   * it is our own upload, not another device.
   */
  pendingChecksum: string | null;
  // runtime
  user: AccountUser | null;
  plans: Plan[];
  devBilling: boolean;
  serverUp: boolean | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  cloud: CloudSaveMeta | null;
  syncState: SyncState;
  conflict: CloudSaveMeta | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  register: (email: string, password: string) => Promise<boolean>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<boolean>;
  subscribe: (plan: PlanId) => Promise<void>;
  manageBilling: () => Promise<void>;
  uploadSave: (opts?: { force?: boolean; silent?: boolean; keepalive?: boolean }) => Promise<boolean>;
  downloadSave: () => Promise<boolean>;
  resolveConflict: (keep: 'local' | 'cloud') => Promise<void>;
  setAutoSync: (on: boolean) => void;
  clearMessages: () => void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong.');

/** A 401 that means "your session is gone" (not "wrong confirmation password"). */
const sessionExpired = (err: unknown): boolean => err instanceof ApiError && err.status === 401 && err.code !== 'bad_credentials';

/** Everything tied to a signed-in account, cleared on logout / expiry / deletion. */
const SIGNED_OUT = { token: null, user: null, cloud: null, baseRevision: null, pendingChecksum: null, syncState: 'idle', conflict: null } as const;

/** The checksum embedded in an exported save (identifies exactly what was uploaded). */
function blobChecksum(blob: string): string | null {
  try {
    const env = JSON.parse(atob(blob)) as { checksum?: unknown };
    return typeof env.checksum === 'string' ? env.checksum : null;
  } catch {
    return null;
  }
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => {
      /** Wraps an action with busy/error handling and session-expiry detection. */
      const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
        set({ busy: true, error: null, notice: null });
        try {
          return await fn();
        } catch (err) {
          if (sessionExpired(err)) set({ ...SIGNED_OUT });
          if (err instanceof ApiError && err.code === 'offline') set({ serverUp: false });
          set({ error: message(err) });
          sfxBus.emit('error');
          return null;
        } finally {
          set({ busy: false });
        }
      };

      const afterAuth = (token: string, user: AccountUser) => {
        set({ token, user, serverUp: true });
        void get().refresh();
      };

      return {
        token: null,
        baseRevision: null,
        autoSync: true,
        lastSyncAt: null,
        pendingChecksum: null,
        user: null,
        plans: [],
        devBilling: false,
        serverUp: null,
        busy: false,
        error: null,
        notice: null,
        cloud: null,
        syncState: 'idle',
        conflict: null,

        init: async () => {
          try {
            const { plans, devBilling } = await cloudApi.plans();
            set({ plans, devBilling, serverUp: true });
          } catch {
            set({ serverUp: false });
            return;
          }
          if (get().token) await get().refresh();
        },

        refresh: async () => {
          const { token } = get();
          if (!token) return;
          try {
            const { user, save } = await cloudApi.me(token);
            set({ user, cloud: save, serverUp: true });
          } catch (err) {
            if (sessionExpired(err)) set({ ...SIGNED_OUT });
            if (err instanceof ApiError && err.code === 'offline') set({ serverUp: false });
          }
        },

        register: async (email, password) => {
          const res = await run(() => cloudApi.register(email, password));
          if (!res) return false;
          afterAuth(res.token, res.user);
          useGameStore.getState().pushLog(`Account created: ${res.user.email}`, 'good');
          sfxBus.emit('success');
          return true;
        },

        login: async (email, password) => {
          const res = await run(() => cloudApi.login(email, password));
          if (!res) return false;
          // New device / account: progress has no known cloud base yet.
          set({ baseRevision: null, pendingChecksum: null, syncState: 'idle', conflict: null });
          afterAuth(res.token, res.user);
          useGameStore.getState().pushLog(`Logged in as ${res.user.email}`, 'good');
          sfxBus.emit('success');
          return true;
        },

        logout: async () => {
          const { token } = get();
          if (token) await cloudApi.logout(token).catch(() => undefined);
          set({ ...SIGNED_OUT, notice: 'Logged out. Local progress stays on this device.' });
        },

        deleteAccount: async (password) => {
          const { token } = get();
          if (!token) return false;
          const res = await run(() => cloudApi.deleteAccount(token, password));
          if (!res) return false;
          set({ ...SIGNED_OUT, notice: 'Account and cloud save deleted.' });
          return true;
        },

        subscribe: async (plan) => {
          const { token } = get();
          if (!token) return;
          const res = await run(() => cloudApi.checkout(token, plan));
          if (!res) return;
          if (res.url) {
            window.location.assign(res.url); // Stripe Checkout
            return;
          }
          set({ user: res.user, notice: res.reactivated ? 'Miner Pass resumed: it will renew normally.' : 'Miner Pass activated (demo billing — no real charge).' });
          useGameStore.getState().pushLog('Miner Pass active: cloud saves unlocked!', 'good');
          sfxBus.emit('unlock');
          await get().uploadSave({ silent: true });
        },

        manageBilling: async () => {
          const { token, devBilling } = get();
          if (!token) return;
          if (devBilling) {
            const res = await run(() => cloudApi.demoCancel(token));
            if (res) set({ user: res.user, notice: 'Subscription will end at the close of the current period.' });
            return;
          }
          const res = await run(() => cloudApi.portal(token));
          if (res?.url) window.location.assign(res.url);
        },

        uploadSave: async (opts = {}) => {
          const { token, user } = get();
          if (!token || !user?.subscription.active) return false;
          if (get().syncState === 'syncing') return false;
          set({ syncState: 'syncing', ...(opts.silent ? {} : { error: null, notice: null }) });
          const attempt = async (blob: string, base: number | null, force: boolean, keepalive: boolean) => {
            // Remember what we send: the response of an unload upload is lost with the page.
            set({ pendingChecksum: blobChecksum(blob) });
            return cloudApi.putSave(token, blob, base, force, keepalive);
          };
          // Checksum of an earlier upload whose response we may never have seen.
          const previousPending = get().pendingChecksum;
          try {
            const blob = await useGameStore.getState().exportSave();
            // Browsers reject keepalive requests with bodies over 64 KiB.
            const keepalive = !!opts.keepalive && blob.length < 60_000;
            let save: CloudSaveMeta;
            try {
              ({ save } = await attempt(blob, get().baseRevision, !!opts.force, keepalive));
            } catch (err) {
              const remote = err instanceof ApiError && err.code === 'save_conflict' ? (err.details as (CloudSaveMeta & { checksum?: string }) | null) : null;
              const ours = !!remote?.checksum && (remote.checksum === previousPending || remote.checksum === blobChecksum(blob));
              if (!remote || !ours) throw err;
              // The cloud holds our own earlier upload: adopt its revision and retry once.
              ({ save } = await attempt(blob, remote.revision, false, keepalive));
            }
            set({ baseRevision: save.revision, cloud: save, lastSyncAt: Date.now(), syncState: 'ok', conflict: null, pendingChecksum: null });
            if (!opts.silent) set({ notice: `Saved to the cloud (revision ${save.revision}).` });
            return true;
          } catch (err) {
            if (err instanceof ApiError && err.code === 'save_conflict') {
              set({ syncState: 'conflict', conflict: err.details as CloudSaveMeta });
              useGameStore.getState().pushLog('Cloud save conflict: choose which progress to keep in the Account tab.', 'warn');
            } else {
              if (err instanceof ApiError && err.status === 402) await get().refresh();
              if (sessionExpired(err)) set({ ...SIGNED_OUT });
              set({ syncState: 'error', error: message(err) });
            }
            return false;
          }
        },

        downloadSave: async () => {
          const { token } = get();
          if (!token) return false;
          const res = await run(() => cloudApi.getSave(token));
          if (!res) return false;
          const result = await useGameStore.getState().importSave(res.blob);
          if (!result.ok) {
            set({ error: result.message });
            return false;
          }
          useGameStore.getState().setSideTab('account');
          set({ baseRevision: res.revision, cloud: res, lastSyncAt: Date.now(), syncState: 'ok', conflict: null, notice: `Cloud progress loaded (revision ${res.revision}).` });
          return true;
        },

        resolveConflict: async (keep) => {
          if (keep === 'cloud') await get().downloadSave();
          else await get().uploadSave({ force: true });
        },

        setAutoSync: (on) => set({ autoSync: on }),
        clearMessages: () => set({ error: null, notice: null }),
      };
    },
    {
      name: 'hash-harvest-account',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ token: s.token, baseRevision: s.baseRevision, autoSync: s.autoSync, lastSyncAt: s.lastSyncAt, pendingChecksum: s.pendingChecksum }),
    },
  ),
);

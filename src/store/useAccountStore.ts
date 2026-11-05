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

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => {
      /** Wraps an action with busy/error handling and session-expiry detection. */
      const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
        set({ busy: true, error: null, notice: null });
        try {
          return await fn();
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) set({ token: null, user: null, cloud: null });
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
            if (err instanceof ApiError && err.status === 401) set({ token: null, user: null, cloud: null });
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
          set({ baseRevision: null });
          afterAuth(res.token, res.user);
          useGameStore.getState().pushLog(`Logged in as ${res.user.email}`, 'good');
          sfxBus.emit('success');
          return true;
        },

        logout: async () => {
          const { token } = get();
          if (token) await cloudApi.logout(token).catch(() => undefined);
          set({ token: null, user: null, cloud: null, baseRevision: null, syncState: 'idle', conflict: null, notice: 'Logged out. Local progress stays on this device.' });
        },

        deleteAccount: async (password) => {
          const { token } = get();
          if (!token) return false;
          const res = await run(() => cloudApi.deleteAccount(token, password));
          if (!res) return false;
          set({ token: null, user: null, cloud: null, baseRevision: null, notice: 'Account and cloud save deleted.' });
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
          set({ user: res.user, notice: 'Miner Pass activated (demo billing — no real charge).' });
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
          const { token, user, baseRevision } = get();
          if (!token || !user?.subscription.active) return false;
          if (get().syncState === 'syncing') return false;
          set({ syncState: 'syncing', ...(opts.silent ? {} : { error: null, notice: null }) });
          try {
            const blob = await useGameStore.getState().exportSave();
            const { save } = await cloudApi.putSave(token, blob, baseRevision, !!opts.force, opts.keepalive);
            set({ baseRevision: save.revision, cloud: save, lastSyncAt: Date.now(), syncState: 'ok', conflict: null });
            if (!opts.silent) set({ notice: `Saved to the cloud (revision ${save.revision}).` });
            return true;
          } catch (err) {
            if (err instanceof ApiError && err.code === 'save_conflict') {
              set({ syncState: 'conflict', conflict: err.details as CloudSaveMeta });
              useGameStore.getState().pushLog('Cloud save conflict: choose which progress to keep in the Account tab.', 'warn');
            } else {
              if (err instanceof ApiError && err.status === 402) await get().refresh();
              if (err instanceof ApiError && err.status === 401) set({ token: null, user: null });
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
      partialize: (s) => ({ token: s.token, baseRevision: s.baseRevision, autoSync: s.autoSync, lastSyncAt: s.lastSyncAt }),
    },
  ),
);

/** Typed client for the Hash Harvest account server (see /server). */

export type PlanId = 'monthly' | 'yearly';

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  currency: string;
  interval: 'month' | 'year';
  perks: string[];
}

export interface Subscription {
  active: boolean;
  status: string;
  plan: PlanId | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

export interface AccountUser {
  id: string;
  email: string;
  createdAt: number;
  subscription: Subscription;
}

export interface SaveSummary {
  lifetimeEarnings: string;
  playTimeSec: number;
  halvings: number;
  scLifetime: number;
  gpuCount: number;
}

export interface CloudSaveMeta {
  revision: number;
  updatedAt: number;
  saveVersion: number;
  /** SHA-256 of the stored save envelope. */
  checksum?: string;
  summary: SaveSummary;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function request<T>(method: string, path: string, token: string | null, body?: unknown, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      keepalive,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Account server unreachable.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Request failed (${res.status}).`, err?.details);
  }
  return json as T;
}

interface AuthResponse {
  token: string;
  expiresAt: number;
  user: AccountUser;
}

export const cloudApi = {
  plans: () => request<{ devBilling: boolean; plans: Plan[] }>('GET', '/plans', null),
  register: (email: string, password: string) => request<AuthResponse>('POST', '/auth/register', null, { email, password }),
  login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', null, { email, password }),
  logout: (token: string) => request<{ ok: boolean }>('POST', '/auth/logout', token),
  me: (token: string) => request<{ user: AccountUser; save: CloudSaveMeta | null }>('GET', '/me', token),
  deleteAccount: (token: string, password: string) => request<{ ok: boolean }>('DELETE', '/me', token, { password }),
  checkout: (token: string, plan: PlanId) => request<{ url: string | null; demo: boolean; reactivated: boolean; user: AccountUser }>('POST', '/billing/checkout', token, { plan }),
  portal: (token: string) => request<{ url: string | null; demo: boolean }>('POST', '/billing/portal', token),
  demoCancel: (token: string) => request<{ user: AccountUser }>('POST', '/billing/cancel', token),
  getSave: (token: string) => request<CloudSaveMeta & { blob: string }>('GET', '/save', token),
  putSave: (token: string, blob: string, baseRevision: number | null, force: boolean, keepalive = false) =>
    request<{ save: CloudSaveMeta }>('PUT', '/save', token, { blob, baseRevision, force }, keepalive),
};

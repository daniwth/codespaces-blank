import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, devBilling } from './config.ts';
import { markWebhookEvent, transaction, users, webhookEventSeen, type UserRow } from './db.ts';
import { HttpError } from './http.ts';

export type PlanId = 'monthly' | 'yearly';

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  currency: string;
  interval: 'month' | 'year';
  stripePriceId: string;
  perks: string[];
}

const PERKS = ['Cloud save on every device', 'Automatic sync every 3 minutes', 'Conflict-safe revisions', 'Subscriber badge in the HUD'];

export const PLANS: Record<PlanId, Plan> = {
  monthly: { id: 'monthly', name: 'Miner Pass · Monthly', priceCents: 299, currency: 'usd', interval: 'month', stripePriceId: config.stripe.priceMonthly, perks: PERKS },
  yearly: { id: 'yearly', name: 'Miner Pass · Yearly', priceCents: 2499, currency: 'usd', interval: 'year', stripePriceId: config.stripe.priceYearly, perks: [...PERKS, '2 months free'] },
};

export const isPlanId = (v: unknown): v is PlanId => v === 'monthly' || v === 'yearly';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
/** Stripe statuses after which a subscription can never charge again. */
const TERMINAL_STATUSES = new Set(['none', 'canceled', 'incomplete_expired']);

export const isDemoSub = (user: UserRow): boolean => !!user.sub_id?.startsWith('demo_');
/** The user has a subscription that may still bill (or be reactivated) in Stripe. */
export const hasLiveStripeSub = (user: UserRow): boolean => !!user.sub_id && !isDemoSub(user) && !TERMINAL_STATUSES.has(user.sub_status);

export function subscriptionOf(user: UserRow) {
  // A missing period end is treated as inactive (fail closed).
  const active = ACTIVE_STATUSES.has(user.sub_status) && user.period_end > Date.now();
  return {
    active,
    status: active ? user.sub_status : user.sub_status === 'none' ? 'none' : ACTIVE_STATUSES.has(user.sub_status) ? 'expired' : user.sub_status,
    plan: (isPlanId(user.plan) ? user.plan : null) as PlanId | null,
    periodEnd: user.period_end || null,
    cancelAtPeriodEnd: user.cancel_at_period_end === 1,
  };
}

export const publicUser = (user: UserRow) => ({
  id: user.id,
  email: user.email,
  createdAt: user.created_at,
  subscription: subscriptionOf(user),
});

// ───────────────────────── Stripe REST (no SDK) ─────────────────────────

type FormValue = string | number | boolean | undefined | FormValue[] | { [key: string]: FormValue };

function encodeForm(params: Record<string, FormValue>): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, value: FormValue) => {
    if (value === undefined) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    else if (typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(`${prefix}[${k}]`, v));
    else out.append(prefix, String(value));
  };
  Object.entries(params).forEach(([k, v]) => walk(k, v));
  return out.toString();
}

async function stripe<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, FormValue>, idempotencyKey?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.stripe.apiBase}/v1${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${config.stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: method === 'POST' && params ? encodeForm(params) : undefined,
    });
  } catch (err) {
    console.error('[billing] Stripe unreachable', method, path, err instanceof Error ? err.message : err);
    throw new HttpError(502, 'billing_unavailable', 'The payment provider is unavailable. Please try again.');
  }
  let body: (T & { error?: { message?: string } }) | null = null;
  try {
    body = (await res.json()) as T & { error?: { message?: string } };
  } catch {
    body = null;
  }
  if (!res.ok || !body) {
    // Stripe messages can contain key fragments or price ids: log them, never forward them.
    console.error('[billing] Stripe error', res.status, method, path, body?.error?.message ?? '(non-JSON response)');
    throw new HttpError(502, 'billing_error', 'The payment provider rejected the request. Please try again later.');
  }
  return body;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: { current_period_end?: number; price?: { id?: string } }[] };
}

function planFromPrice(priceId: string | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === PLANS.monthly.stripePriceId) return 'monthly';
  if (priceId === PLANS.yearly.stripePriceId) return 'yearly';
  return null;
}

/** Persists an authoritative subscription object (always fetched from Stripe). */
function applySubscription(sub: StripeSubscription): void {
  const user = (sub.metadata?.userId && users.byId(sub.metadata.userId)) || users.byCustomer(sub.customer);
  if (!user) {
    console.warn('[billing] subscription for unknown user', sub.id);
    return;
  }
  const item = sub.items?.data?.[0];
  const plan = planFromPrice(item?.price?.id);
  if (!plan) {
    // Some other product on the same Stripe account: never grants a Miner Pass.
    console.warn('[billing] ignoring subscription with a non-Miner-Pass price', sub.id);
    return;
  }
  if (user.sub_id && user.sub_id !== sub.id && hasLiveStripeSub(user)) {
    // A stale/duplicate subscription must not overwrite the user's current one.
    console.warn('[billing] ignoring event for non-current subscription', sub.id, 'current', user.sub_id);
    return;
  }
  users.setSubscription(user.id, {
    plan,
    subId: sub.id,
    status: sub.status,
    periodEnd: (sub.current_period_end ?? item?.current_period_end ?? 0) * 1000,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

// ───────────────────────── Public billing API ─────────────────────────

export interface CheckoutResult {
  url: string | null;
  demo: boolean;
  reactivated: boolean;
}

export async function startCheckout(user: UserRow, planId: PlanId): Promise<CheckoutResult> {
  const plan = PLANS[planId];
  const sub = subscriptionOf(user);

  if (devBilling) {
    if (sub.active && !sub.cancelAtPeriodEnd) throw new HttpError(409, 'already_subscribed', 'You already have an active Miner Pass.');
    if (sub.active && sub.cancelAtPeriodEnd) {
      // Resume instead of stacking a second subscription.
      users.setSubscription(user.id, { plan: sub.plan, subId: user.sub_id, status: user.sub_status, periodEnd: user.period_end, cancelAtPeriodEnd: false });
      return { url: null, demo: true, reactivated: true };
    }
    // Demo mode: activate immediately without charging anything.
    const ms = plan.interval === 'month' ? 30 * 86_400_000 : 365 * 86_400_000;
    users.setSubscription(user.id, { plan: planId, subId: `demo_${user.id}`, status: 'active', periodEnd: Date.now() + ms, cancelAtPeriodEnd: false });
    return { url: null, demo: true, reactivated: false };
  }

  if (hasLiveStripeSub(user) && user.sub_id) {
    if (ACTIVE_STATUSES.has(user.sub_status) && user.cancel_at_period_end) {
      const resumed = await stripe<StripeSubscription>('POST', `/subscriptions/${user.sub_id}`, { cancel_at_period_end: false });
      applySubscription(resumed);
      return { url: null, demo: false, reactivated: true };
    }
    // past_due, unpaid, active… → one subscription per user; fix it in the portal.
    throw new HttpError(409, 'manage_in_portal', 'You already have a Miner Pass subscription. Manage it from "Manage billing".');
  }

  if (!plan.stripePriceId) throw new HttpError(500, 'plan_not_configured', 'This plan is not available right now.');
  let customer = user.stripe_customer_id;
  if (!customer) {
    const created = await stripe<{ id: string }>('POST', '/customers', { email: user.email, metadata: { userId: user.id } }, `customer-${user.id}`);
    customer = created.id;
    users.setCustomer(user.id, customer);
  }
  const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    subscription_data: { metadata: { userId: user.id } },
    metadata: { userId: user.id },
    allow_promotion_codes: true,
    success_url: `${config.appUrl}/?checkout=success`,
    cancel_url: `${config.appUrl}/?checkout=cancel`,
  });
  return { url: session.url, demo: false, reactivated: false };
}

export async function openPortal(user: UserRow): Promise<{ url: string | null; demo: boolean }> {
  if (devBilling) return { url: null, demo: true };
  if (!user.stripe_customer_id) throw new HttpError(400, 'no_customer', 'No billing account yet.');
  const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', { customer: user.stripe_customer_id, return_url: `${config.appUrl}/?billing=return` });
  return { url: session.url, demo: false };
}

/** Demo-only: cancel at period end, keeping access until then. */
export function demoCancel(user: UserRow): void {
  if (!devBilling) throw new HttpError(400, 'not_demo', 'Use the billing portal to manage your subscription.');
  users.setSubscription(user.id, {
    plan: isPlanId(user.plan) ? user.plan : null,
    subId: user.sub_id,
    status: user.sub_status,
    periodEnd: user.period_end,
    cancelAtPeriodEnd: true,
  });
}

/**
 * Before deleting an account, make sure Stripe will never charge it again.
 * Throws (and the account is kept) if the cancellation cannot be confirmed.
 */
export async function cancelBillingForDeletion(user: UserRow): Promise<void> {
  if (devBilling || !hasLiveStripeSub(user) || !user.sub_id) return;
  const canceled = await stripe<StripeSubscription>('DELETE', `/subscriptions/${user.sub_id}`);
  if (!TERMINAL_STATUSES.has(canceled.status)) {
    throw new HttpError(502, 'billing_error', 'Could not cancel your subscription. Your account was not deleted.');
  }
}

/** Verifies a Stripe-Signature header (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, toleranceSec = 300): void {
  if (!header) throw new HttpError(400, 'bad_signature', 'Missing Stripe-Signature header.');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d{1,12}$/.test(t) || signatures.length === 0) throw new HttpError(400, 'bad_signature', 'Malformed Stripe-Signature header.');
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new HttpError(400, 'bad_signature', 'Webhook timestamp outside tolerance.');
  const expected = createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest();
  const ok = signatures.some((sig) => {
    const buf = Buffer.from(sig, 'hex');
    return buf.length === expected.length && timingSafeEqual(buf, expected);
  });
  if (!ok) throw new HttpError(400, 'bad_signature', 'Invalid webhook signature.');
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function parseEvent(raw: Buffer): StripeEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_event', 'Webhook body is not JSON.');
  }
  const e = parsed as Partial<StripeEvent> | null;
  if (!e || typeof e.id !== 'string' || typeof e.type !== 'string' || typeof e.data !== 'object' || e.data === null || typeof e.data.object !== 'object' || e.data.object === null) {
    throw new HttpError(400, 'bad_event', 'Malformed webhook event.');
  }
  return e as StripeEvent;
}

export async function handleWebhook(raw: Buffer, signature: string | undefined): Promise<void> {
  if (devBilling || !config.stripe.webhookSecret) throw new HttpError(400, 'webhooks_disabled', 'Stripe webhooks are not configured.');
  verifyStripeSignature(raw, signature, config.stripe.webhookSecret);
  const event = parseEvent(raw);
  if (webhookEventSeen(event.id)) return; // Stripe retry of an event we already applied
  const obj = event.data.object;

  // Do all network work first; the event is only marked as processed together
  // with the state change, so any failure → 5xx → Stripe retries.
  let customerLink: { userId: string; customer: string } | null = null;
  let subscription: StripeSubscription | null = null;
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : null;
      const customer = typeof obj.customer === 'string' ? obj.customer : null;
      const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
      if (userId && customer) customerLink = { userId, customer };
      if (subId) subscription = await stripe<StripeSubscription>('GET', `/subscriptions/${subId}`);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // Re-fetch instead of trusting the payload: immune to out-of-order delivery.
      if (typeof obj.id !== 'string') throw new HttpError(400, 'bad_event', 'Subscription event without id.');
      subscription = await stripe<StripeSubscription>('GET', `/subscriptions/${obj.id}`);
      break;
    }
    default:
      break;
  }

  transaction(() => {
    if (!markWebhookEvent(event.id)) return;
    if (customerLink && users.byId(customerLink.userId)) users.setCustomer(customerLink.userId, customerLink.customer);
    if (subscription) applySubscription(subscription);
  });
}

/** Startup housekeeping for real billing. */
export function onBillingStartup(): void {
  if (devBilling) {
    console.warn('[billing] DEMO mode: subscriptions activate instantly and nothing is charged.');
    return;
  }
  const voided = users.expireDemoSubscriptions();
  if (voided > 0) console.warn(`[billing] voided ${voided} demo subscription(s) left over from demo mode.`);
  if (!config.stripe.webhookSecret) console.warn('[billing] STRIPE_WEBHOOK_SECRET is not set: subscriptions will never activate!');
  if (!config.stripe.priceMonthly || !config.stripe.priceYearly) console.warn('[billing] STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY missing: those plans cannot be bought.');
}

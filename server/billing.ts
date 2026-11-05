import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, devBilling } from './config.ts';
import { markWebhookEvent, transaction, users, type UserRow } from './db.ts';
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

export function subscriptionOf(user: UserRow) {
  const active = ACTIVE_STATUSES.has(user.sub_status) && (user.period_end === 0 || user.period_end > Date.now());
  return {
    active,
    status: active ? user.sub_status : user.sub_status === 'none' ? 'none' : user.period_end > 0 && user.period_end <= Date.now() ? 'expired' : user.sub_status,
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

async function stripe<T>(method: 'GET' | 'POST', path: string, params?: Record<string, FormValue>): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: method === 'POST' && params ? encodeForm(params) : undefined,
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new HttpError(502, 'stripe_error', body.error?.message ?? `Stripe request failed (${res.status}).`);
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

function applySubscription(sub: StripeSubscription): void {
  const user = (sub.metadata?.userId && users.byId(sub.metadata.userId)) || users.byCustomer(sub.customer);
  if (!user) {
    console.warn('[billing] subscription for unknown user', sub.id);
    return;
  }
  const item = sub.items?.data?.[0];
  const periodEnd = (sub.current_period_end ?? item?.current_period_end ?? 0) * 1000;
  users.setSubscription(user.id, {
    plan: planFromPrice(item?.price?.id) ?? (isPlanId(user.plan) ? user.plan : null),
    subId: sub.id,
    status: sub.status,
    periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

// ───────────────────────── Public billing API ─────────────────────────

export async function startCheckout(user: UserRow, planId: PlanId): Promise<{ url: string | null; demo: boolean }> {
  const plan = PLANS[planId];
  if (subscriptionOf(user).active && !user.cancel_at_period_end) {
    throw new HttpError(409, 'already_subscribed', 'You already have an active Miner Pass.');
  }
  if (devBilling) {
    // Demo mode: activate immediately without charging anything.
    const ms = plan.interval === 'month' ? 30 * 86_400_000 : 365 * 86_400_000;
    users.setSubscription(user.id, { plan: planId, subId: `demo_${user.id}`, status: 'active', periodEnd: Date.now() + ms, cancelAtPeriodEnd: false });
    return { url: null, demo: true };
  }
  if (!plan.stripePriceId) throw new HttpError(500, 'plan_not_configured', `STRIPE_PRICE_${planId.toUpperCase()} is not set on the server.`);
  let customer = user.stripe_customer_id;
  if (!customer) {
    const created = await stripe<{ id: string }>('POST', '/customers', { email: user.email, metadata: { userId: user.id } });
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
  return { url: session.url, demo: false };
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

/** Verifies a Stripe-Signature header (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, toleranceSec = 300): void {
  if (!header) throw new HttpError(400, 'bad_signature', 'Missing Stripe-Signature header.');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || signatures.length === 0) throw new HttpError(400, 'bad_signature', 'Malformed Stripe-Signature header.');
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

export async function handleWebhook(raw: Buffer, signature: string | undefined): Promise<void> {
  if (devBilling || !config.stripe.webhookSecret) throw new HttpError(400, 'webhooks_disabled', 'Stripe webhooks are not configured.');
  verifyStripeSignature(raw, signature, config.stripe.webhookSecret);
  const event = JSON.parse(raw.toString('utf8')) as StripeEvent;
  if (!markWebhookEvent(event.id)) return; // already processed (Stripe retries)
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : null;
      const customer = typeof obj.customer === 'string' ? obj.customer : null;
      const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
      if (userId && customer) transaction(() => users.setCustomer(userId, customer));
      if (subId) applySubscription(await stripe<StripeSubscription>('GET', `/subscriptions/${subId}`));
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      applySubscription(obj as unknown as StripeSubscription);
      break;
    default:
      break;
  }
}

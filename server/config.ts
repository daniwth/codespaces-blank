import { resolve } from 'node:path';

const env = process.env;

/** Server configuration, read once from the environment (see .env.example). */
export const config = {
  port: Number(env.PORT ?? 8787),
  dataDir: resolve(env.DATA_DIR ?? './data'),
  /** Public URL of the web app, used for Stripe redirect URLs. */
  appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** Directory with the built frontend to serve in production (optional). */
  staticDir: resolve(env.STATIC_DIR ?? './dist'),
  sessionDays: Number(env.SESSION_DAYS ?? 30),
  /** Number of reverse proxies in front of the server whose X-Forwarded-For can be trusted (0 = none). */
  trustProxyHops: Math.max(0, Number(env.TRUST_PROXY ?? 0) || 0),
  maxSaveBytes: 2 * 1024 * 1024,
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY ?? '',
    /** Overridable only to point integration tests at a fake Stripe. */
    apiBase: (env.STRIPE_API_BASE ?? 'https://api.stripe.com').replace(/\/$/, ''),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    priceMonthly: env.STRIPE_PRICE_MONTHLY ?? '',
    priceYearly: env.STRIPE_PRICE_YEARLY ?? '',
  },
  mail: {
    apiUrl: env.MAIL_API_URL ?? '',
    apiKey: env.MAIL_API_KEY ?? '',
    from: env.MAIL_FROM ?? '',
  },
} as const;

/**
 * Billing mode. `stripe` when a secret key is present; otherwise `demo` (free
 * instant activation) — but demo must be requested explicitly in production,
 * so a missing key can never silently hand out free subscriptions.
 */
function resolveBillingMode(): 'stripe' | 'demo' {
  const requested = env.BILLING_MODE;
  if (requested === 'stripe' || (!requested && config.stripe.secretKey)) {
    if (!config.stripe.secretKey) throw new Error('BILLING_MODE=stripe requires STRIPE_SECRET_KEY.');
    return 'stripe';
  }
  if (requested && requested !== 'demo') throw new Error(`Unknown BILLING_MODE "${requested}" (use stripe | demo).`);
  if (env.NODE_ENV === 'production' && requested !== 'demo') {
    throw new Error('Refusing to start: no STRIPE_SECRET_KEY in production. Set it, or BILLING_MODE=demo explicitly.');
  }
  return 'demo';
}

export const billingMode = resolveBillingMode();
export const devBilling = billingMode === 'demo';

/**
 * Mail mode. `log` prints emails (links included) to the server console and is only the default
 * outside production; `http` POSTs JSON to MAIL_API_URL (Resend-style). Production without a
 * working mailer refuses to start: registration and password reset depend on email.
 */
function resolveMailMode(): 'log' | 'http' {
  const production = env.NODE_ENV === 'production';
  const requested = env.MAIL_MODE || (production ? '' : 'log');
  if (requested === 'http') {
    if (!config.mail.apiUrl || !config.mail.apiKey || !config.mail.from) {
      throw new Error('MAIL_MODE=http requires MAIL_API_URL, MAIL_API_KEY and MAIL_FROM.');
    }
    return 'http';
  }
  if (requested === 'log') {
    if (production) throw new Error('Refusing to start: MAIL_MODE=log never delivers email. Configure MAIL_MODE=http in production.');
    return 'log';
  }
  if (requested) throw new Error(`Unknown MAIL_MODE "${requested}" (use log | http).`);
  throw new Error('Refusing to start: no mailer configured in production. Set MAIL_MODE=http with MAIL_API_URL, MAIL_API_KEY and MAIL_FROM.');
}

export const mailMode = resolveMailMode();
/** API responses may carry the email link (`devLink`) only outside production and in log mode. */
export const devLinks = mailMode === 'log' && env.NODE_ENV !== 'production';

/** Must match SAVE_SALT in src/config/gameBalance.ts (integrity check, not a secret). */
export const SAVE_SALT = 'HHT::pixel-rigs::v1';
export const SAVE_FORMAT = 'hash-harvest-save';
export const MAX_SAVE_VERSION = 5;

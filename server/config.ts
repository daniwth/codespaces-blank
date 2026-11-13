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
 * True when this server is not a local development box: NODE_ENV=production, or a public APP_URL
 * (anything but localhost / 127.0.0.1 / ::1). A deployed server that forgot NODE_ENV is still "public".
 */
export function isPublicDeployment(nodeEnv: string | undefined = env.NODE_ENV, appUrl: string = config.appUrl): boolean {
  if (nodeEnv === 'production') return true;
  try {
    const host = new URL(appUrl).hostname.replace(/^\[|\]$/g, '');
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost'));
  } catch {
    // An APP_URL that does not parse cannot be trusted to be local.
    return true;
  }
}

const publicDeployment = isPublicDeployment();

/**
 * Billing mode. `stripe` when a secret key is present; otherwise `demo` (free
 * instant activation), which is only allowed on a local development server: a public
 * deployment without Stripe refuses to start, so nobody gets free subscriptions by accident.
 */
function resolveBillingMode(): 'stripe' | 'demo' {
  const requested = env.BILLING_MODE;
  if (requested === 'stripe' || (!requested && config.stripe.secretKey)) {
    if (!config.stripe.secretKey) throw new Error('BILLING_MODE=stripe requires STRIPE_SECRET_KEY.');
    return 'stripe';
  }
  if (requested && requested !== 'demo') throw new Error(`Unknown BILLING_MODE "${requested}" (use stripe | demo).`);
  // Demo billing hands out free subscriptions: it never runs on a public deployment, not even on request.
  if (publicDeployment) {
    throw new Error('Refusing to start: demo billing on a public deployment (NODE_ENV=production or a non-local APP_URL). Set STRIPE_SECRET_KEY.');
  }
  return 'demo';
}

export const billingMode = resolveBillingMode();
export const devBilling = billingMode === 'demo';

/**
 * Mail mode. `log` prints emails (links included) to the server console and is only the default
 * on a local development server; `http` POSTs JSON to MAIL_API_URL (Resend-style). Production without a
 * working mailer refuses to start: registration and password reset depend on email.
 */
function resolveMailMode(): 'log' | 'http' {
  const production = publicDeployment;
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
export const devLinks = mailMode === 'log' && !publicDeployment;

/** Must match SAVE_SALT in src/config/gameBalance.ts (integrity check, not a secret). */
export const SAVE_SALT = 'HHT::pixel-rigs::v1';
export const SAVE_FORMAT = 'hash-harvest-save';
export const MAX_SAVE_VERSION = 9;

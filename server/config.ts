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
  maxSaveBytes: 2 * 1024 * 1024,
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    priceMonthly: env.STRIPE_PRICE_MONTHLY ?? '',
    priceYearly: env.STRIPE_PRICE_YEARLY ?? '',
  },
} as const;

/** Without a Stripe key the server runs a demo billing flow (no real charge). */
export const devBilling = config.stripe.secretKey === '';

/** Must match SAVE_SALT in src/config/gameBalance.ts (integrity check, not a secret). */
export const SAVE_SALT = 'HHT::pixel-rigs::v1';
export const SAVE_FORMAT = 'hash-harvest-save';
export const MAX_SAVE_VERSION = 2;

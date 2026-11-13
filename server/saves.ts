import { createHash } from 'node:crypto';
import { MAX_SAVE_VERSION, SAVE_FORMAT, SAVE_SALT } from './config.ts';
import type { SaveSummary } from './db.ts';
import { HttpError } from './http.ts';

interface Envelope {
  format: string;
  version: number;
  checksum: string;
  data: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Upper bounds of the summary fields (generous: far beyond what the game can reach). */
export const SUMMARY_LIMITS = {
  /** Ten years of play time, in seconds. */
  playTimeSec: 10 * 365 * 86_400,
  halvings: 1_000_000,
  scLifetime: 1_000_000_000,
  gpuCount: 100_000,
} as const;

/** A non-negative decimal (optionally with an exponent of at most four digits), as break_infinity prints it. */
const EARNINGS_RE = /^\d{1,30}(\.\d{1,20})?(e\+?\d{1,4})?$/i;

/**
 * A summary number is optional (older saves lack some), but when present it must be a finite,
 * non-negative number within its bound: NaN, Infinity, negatives and absurd values reject the save.
 */
function boundedInt(value: unknown, max: number, field: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new HttpError(400, 'invalid_save', `Save field "${field}" is out of range.`);
  }
  return Math.floor(value);
}

function boundedEarnings(value: unknown): string {
  if (value === undefined || value === null) return '0';
  if (typeof value !== 'string' || !EARNINGS_RE.test(value)) throw new HttpError(400, 'invalid_save', 'Save field "lifetimeEarnings" is out of range.');
  return value;
}

/**
 * Validates an exported save (Base64 JSON envelope signed with SHA-256, the
 * same format the client exports) and extracts a small summary for the UI.
 */
export function inspectSave(blob: string): { checksum: string; version: number; summary: SaveSummary } {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(Buffer.from(blob, 'base64').toString('utf8')) as Envelope;
  } catch {
    throw new HttpError(400, 'invalid_save', 'Save is not valid Base64 JSON.');
  }
  if (!isObj(envelope) || envelope.format !== SAVE_FORMAT || !isObj(envelope.data) || typeof envelope.checksum !== 'string') {
    throw new HttpError(400, 'invalid_save', 'Unknown save format.');
  }
  if (typeof envelope.version !== 'number' || !Number.isInteger(envelope.version) || envelope.version < 1 || envelope.version > MAX_SAVE_VERSION) {
    throw new HttpError(400, 'invalid_save', 'Unsupported save version.');
  }
  const expected = createHash('sha256').update(SAVE_SALT + JSON.stringify(envelope.data)).digest('hex');
  if (expected !== envelope.checksum) throw new HttpError(400, 'invalid_save', 'Save checksum mismatch.');

  const d = envelope.data;
  if (d.stats !== undefined && !isObj(d.stats)) throw new HttpError(400, 'invalid_save', 'Save field "stats" is malformed.');
  if (d.gpus !== undefined && !isObj(d.gpus)) throw new HttpError(400, 'invalid_save', 'Save field "gpus" is malformed.');
  const stats = isObj(d.stats) ? d.stats : {};
  const gpuCount = isObj(d.gpus) ? Object.keys(d.gpus).length : 0;
  return {
    checksum: envelope.checksum,
    version: envelope.version,
    summary: {
      lifetimeEarnings: boundedEarnings(d.lifetimeEarnings),
      playTimeSec: boundedInt(stats.playTimeSec, SUMMARY_LIMITS.playTimeSec, 'stats.playTimeSec'),
      halvings: boundedInt(stats.halvings, SUMMARY_LIMITS.halvings, 'stats.halvings'),
      scLifetime: boundedInt(d.scLifetime, SUMMARY_LIMITS.scLifetime, 'scLifetime'),
      gpuCount: boundedInt(gpuCount, SUMMARY_LIMITS.gpuCount, 'gpus'),
    },
  };
}

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
  if (typeof envelope.version !== 'number' || envelope.version < 1 || envelope.version > MAX_SAVE_VERSION) {
    throw new HttpError(400, 'invalid_save', 'Unsupported save version.');
  }
  const expected = createHash('sha256').update(SAVE_SALT + JSON.stringify(envelope.data)).digest('hex');
  if (expected !== envelope.checksum) throw new HttpError(400, 'invalid_save', 'Save checksum mismatch.');

  const d = envelope.data;
  const stats = isObj(d.stats) ? d.stats : {};
  return {
    checksum: envelope.checksum,
    version: envelope.version,
    summary: {
      lifetimeEarnings: typeof d.lifetimeEarnings === 'string' ? d.lifetimeEarnings.slice(0, 40) : '0',
      playTimeSec: typeof stats.playTimeSec === 'number' ? stats.playTimeSec : 0,
      halvings: typeof stats.halvings === 'number' ? stats.halvings : 0,
      scLifetime: typeof d.scLifetime === 'number' ? d.scLifetime : 0,
      gpuCount: isObj(d.gpus) ? Object.keys(d.gpus).length : 0,
    },
  };
}

import { describe, expect, it } from 'vitest';
import { GPU_BY_ID, GPU_CATALOG, PSU_BY_ID } from '../../src/config/hardwareCatalog';
import { ROOM_BY_ID } from '../../src/config/roomsCatalog';
import { PHYSICS } from '../../src/config/gameBalance';
import { gridTariff } from '../../src/store/gamePhysics';
import { gpuEconomics, roomPsuEfficiency, type GpuEconomicsCtx } from '../../src/store/pricing';
import { useLangStore } from '../../src/i18n';
import '../../src/i18n/es';
import { ES } from '../../src/i18n/es';
import { formatClock, formatDate, formatDateTime, formatMoney, localeOf } from '../../src/utils/formatters';
import { measurePixelText, pixelTextOf } from '../../src/engine/SpriteManager';
import { starterWorld } from './helpers';

const ctx = (patch: Partial<GpuEconomicsCtx> = {}): GpuEconomicsCtx => ({
  roomId: 'bedroom', hashMul: 1, electricityMul: 1, psuEfficiency: 1, coin: 'CC', coinPrice: 1, difficulty: 1, poolMul: 1, ...patch,
});

describe('shop net ROI (gpuEconomics)', () => {
  const px = GPU_BY_ID.px460;

  it('subtracts the real power bill: wall watts at the room price, grid tariff and PSU efficiency', () => {
    const e = gpuEconomics(px, px.price, ctx({ psuEfficiency: 0.82 }));
    const gross = (px.hashrate / 1e6) * PHYSICS.rewardPerMHs;
    const bill = (px.power / 0.82) * gridTariff(px.id) * PHYSICS.pricePerWattSec * ROOM_BY_ID.bedroom.priceMul;
    expect(e.grossPerSec).toBeCloseTo(gross, 10);
    expect(e.powerPerSec).toBeCloseTo(bill, 10);
    expect(e.netPerSec).toBeCloseTo(gross - bill, 10);
    expect(e.roiSec).toBeCloseTo(px.price / (gross - bill), 6);
    // The net ROI is always slower than the old gross one.
    expect(e.roiSec).toBeGreaterThan(px.price / gross);
  });

  it('a better PSU and a cheaper room shorten the net ROI', () => {
    const base = gpuEconomics(px, px.price, ctx({ psuEfficiency: 0.82 }));
    expect(gpuEconomics(px, px.price, ctx({ psuEfficiency: 0.98 })).roiSec).toBeLessThan(base.roiSec);
    expect(gpuEconomics(px, px.price, ctx({ psuEfficiency: 0.82, roomId: 'warehouse' })).roiSec).toBeLessThan(base.roiSec);
    expect(gpuEconomics(px, px.price, ctx({ psuEfficiency: 0.82, electricityMul: 0.6 })).powerPerSec).toBeCloseTo(base.powerPerSec * 0.6, 10);
  });

  it('follows pool, coin price and difficulty, and reports "never" when the card loses money', () => {
    const base = gpuEconomics(px, px.price, ctx());
    expect(gpuEconomics(px, px.price, ctx({ poolMul: 0.98, coinPrice: 2, difficulty: 1.4 })).grossPerSec).toBeCloseTo((base.grossPerSec * 0.98 * 2) / 1.4, 10);
    const crash = gpuEconomics(px, px.price, ctx({ coinPrice: 0.0001 }));
    expect(crash.netPerSec).toBeLessThan(0);
    expect(crash.roiSec).toBe(Number.POSITIVE_INFINITY);
  });

  it('every catalog card is net positive in the bedroom on the weakest PSU that carries it (at $1)', () => {
    GPU_CATALOG.forEach((g) => {
      const e = gpuEconomics(g, g.price, ctx({ psuEfficiency: roomPsuEfficiency({ racks: {}, psus: {} }, 'bedroom', g.power) }));
      expect(e.netPerSec, g.id).toBeGreaterThan(0);
    });
  });

  it('roomPsuEfficiency weighs the PSUs mounted in the room by capacity and falls back to the catalog', () => {
    const { data, rackUid } = starterWorld();
    expect(roomPsuEfficiency(data, 'bedroom')).toBeCloseTo(PSU_BY_ID.psu500.efficiency, 10);
    const racks = { ...data.racks, extra: { ...data.racks[rackUid], uid: 'extra', pad: 1, psuUid: 'p2', gpuSlots: [null, null] } };
    const psus = { ...data.psus, p2: { uid: 'p2', modelId: 'psu2000' } };
    const expected = (500 * 0.82 + 2000 * 0.9) / 2500;
    expect(roomPsuEfficiency({ racks, psus }, 'bedroom')).toBeCloseTo(expected, 10);
    // No PSU in the garage yet: the cheapest PSU that carries the card stands in.
    expect(roomPsuEfficiency(data, 'garage', 100)).toBe(PSU_BY_ID.psu500.efficiency);
    expect(roomPsuEfficiency(data, 'garage', 1500)).toBe(PSU_BY_ID.psu2000.efficiency);
  });
});

describe('dates and times follow the game language, not the browser locale', () => {
  const ts = Date.UTC(2026, 2, 5, 15, 4, 9);

  it('maps the language to a full locale', () => {
    expect(localeOf('es')).toBe('es-ES');
    expect(localeOf('en')).toBe('en-US');
  });

  it('formats with the active language and switches with it', () => {
    useLangStore.getState().setLang('es');
    expect(formatDate(ts)).toBe(new Date(ts).toLocaleDateString('es-ES'));
    expect(formatClock(ts)).toBe(new Date(ts).toLocaleTimeString('es-ES', { hour12: false }));
    expect(formatDateTime(ts)).toBe(new Date(ts).toLocaleString('es-ES', { hour12: false }));
    expect(formatMoney(499, 'EUR')).toBe(new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(4.99));
    useLangStore.getState().setLang('en');
    expect(formatDate(ts)).toBe(new Date(ts).toLocaleDateString('en-US'));
    expect(formatDate(ts)).not.toBe(formatDate(ts, 'es'));
    expect(formatClock(ts)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('3x5 canvas font', () => {
  it('draws accented Spanish as clean capitals and keeps Ñ', () => {
    expect(pixelTextOf('Vacío')).toBe('VACIO');
    expect(pixelTextOf('APAGÓN - RED CAÍDA')).toBe('APAGON - RED CAIDA');
    expect(pixelTextOf('¡Año de pingüinos!')).toBe('¡AÑO DE PINGUINOS!');
    expect(measurePixelText('VACÍO')).toBe(measurePixelText('VACIO'));
  });

  it('every rack label has a short Spanish entry that fits a rack', () => {
    ['NO PSU (rack)', 'OVERLOAD (rack)', 'HOT! (rack)', 'REBOOT (rack)', 'NO POWER (rack)', 'EMPTY (rack)'].forEach((key) => {
      expect(ES[key], key).toBeTruthy();
      // Icon (11 px) + text must stay within the 56 px pad pitch.
      expect(measurePixelText(ES[key]) + 11, key).toBeLessThanOrEqual(56);
      expect(pixelTextOf(ES[key])).not.toContain('?');
    });
  });
});

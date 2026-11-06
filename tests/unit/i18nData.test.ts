import { describe, expect, it } from 'vitest';
import { CONTRACT_DEFS, CONTRACT_DIFFICULTY } from '../../src/config/contracts';
import { ACHIEVEMENTS, NETWORK_EVENTS, POOLS } from '../../src/config/gameBalance';
import { COOLER_CATALOG, GPU_CATALOG, PSU_CATALOG, QUALITY_DEFS, RACK_CATALOG } from '../../src/config/hardwareCatalog';
import { PRESTIGE_TREE } from '../../src/config/prestigeTree';
import { ROOM_CATALOG } from '../../src/config/roomsCatalog';
import { tr, useLangStore } from '../../src/i18n';
import { ES } from '../../src/i18n/es';

const needed: string[] = [
  ...GPU_CATALOG.map((m) => m.name),
  ...PSU_CATALOG.map((m) => m.name),
  ...COOLER_CATALOG.map((m) => m.name),
  ...RACK_CATALOG.map((m) => m.name),
  ...Object.values(QUALITY_DEFS).map((q) => q.label),
  ...ROOM_CATALOG.flatMap((r) => [r.name, r.subtitle]),
  ...Object.values(POOLS).flatMap((p) => [p.name, p.tagline, p.description]),
  ...Object.values(NETWORK_EVENTS).flatMap((e) => [e.name, e.description]),
  ...ACHIEVEMENTS.flatMap((a) => [a.name, a.description]),
  ...PRESTIGE_TREE.flatMap((n) => [
    n.name,
    n.description,
    ...Array.from({ length: n.maxLevel + 1 }, (_, level) => n.format(level)),
  ]),
  ...Object.values(CONTRACT_DEFS).map((c) => c.name),
  ...Object.values(CONTRACT_DIFFICULTY).map((d) => d.label),
];

describe('i18n config data', () => {
  it('has a Spanish entry for every catalog name, description and talent effect', () => {
    expect(needed.filter((en) => !(en in ES))).toEqual([]);
  });

  it('translates the talent effect strings and keeps numbers intact', () => {
    useLangStore.getState().setLang('es');
    const hash = PRESTIGE_TREE.find((n) => n.id === 'hash_core');
    const tech = PRESTIGE_TREE.find((n) => n.id === 'tech_union');
    expect(hash && tr(hash.format(3))).toBe('+30% de hashrate');
    expect(tech && tr(tech.format(2))).toBe('+2 téc., +50% velocidad');
    useLangStore.getState().setLang('en');
    expect(hash && tr(hash.format(3))).toBe('+30% hashrate');
  });

  it('translates store messages with their params and stays English by default', () => {
    useLangStore.getState().setLang('es');
    expect(tr('Sold for {price}.', { price: '$5' })).toBe('Vendido por $5.');
    expect(tr('RAID! Electrical inspection in {room}. Fined ${fine}, rigs offline 30s.', { room: tr('Garage'), fine: '12' }))
      .toBe('REDADA! Inspección eléctrica en Garaje. Multa de $12, rigs apagados 30s.');
    useLangStore.getState().setLang('en');
    expect(tr('Sold for {price}.', { price: '$5' })).toBe('Sold for $5.');
  });
});

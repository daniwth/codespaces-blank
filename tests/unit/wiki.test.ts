import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchWiki, highlightRegex, normalizeText, queryTokens } from '../../src/components/wiki/wikiSearch';
import { CHALLENGES } from '../../src/config/challenges';
import { CONTRACT_KINDS } from '../../src/config/contracts';
import { ACHIEVEMENTS, NETWORK_EVENTS, PHYSICS, POOL_ORDER } from '../../src/config/gameBalance';
import { COOLER_CATALOG, GPU_BY_ID, GPU_CATALOG, PSU_CATALOG, QUALITY_ORDER, RACK_BY_ID, RACK_CATALOG } from '../../src/config/hardwareCatalog';
import { PRESTIGE_TREE, earningsForSc, scForEarnings } from '../../src/config/prestigeTree';
import { ROOM_CATALOG } from '../../src/config/roomsCatalog';
import '../../src/i18n/es';
import { getWikiSections } from '../../src/config/wikiContent';
import * as T from '../../src/config/wikiTables';
import type { WikiBlock, WikiSection, WikiTable } from '../../src/config/wikiTypes';
import { simulate } from '../../src/store/gamePhysics';
import { createGpu, createInitialData, createRack } from '../../src/store/initialState';
import { useGameStore } from '../../src/store/useGameStore';
import { starterWorld } from './helpers';

const NOW = 1_800_000_000_000;

/** The Spanish pages (the original text); the English twin is checked in the bilingual block. */
const WIKI_SECTIONS = getWikiSections('es');

const allTables = (): WikiTable[] =>
  WIKI_SECTIONS.flatMap((s) => s.entries.flatMap((e) => e.blocks.filter((b): b is Extract<WikiBlock, { type: 'table' }> => b.type === 'table').map((b) => b.table)));

describe('wiki tables are generated from the catalogs', () => {
  it.each([
    ['gpus', T.gpuTable, GPU_CATALOG.map((g) => g.id)],
    ['grid tariff', T.gridTariffTable, GPU_CATALOG.map((g) => g.id)],
    ['maintenance', T.maintenanceTable, GPU_CATALOG.map((g) => g.id)],
    ['cooling guide', T.coolingGuideTable, GPU_CATALOG.map((g) => g.id)],
    ['qualities', T.qualityTable, QUALITY_ORDER],
    ['psus', T.psuTable, PSU_CATALOG.map((p) => p.id)],
    ['coolers', T.coolerTable, COOLER_CATALOG.map((c) => c.id)],
    ['racks', T.rackTable, RACK_CATALOG.map((r) => r.id)],
    ['rooms', T.roomTable, ROOM_CATALOG.map((r) => r.id)],
    ['talents', T.talentTable, PRESTIGE_TREE.map((t) => t.id)],
    ['pools', T.poolTable, POOL_ORDER],
    ['events', T.eventTable, Object.keys(NETWORK_EVENTS)],
    ['achievements', T.achievementTable, ACHIEVEMENTS.map((a) => a.id)],
    ['contract kinds', T.contractKindTable, CONTRACT_KINDS],
    ['challenges', T.challengeTable, CHALLENGES.map((c) => c.id)],
  ] as const)('%s: one row per catalog entry, in catalog order', (_name, build, ids) => {
    const table = build();
    expect(table.rows.map((r) => r.id)).toEqual([...ids]);
    table.rows.forEach((r) => {
      expect(r.cells).toHaveLength(table.columns.length);
      r.cells.forEach((c) => expect(c, `${table.id}/${r.id}`).not.toMatch(/undefined|NaN|Infinity/));
    });
  });

  it('a GPU added to the catalog shows up in every GPU table automatically', () => {
    const extra = { ...GPU_CATALOG[GPU_CATALOG.length - 1], id: 'test_gpu', name: 'Test GPU', tier: 99 };
    // A real catalog entry lands in both the list and the by-id index (built from the list at load).
    GPU_CATALOG.push(extra);
    GPU_BY_ID[extra.id] = extra;
    try {
      for (const build of [T.gpuTable, T.gridTariffTable, T.coolingGuideTable, T.maintenanceTable]) {
        const t = build();
        expect(t.rows).toHaveLength(GPU_CATALOG.length);
        expect(t.rows[t.rows.length - 1].id).toBe('test_gpu');
      }
    } finally {
      GPU_CATALOG.pop();
      delete GPU_BY_ID[extra.id];
    }
  });

  it('room columns follow the room catalog (cooling guide)', () => {
    const t = T.coolingGuideTable();
    expect(t.columns.slice(1).map((c) => c.label)).toEqual(ROOM_CATALOG.map((r) => r.name));
  });

  it('every table in the content has well-formed rows and unique row ids', () => {
    const tables = allTables();
    expect(tables.length).toBeGreaterThanOrEqual(20);
    tables.forEach((t) => {
      expect(new Set(t.rows.map((r) => r.id)).size, t.id).toBe(t.rows.length);
      t.rows.forEach((r) => expect(r.cells).toHaveLength(t.columns.length));
    });
  });

  it('silicon lottery odds add up to 100% at every Silicon Whisperer level and favour Gold/God', () => {
    for (let l = 0; l <= 3; l += 1) {
      const o = T.qualityOdds(l);
      expect(QUALITY_ORDER.reduce((a, q) => a + o[q], 0)).toBeCloseTo(1, 9);
    }
    expect(T.qualityOdds(0).god).toBeCloseTo(0.05, 9);
    expect(T.qualityOdds(3).god).toBeGreaterThan(T.qualityOdds(0).god);
  });

  it('the $SC milestones match scForEarnings and the example run peaks inside the run', () => {
    const ms = T.scMilestones(8);
    ms.forEach((m) => {
      expect(m.earnings).toBe(earningsForSc(m.sc));
      expect(scForEarnings(m.earnings)).toBe(m.sc);
    });
    const best = ms.reduce((a, b) => (b.scPerHour > a.scPerHour ? b : a));
    expect(best.sc).toBeGreaterThan(ms[0].sc);
    expect(best.sc).toBeLessThan(ms[ms.length - 1].sc);
  });

  it('level table lists the pool and bot unlocks', () => {
    const text = T.levelTable().rows.map((r) => r.cells.join(' ')).join('\n');
    expect(text).toContain('Solo Mining');
    expect(text).toContain('Darknet Anon Pool');
    expect(text).toContain('Trading bots');
  });
});

describe('wiki cooling guide agrees with the simulation', () => {
  it('matches the balance ladder: Hydras in the Warehouse need immersion, Singularities in the Arctic need cryo', () => {
    const hydra = T.minimumCooler('hydra', 'warehouse');
    const sing = T.minimumCooler('singularity', 'arctic');
    expect(hydra.kind === 'ok' && hydra.coolerId).toBe('immersion');
    expect(sing.kind === 'ok' && sing.coolerId).toBe('cryo');
    expect(T.minimumCooler('singularity', 'bedroom').kind).toBe('no-power');
  });

  it('the analytic steady state equals simulate() for a full room of cabinets', () => {
    const modelId = 'singularity';
    const coolerId = 'cryo';
    const expected = T.roomBuildThermals(modelId, coolerId, 'arctic');
    const room = ROOM_CATALOG.find((r) => r.id === 'arctic');
    const cab = RACK_BY_ID.cabinet;
    expect(expected.gpus).toBe((room?.pads ?? 0) * cab.slots);

    const { data } = starterWorld();
    data.gpus = {};
    data.coolers = {};
    data.psus = {};
    data.racks = {};
    for (let pad = 0; pad < (room?.pads ?? 0); pad += 1) {
      const rack = { ...createRack('cabinet', cab.slots, cab.fanSlots), roomId: 'arctic' as const, pad };
      for (let i = 0; i < cab.slots; i += 1) {
        const g = createGpu(modelId, 'bronze');
        data.gpus[g.uid] = g;
        rack.gpuSlots[i] = g.uid;
      }
      for (let i = 0; i < cab.fanSlots; i += 1) {
        const uid = `${rack.uid}-c${i}`;
        data.coolers[uid] = { uid, modelId: coolerId };
        rack.fanSlots[i] = uid;
      }
      const psu = `${rack.uid}-p`;
      data.psus[psu] = { uid: psu, modelId: PSU_CATALOG[PSU_CATALOG.length - 1].id };
      rack.psuUid = psu;
      data.racks[rack.uid] = rack;
    }
    data.ownedRooms = ['arctic'];
    data.technicians = 6;
    const out = simulate(data, 1200, NOW, { offline: true, maxStep: 5 });
    expect(out.roomTemps.arctic).toBeCloseTo(expected.roomTemp, 0);
    Object.values(out.gpuUpdates).forEach((g) => expect(Math.abs(g.temp - (expected.gpuTemp ?? 0))).toBeLessThan(1));
  });
});

describe('wiki constants mirror the game code', () => {
  afterEach(() => vi.restoreAllMocks());

  it('The Halving grants HALVING_GEMS gems', () => {
    useGameStore.setState({ ...createInitialData(), runEarnings: '4000000', gems: 7 });
    expect(useGameStore.getState().performHalving()).toBe(true);
    expect(useGameStore.getState().gems).toBe(7 + T.HALVING_GEMS);
  });

  it.each([
    [T.SOLO_BLOCK_GEM_CHANCE - 0.01, 1],
    [T.SOLO_BLOCK_GEM_CHANCE + 0.01, 0],
  ])('a solo block drops a gem when the roll is %s (gems: %s)', (gemRoll, gems) => {
    const { data } = starterWorld({ pool: 'solo' });
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(gemRoll).mockReturnValue(0.5);
    const out = simulate(data, 1, NOW, { offline: false, maxStep: 1 });
    expect(out.blocksFound).toBe(1);
    expect(out.gemsDelta).toBe(gems);
  });

  it('the thermal thresholds quoted in the guide come from PHYSICS', () => {
    const text = WIKI_SECTIONS.find((s) => s.id === 'thermal')?.entries.find((e) => e.id === 'thermal-model')?.blocks
      .map((b) => (b.type === 'list' ? b.items.join(' ') : ''))
      .join(' ') ?? '';
    expect(text).toContain(`${PHYSICS.throttleTemp} °C`);
    expect(text).toContain(`${PHYSICS.wearTemp} °C`);
    expect(text).toContain(`${PHYSICS.shutdownTemp} °C`);
  });
});

describe('wiki content and search', () => {
  it('has the 14 sections with unique ids and non-empty entries', () => {
    expect(WIKI_SECTIONS).toHaveLength(14);
    expect(new Set(WIKI_SECTIONS.map((s) => s.id)).size).toBe(14);
    WIKI_SECTIONS.forEach((s) => {
      expect(s.entries.length).toBeGreaterThan(0);
      expect(new Set(s.entries.map((e) => e.id)).size).toBe(s.entries.length);
      s.entries.forEach((e) => expect(e.blocks.length).toBeGreaterThan(0));
    });
  });

  it('never leaks unformatted values into the text', () => {
    const text = JSON.stringify(WIKI_SECTIONS);
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it('normalizes accents and case', () => {
    expect(normalizeText('Energía TÉRMICA **x**')).toBe('energia termica x');
    expect(queryTokens('  Pasta   Térmica ')).toEqual(['pasta', 'termica']);
  });

  it('an empty query returns everything', () => {
    const r = searchWiki(WIKI_SECTIONS, '   ');
    expect(r.sections).toBe(WIKI_SECTIONS);
    expect(r.entryCount).toBe(WIKI_SECTIONS.reduce((a, s) => a + s.entries.length, 0));
  });

  it('finds entries accent-insensitively and drops unrelated sections', () => {
    const r = searchWiki(WIKI_SECTIONS, 'energia');
    expect(r.sections.map((s) => s.id)).toContain('thermal');
    expect(r.entryCount).toBeGreaterThan(0);
    expect(r.entryCount).toBeLessThan(searchWiki(WIKI_SECTIONS, '').entryCount);
  });

  it('narrows tables to the matching rows', () => {
    const r = searchWiki(WIKI_SECTIONS, 'Leviathan');
    const hardware = r.sections.find((s) => s.id === 'hardware');
    const gpus = hardware?.entries.find((e) => e.id === 'gpus');
    const table = gpus?.blocks.find((b): b is Extract<WikiBlock, { type: 'table' }> => b.type === 'table');
    expect(table?.table.rows.map((row) => row.id)).toEqual(['leviathan']);
  });

  it('requires every word and reports no results for nonsense', () => {
    expect(searchWiki(WIKI_SECTIONS, 'zzqx').sections).toHaveLength(0);
    const both = searchWiki(WIKI_SECTIONS, 'pasta repaste');
    expect(both.entryCount).toBeGreaterThan(0);
    both.sections.forEach((s) => s.entries.forEach((e) => {
      const blob = normalizeText(JSON.stringify(e) + s.title);
      expect(blob).toContain('pasta');
      expect(blob).toContain('repaste');
    }));
  });

  it('highlights accented text from an unaccented query', () => {
    const re = highlightRegex('energia');
    expect(re).not.toBeNull();
    expect('Temperatura y energía'.split(re as RegExp)).toEqual(['Temperatura y ', 'energía', '']);
    expect(highlightRegex('a')).toBeNull();
  });
});

const textOf = (block: WikiBlock): string => {
  switch (block.type) {
    case 'p':
    case 'callout':
    case 'formula':
      return block.text;
    case 'list':
    case 'steps':
      return block.items.join(' ');
    case 'table':
      return [block.table.caption ?? '', block.table.note ?? '', ...block.table.columns.map((c) => c.label), ...block.table.rows.flatMap((r) => r.cells)].join(' ');
    default:
      return '';
  }
};

/** Structure of a page set without any text: section / entry ids and the kind and size of every block. */
const shape = (sections: WikiSection[]) =>
  sections.map((s) => ({
    id: s.id,
    icon: s.icon,
    entries: s.entries.map((e) => ({
      id: e.id,
      blocks: e.blocks.map((b) => (b.type === 'table' ? `table:${b.table.id}:${b.table.rows.length}x${b.table.columns.length}` : `${b.type}:${b.type === 'list' || b.type === 'steps' ? b.items.length : 1}`)),
    })),
  }));

describe('wiki is bilingual', () => {
  const es = getWikiSections('es');
  const en = getWikiSections('en');

  it('both languages have identical page ids, section counts and block structure', () => {
    expect(en).toHaveLength(14);
    expect(shape(en)).toEqual(shape(es));
  });

  it('every section, entry and block has non-empty text in both languages', () => {
    for (const [lang, sections] of [['es', es], ['en', en]] as const) {
      sections.forEach((s) => {
        expect(s.title.trim(), `${lang}/${s.id}`).not.toBe('');
        expect(s.summary.trim(), `${lang}/${s.id}`).not.toBe('');
        s.entries.forEach((e) => {
          expect(e.title.trim(), `${lang}/${s.id}/${e.id}`).not.toBe('');
          e.blocks.forEach((b) => expect(textOf(b).trim(), `${lang}/${s.id}/${e.id}`).not.toBe(''));
        });
      });
      expect(JSON.stringify(sections)).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
  });

  it('the English pages are really English and the Spanish ones are unchanged', () => {
    expect(en[0].title).toBe('Getting started');
    expect(es[0].title).toBe('Primeros pasos');
    const prose = (sections: WikiSection[]) => sections.flatMap((s) => s.entries.flatMap((e) => e.blocks.filter((b) => b.type === 'p' || b.type === 'callout').map(textOf))).join(' ');
    expect(prose(en)).not.toMatch(/ de la | para | que el | las GPUs /);
    expect(prose(es)).toMatch(/ de la /);
  });

  it('tables follow the language in headers, notes and captions, with the same numbers', () => {
    const tables = (sections: WikiSection[]) => sections.flatMap((s) => s.entries.flatMap((e) => e.blocks.flatMap((b) => (b.type === 'table' ? [b.table] : []))));
    const tEs = tables(es);
    const tEn = tables(en);
    expect(tEn.map((t) => t.id)).toEqual(tEs.map((t) => t.id));
    tEn.forEach((t, i) => {
      expect(t.rows.map((r) => r.id)).toEqual(tEs[i].rows.map((r) => r.id));
      if (t.note) expect(t.note, t.id).not.toBe(tEs[i].note);
      expect(t.columns.length).toBe(tEs[i].columns.length);
    });
    expect(T.gpuTable('en').columns[0].label).toBe('Model');
    expect(T.gpuTable('es').columns[0].label).toBe('Modelo');
    expect(T.gpuTable('en').rows[0].cells[2]).toBe(T.gpuTable('es').rows[0].cells[2]);
  });

  it('every table builder is complete in both languages', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const build of [T.gpuTable, T.qualityTable, T.psuTable, T.coolerTable, T.rackTable, T.gridTariffTable, T.coolingGuideTable, T.maintenanceTable, T.roomTable, T.technicianTable, T.poolTable, T.eventTable, T.contractKindTable, T.contractDifficultyTable, T.talentTable, T.vipTable, T.achievementTable, T.ocLimitsTable, T.gemSourceTable]) {
        const t = build(lang);
        t.rows.forEach((r) => {
          expect(r.cells, `${lang}/${t.id}/${r.id}`).toHaveLength(t.columns.length);
          r.cells.forEach((c) => expect(c).not.toMatch(/undefined|NaN|Infinity/));
        });
      }
    }
  });

  it('keeps the thermal numbers in the English prose', () => {
    const text = en.find((s) => s.id === 'thermal')?.entries.find((e) => e.id === 'thermal-model')?.blocks.map(textOf).join(' ') ?? '';
    expect(text).toContain(`${PHYSICS.throttleTemp} °C`);
    expect(text).toContain(`${PHYSICS.shutdownTemp} °C`);
  });

  it('search works per language on its own index', () => {
    expect(searchWiki(en, 'throttling').entryCount).toBeGreaterThan(0);
    expect(searchWiki(en, 'electricity').sections.map((s) => s.id)).toContain('thermal');
    expect(searchWiki(es, 'electricity').entryCount).toBeLessThan(searchWiki(en, 'electricity').entryCount);
    expect(searchWiki(en, 'Leviathan').entryCount).toBeGreaterThan(0);
  });
});

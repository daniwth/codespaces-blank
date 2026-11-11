/**
 * Wiki tables generated straight from the balance catalogs, so the guide can
 * never drift from the game: add a GPU, room, talent or achievement and its row
 * appears here automatically. Pure functions, no React / DOM.
 */
import { CONTRACT_DEFS, CONTRACT_DIFFICULTY, CONTRACT_KINDS, CONTRACTS, KEEP_COOL_STREAK_MIN } from './contracts';
import {
  ACHIEVEMENTS,
  BOT_UNLOCK_LEVEL,
  EVENT_EFFECTS,
  MARKET,
  NETWORK_EVENTS,
  PHYSICS,
  POOL_ORDER,
  POOLS,
  VIP_COSTS,
  earningsForLevel,
} from './gameBalance';
import {
  COOLER_BY_ID,
  COOLER_CATALOG,
  GPU_BY_ID,
  GPU_CATALOG,
  MAX_TECHNICIANS,
  OC_LIMITS,
  PSU_CATALOG,
  QUALITY_DEFS,
  QUALITY_ORDER,
  RACK_BY_ID,
  RACK_CATALOG,
} from './hardwareCatalog';
import {
  HALVING_BASE_SC,
  PRESTIGE_TREE,
  TALENT_BY_ID,
  earningsForSc,
  talentCost,
  talentModifiers,
} from './prestigeTree';
import { COIN_INFO, COIN_MARKET, MINEABLE, MINEABLE_COIN_IDS, hashDifficulty } from './altcoins';
import { AIRDROP, AIRDROP_KINDS, type AirdropKind } from './airdrops';
import { CHALLENGES, POWER_CAP_MUL } from './challenges';
import { DAILY_MIN_CASH, DAILY_REWARDS } from './daily';
import { RESEARCH, researchCost, researchTime } from './research';
import { ROADMAP } from './roadmap';
import { ROOM_BY_ID, ROOM_CATALOG } from './roomsCatalog';
import type { WikiRow, WikiTable } from './wikiTypes';
import { tr, useLangStore, type Lang } from '../i18n';
import { aiAutoTune, gridTariff, ocHashBonus, ocPowerMul } from '../store/gamePhysics';
import { createGpu } from '../store/initialState';
import { SELL_REFUND, repairCost, repasteCost } from '../store/slices/hardwareSlice';
import { technicianCost } from '../store/slices/roomsSlice';
import type { ContractKind } from '../types/contracts';
import type { NetworkEventId, PoolMode } from '../types/economy';
import type { CoolerKind, GpuInstance, SiliconQuality } from '../types/hardware';
import type { ChallengeId, RoomId, TalentId } from '../types/player';
import {
  formatCash,
  formatDuration,
  formatHashrate,
  formatMultiplier,
  formatNumber,
  formatPercent,
  formatPower,
  formatTemp,
} from '../utils/formatters';

/** Language of the wiki being built (tables are generated per language; default: the UI language). */
const curLang = (): Lang => useLangStore.getState().lang;
/** `x(spanish, english)` picks the text of the wiki language. */
const pick = (lang: Lang) => (es: string, en: string): string => (lang === 'es' ? es : en);
/** In-game proper names come from the (English) catalogs and go through the dictionary. */
const namer = (lang: Lang) => (name: string): string => tr(name, undefined, lang);

const pct = (ratio: number, digits = 0) => formatPercent(ratio, digits);
const signedPct = (ratio: number) => `${ratio >= 0 ? '+' : ''}${formatPercent(ratio, 1)}`;

// ───────────────────────── Shared economics ─────────────────────────

/** Gross $CC per second of one stock device at difficulty 1 (before pool fees). */
export const grossCcPerSec = (modelId: string): number => (GPU_BY_ID[modelId].hashrate / 1e6) * PHYSICS.rewardPerMHs;

/** Seconds of gross mining (at $1 per $CC, no power bill) to pay a GPU back: the shop's "ROI". */
export const grossPaybackSec = (modelId: string): number => GPU_BY_ID[modelId].price / grossCcPerSec(modelId);

/** Electricity of one stock device in $/s in a room, on an ideal (100%) PSU and without talents. */
export const gpuPowerCostPerSec = (modelId: string, roomId: RoomId = 'bedroom'): number =>
  GPU_BY_ID[modelId].power * PHYSICS.pricePerWattSec * ROOM_BY_ID[roomId].priceMul * gridTariff(modelId);

/** Share of the gross public-pool revenue (at $1 per $CC) that one device spends on power. */
export const gpuPowerShare = (modelId: string, roomId: RoomId = 'bedroom'): number =>
  gpuPowerCostPerSec(modelId, roomId) / (grossCcPerSec(modelId) * (1 - POOLS.public.fee) * MARKET.cc.base);

// ───────────────────────── Hardware ─────────────────────────

export function gpuTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'gpus',
    caption: x('GPUs y ASICs', 'GPUs and ASICs'),
    columns: [
      { label: x('Modelo', 'Model') }, { label: 'Tier', align: 'right' }, { label: x('Precio', 'Price'), align: 'right' },
      { label: 'Hashrate', align: 'right' }, { label: x('Consumo', 'Power'), align: 'right' }, { label: 'Hash/W', align: 'right' },
      { label: x('Masa térmica', 'Thermal mass'), align: 'right' }, { label: x('ROI bruto', 'Gross ROI'), align: 'right' },
    ],
    rows: GPU_CATALOG.map((g) => ({
      id: g.id,
      icon: { kind: 'gpu', id: g.id },
      cells: [
        `${g.brand} ${nm(g.name)}`,
        `T${g.tier}`,
        formatCash(g.price),
        formatHashrate(g.hashrate),
        formatPower(g.power),
        formatHashrate(g.hashrate / g.power).replace('/s', '/W'),
        `${g.thermalMass} J/°C`,
        formatDuration(grossPaybackSec(g.id)),
      ],
    })),
    note: x(
      'ROI bruto: tiempo de minado (a $1 por $CC, sin factura eléctrica) para recuperar el precio, como en la tienda. La masa térmica marca lo rápido que se calienta y se enfría el chip.',
      'Gross ROI: mining time (at $1 per $CC, ignoring the power bill) to earn back the price, as in the shop. Thermal mass sets how fast the chip heats up and cools down.',
    ),
  };
}

/** Probability of each silicon grade with a given Silicon Whisperer level (same weights as `rollQuality`). */
export function qualityOdds(whispererLevel: number): Record<SiliconQuality, number> {
  const luck = talentModifiers({ silicon_luck: whispererLevel }).qualityLuck;
  const w: Record<SiliconQuality, number> = {
    bronze: QUALITY_DEFS.bronze.weight,
    silver: QUALITY_DEFS.silver.weight,
    gold: QUALITY_DEFS.gold.weight * luck,
    god: QUALITY_DEFS.god.weight * luck,
  };
  const total = QUALITY_ORDER.reduce((a, q) => a + w[q], 0);
  return Object.fromEntries(QUALITY_ORDER.map((q) => [q, w[q] / total])) as Record<SiliconQuality, number>;
}

/** Safe Auto-Tune bonus range of a silicon grade: worst and best roll of its headroom. */
export function autoTuneRange(quality: SiliconQuality): [number, number] {
  const q = QUALITY_DEFS[quality];
  const lo = aiAutoTune({ coreHeadroom: q.coreHeadroom[0], memHeadroom: q.memHeadroom[0], vScale: q.vScale[0] });
  const hi = aiAutoTune({ coreHeadroom: q.coreHeadroom[1], memHeadroom: q.memHeadroom[1], vScale: q.vScale[1] });
  return [ocHashBonus(lo), ocHashBonus(hi)];
}

export function qualityTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  const whisperer = TALENT_BY_ID.silicon_luck;
  const levels = Array.from({ length: whisperer.maxLevel }, (_, i) => i + 1);
  const odds = [0, ...levels].map((l) => qualityOdds(l));
  return {
    id: 'qualities',
    caption: 'Silicon lottery',
    columns: [
      { label: x('Calidad', 'Quality') },
      { label: x('Probabilidad', 'Chance'), align: 'right' },
      ...levels.map((l) => ({ label: `${nm(whisperer.name)} Lv.${l}`, align: 'right' as const })),
      { label: x('Margen core', 'Core headroom'), align: 'right' },
      { label: x('Margen memoria', 'Memory headroom'), align: 'right' },
      { label: x('MHz por +10 mV', 'MHz per +10 mV'), align: 'right' },
      { label: 'Auto-Tune', align: 'right' },
    ],
    rows: QUALITY_ORDER.map((id) => {
      const q = QUALITY_DEFS[id];
      const [lo, hi] = autoTuneRange(id);
      return {
        id,
        color: q.color,
        icon: { kind: 'swatch', color: q.color },
        cells: [
          nm(q.label),
          ...odds.map((o) => pct(o[id], 1)),
          `+${q.coreHeadroom[0]}…${q.coreHeadroom[1]} MHz`,
          `+${q.memHeadroom[0]}…${q.memHeadroom[1]} MHz`,
          `${q.vScale[0]}…${q.vScale[1]}`,
          `${signedPct(lo)} … ${signedPct(hi)}`,
        ],
      };
    }),
    note: x(
      `${nm(whisperer.name)} multiplica el peso de Gold y Silicon God. Auto-Tune: bonus de hashrate del perfil seguro de AI Self-Diagnostics con el peor y el mejor chip de cada calidad.`,
      `${nm(whisperer.name)} multiplies the weight of Gold and Silicon God. Auto-Tune: hashrate bonus of the safe AI Self-Diagnostics profile on the worst and the best chip of each quality.`,
    ),
  };
}

export function psuTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'psus',
    caption: x('Fuentes de alimentación (PSU)', 'Power supplies (PSU)'),
    columns: [
      { label: x('Modelo', 'Model') }, { label: 'Tier', align: 'right' }, { label: x('Precio', 'Price'), align: 'right' },
      { label: x('Carga máx.', 'Max load'), align: 'right' }, { label: x('Eficiencia', 'Efficiency'), align: 'right' }, { label: x('Calor a plena carga', 'Heat at full load'), align: 'right' },
    ],
    rows: PSU_CATALOG.map((p) => ({
      id: p.id,
      icon: { kind: 'psu', id: p.id },
      cells: [nm(p.name), `T${p.tier}`, formatCash(p.price), formatPower(p.capacity), pct(p.efficiency), formatPower(p.capacity * (1 / p.efficiency - 1))],
    })),
    note: x('Consumo de pared = carga / eficiencia. Lo que se pierde en la PSU se paga y además calienta la sala.', 'Wall draw = load / efficiency. What the PSU loses is paid for and also heats the room.'),
  };
}

const COOLER_KIND: Record<CoolerKind, readonly [string, string]> = {
  air: ['Aire', 'Air'], liquid: ['Líquida', 'Liquid'], immersion: ['Inmersión', 'Immersion'], cryo: ['Criogénica', 'Cryogenic'],
};

/** Cooler slots per GPU slot in a rack (the same 1:2 ratio on every model). */
const fanRatio = (rackId: string): number => RACK_BY_ID[rackId].fanSlots / RACK_BY_ID[rackId].slots;

export function coolerTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  const ratio = fanRatio('cabinet');
  return {
    id: 'coolers',
    caption: x('Refrigeración', 'Cooling'),
    columns: [
      { label: x('Modelo', 'Model') }, { label: 'Tier', align: 'right' }, { label: x('Precio', 'Price'), align: 'right' }, { label: x('Tipo', 'Type') },
      { label: x('Transferencia', 'Heat transfer'), align: 'right' }, { label: x('Consumo', 'Power'), align: 'right' }, { label: x('k por GPU (rack lleno)', 'k per GPU (full rack)'), align: 'right' },
    ],
    rows: COOLER_CATALOG.map((c) => ({
      id: c.id,
      icon: { kind: 'cooler', id: c.id },
      cells: [
        nm(c.name), `T${c.tier}`, formatCash(c.price), x(...COOLER_KIND[c.kind]), `${c.cooling} W/°C`, formatPower(c.power),
        `${formatNumber(PHYSICS.baseCooling + c.cooling * ratio, 1)} W/°C`,
      ],
    })),
    note: x(
      `Cada GPU disipa ${PHYSICS.baseCooling} W/°C por su cuenta más su parte de los coolers del rack (la suma de los coolers repartida entre las GPUs montadas). El consumo del cooler cuenta como carga de la PSU.`,
      `Each GPU dissipates ${PHYSICS.baseCooling} W/°C on its own plus its share of the rack's coolers (the sum of the coolers split among the mounted GPUs). A cooler's power draw counts as PSU load.`,
    ),
  };
}

export function rackTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'racks',
    caption: 'Racks',
    columns: [
      { label: x('Modelo', 'Model') }, { label: x('Precio', 'Price'), align: 'right' }, { label: x('Slots GPU', 'GPU slots'), align: 'right' },
      { label: x('Slots cooler', 'Cooler slots'), align: 'right' }, { label: x('Calor', 'Heat'), align: 'right' }, { label: x('Energía', 'Power') },
    ],
    rows: RACK_CATALOG.map((r) => ({
      id: r.id,
      icon: { kind: 'rack', id: r.id },
      cells: [
        nm(r.name),
        r.vip ? `${r.gemPrice} ${x('gemas', 'gems')}` : formatCash(r.price),
        String(r.slots),
        String(r.fanSlots),
        r.heatMul === 1 ? 'x1' : `${formatMultiplier(r.heatMul)} (${pct(1 - r.heatMul)} ${x('menos', 'less')})`,
        r.selfPowered ? x('Reactor propio: sin PSU, sin factura y sin usar la línea', 'Own reactor: no PSU, no bill and no use of the power line') : '1 PSU',
      ],
    })),
    note: x(
      `El ${nm(RACK_BY_ID.gold.name)} es VIP (máximo ${VIP_COSTS.maxGoldRacks}), no se puede vender y sobrevive a The Halving.`,
      `The ${nm(RACK_BY_ID.gold.name)} is VIP (max ${VIP_COSTS.maxGoldRacks}), cannot be sold and survives The Halving.`,
    ),
  };
}

// ───────────────────────── Thermal & power ─────────────────────────

export function gridTariffTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'grid-tariff',
    caption: x('Tarifa de red por modelo', 'Grid tariff by model'),
    columns: [
      { label: x('Modelo', 'Model') }, { label: x('Tarifa', 'Tariff'), align: 'right' }, { label: x('Luz por hora', 'Power per hour'), align: 'right' },
      { label: x('Luz / ingresos', 'Power / revenue'), align: 'right' }, { label: x('En la sala más barata', 'In the cheapest room'), align: 'right' },
    ],
    rows: GPU_CATALOG.map((g) => {
      const cheapest = ROOM_CATALOG.reduce((a, r) => (r.priceMul < a.priceMul ? r : a));
      return {
        id: g.id,
        icon: { kind: 'gpu', id: g.id },
        cells: [
          nm(g.name),
          formatMultiplier(gridTariff(g.id)),
          formatCash(gpuPowerCostPerSec(g.id) * 3600),
          pct(gpuPowerShare(g.id)),
          `${pct(gpuPowerShare(g.id, cheapest.id))} (${nm(cheapest.name)})`,
        ],
      };
    }),
    note: x(
      'Una GPU sin overclock en el Bedroom, con una PSU ideal al 100%, sin talentos y con $CC a $1 en el pool público. Divide por la eficiencia de tu PSU para el coste real.',
      'One stock GPU in the Bedroom, with an ideal 100% PSU, no talents and $CC at $1 on the public pool. Divide by your PSU efficiency for the real cost.',
    ),
  };
}

export interface RoomBuildThermals {
  /** GPUs the room can run: every pad's slots, capped by the contracted line (no brownout). */
  gpus: number;
  /** Steady die temperature (°C), null when not even one GPU fits the line or the best PSU. */
  gpuTemp: number | null;
  roomTemp: number;
}

/**
 * Steady state of a room packed with one GPU model and one cooler model: as
 * many GPUs as its pads hold and its power line feeds without a brownout, one
 * cooler per two GPUs (the ratio of every rack), the best PSU, fresh paste,
 * stock clocks and no talents. Same equations as `gamePhysics.step`:
 * T_room = ambient + waste heat · heatPerWatt and T_die = T_room + Q / k.
 */
export function roomBuildThermals(modelId: string, coolerId: string, roomId: RoomId): RoomBuildThermals {
  const gpu = GPU_BY_ID[modelId];
  const cooler = COOLER_BY_ID[coolerId];
  const room = ROOM_BY_ID[roomId];
  const rack = RACK_BY_ID.cabinet;
  const ratio = fanRatio(rack.id);
  const psu = PSU_CATALOG.reduce((a, p) => (p.capacity > a.capacity ? p : a));
  const fullRackLoad = gpu.power * rack.slots + cooler.power * rack.fanSlots;
  const perGpuLoad = gpu.power + cooler.power * ratio;
  const byLine = Math.floor((room.maxPowerW * psu.efficiency) / perGpuLoad + 1e-9);
  const gpus = fullRackLoad > psu.capacity ? 0 : Math.min(room.pads * rack.slots, byLine);
  if (gpus <= 0) return { gpus: 0, gpuTemp: null, roomTemp: room.ambient };
  const heat = gpu.power * rack.heatMul;
  const load = gpus * perGpuLoad;
  const wall = load / psu.efficiency;
  // GPU heat + cooler motors + PSU losses, exactly what the simulation adds to the room.
  const roomHeat = gpus * heat + gpus * cooler.power * ratio + (wall - load);
  const roomTemp = room.ambient + roomHeat * room.heatPerWatt;
  const k = (PHYSICS.baseCooling + cooler.cooling * ratio) * room.coolingMul;
  return { gpus, gpuTemp: roomTemp + heat / k, roomTemp };
}

export type CoolerAdvice =
  | { kind: 'ok'; coolerId: string; temp: number; gpus: number }
  | { kind: 'no-power' }
  | { kind: 'too-hot' };

/** Cheapest cooler that keeps a packed room of `modelId` at or under the throttle point. */
export function minimumCooler(modelId: string, roomId: RoomId): CoolerAdvice {
  const byPrice = COOLER_CATALOG.slice().sort((a, b) => a.price - b.price);
  let anyPowered = false;
  for (const c of byPrice) {
    const r = roomBuildThermals(modelId, c.id, roomId);
    if (r.gpuTemp === null) continue;
    anyPowered = true;
    if (r.gpuTemp <= PHYSICS.throttleTemp) return { kind: 'ok', coolerId: c.id, temp: r.gpuTemp, gpus: r.gpus };
  }
  return anyPowered ? { kind: 'too-hot' } : { kind: 'no-power' };
}

export function coolingGuideTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'cooling-guide',
    caption: x(`Cooler mínimo para no pasar de ${PHYSICS.throttleTemp} °C con la sala a tope`, `Minimum cooler to stay under ${PHYSICS.throttleTemp} °C with a packed room`),
    columns: [{ label: 'GPU' }, ...ROOM_CATALOG.map((r) => ({ label: nm(r.name) }))],
    rows: GPU_CATALOG.map((g) => ({
      id: g.id,
      icon: { kind: 'gpu', id: g.id },
      cells: [
        nm(g.name),
        ...ROOM_CATALOG.map((r) => {
          const a = minimumCooler(g.id, r.id);
          if (a.kind === 'no-power') return x('Sin línea', 'No power line');
          if (a.kind === 'too-hot') return x('Demasiado calor', 'Too hot');
          return `${nm(COOLER_BY_ID[a.coolerId].name)}\n${formatTemp(a.temp)} · ${a.gpus} GPU${a.gpus === 1 ? '' : 's'}`;
        }),
      ],
    })),
    note: x(
      'Sala a tope: tantas GPUs como caben en los pads y aguanta la línea sin brownout, un cooler por cada dos GPUs, la mejor PSU, pasta nueva, sin overclock ni talentos. Se indica la temperatura estable del chip y cuántas GPUs caben. «Sin línea»: la línea de la sala no alimenta ni una. Con menos GPUs la sala se calienta menos y puede bastar algo más barato.',
      'Packed room: as many GPUs as the pads hold and the line feeds without a brownout, one cooler per two GPUs, the best PSU, fresh paste, no overclock and no talents. Shows the steady chip temperature and how many GPUs fit. "No power line": the room line cannot feed even one. With fewer GPUs the room runs cooler and something cheaper may do.',
    ),
  };
}

/** Repaste price as a share of the GPU price (read on the priciest model, above the $5 floor). */
export const repasteShare = (): number => {
  const top = GPU_CATALOG.reduce((a, g) => (g.price > a.price ? g : a));
  return repasteCost({ ...createGpu(top.id, 'bronze'), wear: 0 }) / top.price;
};

export function maintenanceTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  const at = (modelId: string, wear: number): GpuInstance => ({ ...createGpu(modelId, 'bronze'), wear });
  return {
    id: 'maintenance',
    caption: x('Mantenimiento y reventa', 'Maintenance and resale'),
    columns: [
      { label: x('Modelo', 'Model') }, { label: 'Repaste', align: 'right' }, { label: x('Reparar 10%', 'Repair 10%'), align: 'right' },
      { label: `${x('Reparar', 'Repair')} ${pct(PHYSICS.maxWear)}`, align: 'right' }, { label: x('Venta (sin desgaste)', 'Sale (no wear)'), align: 'right' },
    ],
    rows: GPU_CATALOG.map((g) => ({
      id: g.id,
      icon: { kind: 'gpu', id: g.id },
      cells: [
        nm(g.name),
        formatCash(repasteCost(at(g.id, 0))),
        formatCash(repairCost(at(g.id, 0.1))),
        formatCash(repairCost(at(g.id, PHYSICS.maxWear))),
        formatCash(g.price * SELL_REFUND),
      ],
    })),
    note: x(
      `Reparar cuesta en proporción al desgaste. Al vender recuperas el ${pct(SELL_REFUND)} del precio, menos el desgaste del chip.`,
      `Repairs cost in proportion to the wear. Selling returns ${pct(SELL_REFUND)} of the price, minus the chip's wear.`,
    ),
  };
}

// ───────────────────────── Rooms & crew ─────────────────────────

export function roomTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'rooms',
    caption: x('Salas', 'Rooms'),
    columns: [
      { label: x('Sala', 'Room') }, { label: x('Precio', 'Price'), align: 'right' }, { label: x('Ambiente', 'Ambient'), align: 'right' }, { label: x('Línea', 'Line'), align: 'right' },
      { label: 'Pads', align: 'right' }, { label: x('Precio luz', 'Power price'), align: 'right' }, { label: x('Refrigeración', 'Cooling'), align: 'right' },
      { label: x('Calentamiento', 'Heating'), align: 'right' },
    ],
    rows: ROOM_CATALOG.map((r) => ({
      id: r.id,
      icon: { kind: 'room', id: r.id },
      cells: [
        nm(r.name),
        r.price > 0 ? formatCash(r.price) : x('Inicial', 'Starter'),
        formatTemp(r.ambient),
        formatPower(r.maxPowerW),
        String(r.pads),
        formatMultiplier(r.priceMul),
        formatMultiplier(r.coolingMul),
        `+${formatNumber(r.heatPerWatt * 1000, 2)} °C/kW`,
      ],
    })),
    note: x(
      'Línea: potencia de pared contratada. Precio luz multiplica la tarifa eléctrica; Refrigeración multiplica la transferencia de calor de todos los racks; Calentamiento: grados que sube el aire por cada kW de calor residual.',
      'Line: contracted wall power. Power price multiplies the electricity tariff; Cooling multiplies the heat transfer of every rack; Heating: degrees the air rises per kW of waste heat.',
    ),
  };
}

export function technicianTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  return {
    id: 'technicians',
    caption: x('Coste de los técnicos', 'Technician costs'),
    columns: [{ label: x('Técnico', 'Technician') }, { label: x('Coste', 'Cost'), align: 'right' }],
    rows: Array.from({ length: MAX_TECHNICIANS }, (_, i) => ({
      id: `tech-${i + 1}`,
      cells: [`#${i + 1}`, formatCash(technicianCost(i, 0))],
    })),
    note: x(
      `Sin Tech Union. Cada nivel de Tech Union regala un técnico al empezar la run y esos no cuentan para el precio. Máximo ${MAX_TECHNICIANS}.`,
      `Without Tech Union. Each Tech Union level gives a free technician at the start of the run and those do not count toward the price. Maximum ${MAX_TECHNICIANS}.`,
    ),
  };
}

// ───────────────────────── Pools & network ─────────────────────────

const POOL_RISK: Record<PoolMode, readonly [string, string]> = {
  public: ['Ninguno: cobras cada share de forma continua.', 'None: you are paid for every share continuously.'],
  solo: [
    `Nada entre bloques. Un bloque cada ${formatDuration(PHYSICS.soloBlockMeanSec)} de media paga ${formatDuration(PHYSICS.soloBlockMeanSec)} de minado x${PHYSICS.soloEvMul} y puede dar 1 gema.`,
    `Nothing between blocks. One block every ${formatDuration(PHYSICS.soloBlockMeanSec)} on average pays ${formatDuration(PHYSICS.soloBlockMeanSec)} of mining x${PHYSICS.soloEvMul} and may drop 1 gem.`,
  ],
  darknet: [
    `Redadas cada ~${formatDuration(PHYSICS.darknetRaidMeanSec)} de media: multa y racks de una sala apagados ${formatDuration(PHYSICS.inspectionRebootMs / 1000)}.`,
    `Raids every ~${formatDuration(PHYSICS.darknetRaidMeanSec)} on average: a fine, and the racks of one room are off for ${formatDuration(PHYSICS.inspectionRebootMs / 1000)}.`,
  ],
};

export function poolTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'pools',
    caption: x('Pools de minado', 'Mining pools'),
    columns: [{ label: 'Pool' }, { label: x('Rendimiento', 'Payout'), align: 'right' }, { label: x('Comisión', 'Fee'), align: 'right' }, { label: x('Nivel', 'Level'), align: 'right' }, { label: x('Riesgo', 'Risk') }],
    rows: POOL_ORDER.map((id) => {
      const p = POOLS[id];
      return {
        id,
        color: p.color,
        icon: { kind: 'swatch', color: p.color },
        cells: [nm(p.name), `x${p.payoutMul}`, p.fee > 0 ? pct(p.fee) : '0%', `LV ${p.unlockLevel}`, x(...POOL_RISK[id])],
      };
    }),
  };
}

export function altcoinTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'mineable-coins',
    caption: x('Monedas minables', 'Mineable coins'),
    columns: [
      { label: x('Moneda', 'Coin') }, { label: x('Precio base', 'Base price'), align: 'right' }, { label: x('Rango', 'Range'), align: 'right' },
      { label: x('Pago', 'Pay'), align: 'right' }, { label: x('Dificultad', 'Difficulty') },
    ],
    rows: MINEABLE_COIN_IDS.map((id) => {
      const cfg = COIN_MARKET[id];
      const d = MINEABLE[id].difficulty;
      return {
        id,
        color: COIN_INFO[id].color,
        icon: { kind: 'swatch', color: COIN_INFO[id].color },
        cells: [
          `${nm(COIN_INFO[id].name)} ($${id})`,
          `$${cfg.base}`,
          `x${cfg.min} - x${cfg.max}`,
          pct(MINEABLE[id].valueMul),
          d
            ? x(`Sube con tu hashrate: x${hashDifficulty(id, 1e12).toFixed(1)} a 1 TH/s`, `Rises with your hashrate: x${hashDifficulty(id, 1e12).toFixed(1)} at 1 TH/s`)
            : x('Fija', 'Fixed'),
        ],
      };
    }),
    note: x(
      'Pago = valor en dólares de cada MH/s al precio base, comparado con $CC (antes de la dificultad y del pool).',
      'Pay = dollar value of each MH/s at the base price, compared with $CC (before difficulty and the pool).',
    ),
  };
}

const CHALLENGE_RULE: Record<ChallengeId, readonly [string, string]> = {
  bronze_only: [
    'La lotería de silicio siempre sale Bronce y el silicio de grado superior no mina.',
    'The silicon lottery always rolls Bronze and higher-grade silicon does not mine.',
  ],
  no_overclock: [
    'BIOS bloqueada a frecuencias de fábrica: sin overclock ni AI Auto-Tune.',
    'BIOS locked at stock clocks: no overclock and no AI Auto-Tune.',
  ],
  power_cap: [
    `La línea eléctrica de cada sala se recorta al ${pct(POWER_CAP_MUL)}.`,
    `Every room's power line is cut to ${pct(POWER_CAP_MUL)}.`,
  ],
  single_room: [
    'Solo puedes usar el Dormitorio: no puedes comprar ni usar otras salas.',
    'You can only use the Bedroom: other rooms cannot be bought or used.',
  ],
};

export function challengeTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'challenges',
    caption: x('Retos de partida', 'Challenge runs'),
    columns: [
      { label: x('Reto', 'Challenge') }, { label: x('Restricción', 'Restriction') },
      { label: x('1ª victoria', 'First clear'), align: 'right' }, { label: x('Repetición', 'Repeat'), align: 'right' },
    ],
    rows: CHALLENGES.map((c) => ({
      id: c.id,
      color: c.color,
      icon: { kind: 'swatch', color: c.color },
      cells: [nm(c.name), x(...CHALLENGE_RULE[c.id]), `+${c.firstSc} $SC, +${c.firstGems} ${x('gemas', 'gems')}`, `+${c.repeatSc} $SC, +${c.repeatGems} ${x('gemas', 'gems')}`],
    })),
  };
}

const EVENT_EFFECT: Record<NetworkEventId, readonly [string, string]> = {
  difficulty_spike: [
    `Dificultad x${EVENT_EFFECTS.difficultyMul}: minas un ${pct(1 - 1 / EVENT_EFFECTS.difficultyMul)} menos ($BYT solo x${EVENT_EFFECTS.bytDifficultyMul}).`,
    `Difficulty x${EVENT_EFFECTS.difficultyMul}: you mine ${pct(1 - 1 / EVENT_EFFECTS.difficultyMul)} less ($BYT only x${EVENT_EFFECTS.bytDifficultyMul}).`,
  ],
  blackout: [
    'Una de tus salas, al azar, se queda sin luz: sus racks se apagan (los Gold Edition siguen).',
    'One of your rooms, at random, loses power: its racks shut down (Gold Edition racks keep running).',
  ],
  heatwave: [`+${EVENT_EFFECTS.heatwaveDelta} °C de ambiente en todas las salas.`, `+${EVENT_EFFECTS.heatwaveDelta} °C ambient in every room.`],
  cold_snap: [`${EVENT_EFFECTS.coldSnapDelta} °C de ambiente en todas las salas.`, `${EVENT_EFFECTS.coldSnapDelta} °C ambient in every room.`],
  bull_run: [
    `El precio medio de $CC y $NOVA tiende a x${EVENT_EFFECTS.bullMeanMul} ($BYT solo a x${EVENT_EFFECTS.bytBullMeanMul}).`,
    `The average $CC and $NOVA price drifts toward x${EVENT_EFFECTS.bullMeanMul} ($BYT only toward x${EVENT_EFFECTS.bytBullMeanMul}).`,
  ],
  meme_mania: [`La volatilidad de $MEME se multiplica por ${EVENT_EFFECTS.memeVolMul}.`, `$MEME volatility is multiplied by ${EVENT_EFFECTS.memeVolMul}.`],
  flash_sale: [
    `GPUs, fuentes, refrigeradores y racks cuestan un ${pct(1 - EVENT_EFFECTS.flashSaleMul)} menos en la tienda.`,
    `GPUs, PSUs, coolers and racks cost ${pct(1 - EVENT_EFFECTS.flashSaleMul)} less in the Shop.`,
  ],
};

export function eventTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'events',
    caption: x('Eventos de red', 'Network events'),
    columns: [{ label: x('Evento', 'Event') }, { label: x('Tipo', 'Type') }, { label: x('Efecto', 'Effect') }, { label: x('Duración', 'Duration'), align: 'right' }],
    rows: (Object.keys(NETWORK_EVENTS) as NetworkEventId[]).map((id) => {
      const e = NETWORK_EVENTS[id];
      return {
        id,
        color: e.color,
        icon: { kind: 'swatch', color: e.color },
        cells: [nm(e.name), e.positive ? x('Bueno', 'Good') : x('Malo', 'Bad'), x(...EVENT_EFFECT[id]), `${e.duration[0]}–${e.duration[1]} s`],
      };
    }),
  };
}

/** Player levels with what each one unlocks (pools, bots, contract types). */
export function levelTable(maxLevel = 10, lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  const unlocks = (level: number): string[] => [
    ...POOL_ORDER.filter((id) => POOLS[id].unlockLevel === level).map((id) => nm(POOLS[id].name)),
    ...(level === BOT_UNLOCK_LEVEL ? ['Trading bots'] : []),
    ...CONTRACT_KINDS.filter((k) => level > 1 && CONTRACT_DEFS[k].minLevel === level).map((k) => `${x('Contrato', 'Contract')} ${nm(CONTRACT_DEFS[k].name)}`),
  ];
  const top = Math.max(maxLevel, ...POOL_ORDER.map((id) => POOLS[id].unlockLevel), BOT_UNLOCK_LEVEL);
  return {
    id: 'levels',
    caption: x('Niveles de jugador', 'Player levels'),
    columns: [{ label: x('Nivel', 'Level') }, { label: x('Ganancias totales', 'Total earnings'), align: 'right' }, { label: x('Desbloquea', 'Unlocks') }],
    rows: Array.from({ length: top }, (_, i) => {
      const level = i + 1;
      return {
        id: `lv-${level}`,
        cells: [`LV ${level}`, level === 1 ? '$0' : formatCash(earningsForLevel(level)), unlocks(level).join(', ') || '—'],
      };
    }),
    note: x(
      'El nivel sale de las ganancias de toda la vida (lifetime): solo beneficio realizado al vender, nunca se pierde con The Halving.',
      'Your level comes from lifetime earnings: only profit realized by selling, and it is never lost to The Halving.',
    ),
  };
}

// ───────────────────────── Contracts ─────────────────────────

const CONTRACT_GOAL: Record<ContractKind, readonly [string, string]> = {
  deliver_cc: ['Minar una cantidad de $CC (vendidos o guardados; los comprados no cuentan).', 'Mine an amount of $CC (sold or kept; bought coins do not count).'],
  earn_profit: ['Realizar beneficio vendiendo monedas por encima de su coste.', 'Realize profit by selling coins above their cost.'],
  reach_hash: [
    `Llegar a un hashrate total (${CONTRACT_DEFS.reach_hash.scale.map((m) => `x${m}`).join(' / ')} el actual).`,
    `Reach a total hashrate (${CONTRACT_DEFS.reach_hash.scale.map((m) => `x${m}`).join(' / ')} your current one).`,
  ],
  keep_cool: [
    `Mantener todos los chips por debajo de X °C durante ${KEEP_COOL_STREAK_MIN.join(' / ')} min seguidos.`,
    `Keep every chip below X °C for ${KEEP_COOL_STREAK_MIN.join(' / ')} min in a row.`,
  ],
  gpu_tier: ['Tener funcionando a la vez N GPUs de tier T o superior.', 'Run N GPUs of tier T or higher at the same time.'],
  solo_block: ['Encontrar bloques minando en Solo.', 'Find blocks mining Solo.'],
  survive_event: ['Aguantar eventos de red sin ningún apagado térmico.', 'Get through network events without any thermal shutdown.'],
  bot_profit: ['Ganar beneficio con las ventas de tus trading bots.', "Earn profit from your trading bots' sales."],
};

const triple = (v: readonly [number, number, number], fmt: (n: number) => string) => v.map(fmt).join(' / ');

export function contractKindTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'contract-kinds',
    caption: x('Tipos de contrato', 'Contract types'),
    columns: [{ label: x('Contrato', 'Contract') }, { label: x('Objetivo', 'Goal') }, { label: x('Plazo', 'Deadline'), align: 'right' }, { label: x('Pago', 'Payout'), align: 'right' }, { label: x('Nivel', 'Level'), align: 'right' }],
    rows: CONTRACT_KINDS.map((k) => {
      const d = CONTRACT_DEFS[k];
      return {
        id: k,
        color: d.color,
        icon: { kind: 'swatch', color: d.color },
        cells: [nm(d.name), x(...CONTRACT_GOAL[k]), triple(d.minutes, (m) => `${m}`) + ' min', triple(d.rewardShare, (s) => pct(s)), `LV ${d.minLevel}`],
      };
    }),
    note: x(
      'Plazo y pago por dificultad (Easy / Medium / Hard). Pago: porcentaje de los ingresos netos estimados de tu granja durante el plazo.',
      "Deadline and payout by difficulty (Easy / Medium / Hard). Payout: percentage of your farm's estimated net income over the deadline.",
    ),
  };
}

export function contractDifficultyTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  const levels = [1, 2, 3] as const;
  const total = levels.reduce((a, d) => a + CONTRACT_DIFFICULTY[d].weight, 0);
  return {
    id: 'contract-difficulty',
    caption: x('Dificultades', 'Difficulties'),
    columns: [{ label: x('Dificultad', 'Difficulty') }, { label: x('Probabilidad', 'Chance'), align: 'right' }, { label: x('Gemas', 'Gems') }, { label: x('GPU gratis', 'Free GPU') }],
    rows: levels.map((d) => {
      const def = CONTRACT_DIFFICULTY[d];
      const gems = def.gemChance > 0
        ? `${pct(def.gemChance)} ${x('de', 'for')} ${def.gems}${def.bonusGemChance > 0 ? ` (${x('+1 extra al', '+1 extra at')} ${pct(def.bonusGemChance)})` : ''}`
        : 'No';
      const gpu = def.gpuChance > 0
        ? `${pct(def.gpuChance)}, ${def.gpuTierOffset === 0 ? x('de tu mejor tier', 'of your best tier') : x(`${Math.abs(def.gpuTierOffset)} tier por debajo de tu mejor`, `${Math.abs(def.gpuTierOffset)} tier below your best`)}`
        : 'No';
      return { id: `d${d}`, color: def.color, icon: { kind: 'swatch', color: def.color }, cells: [nm(def.label), pct(def.weight / total), gems, gpu] };
    }),
    note: x(
      `Si toca GPU, el premio en efectivo se reduce a la mitad. El efectivo nunca baja de ${formatCash(CONTRACTS.minCashReward)}.`,
      `When a GPU drops, the cash prize is halved. Cash never goes below ${formatCash(CONTRACTS.minCashReward)}.`,
    ),
  };
}

// ───────────────────────── The Halving ─────────────────────────

/** Illustrative run: earnings grow like t^exponent and reach the threshold after thresholdHours (as in the balance tests). */
export const EXAMPLE_RUN = { exponent: 6.7, thresholdHours: 2 } as const;

/** Hours the example run needs to reach `earnings`. */
export const exampleRunHours = (earnings: number): number =>
  EXAMPLE_RUN.thresholdHours * (earnings / earningsForSc(HALVING_BASE_SC)) ** (1 / EXAMPLE_RUN.exponent);

export interface ScMilestone {
  sc: number;
  earnings: number;
  /** Multiple over the previous milestone (1 for the threshold). */
  step: number;
  hours: number;
  scPerHour: number;
}

export function scMilestones(count = 8): ScMilestone[] {
  return Array.from({ length: count }, (_, i) => {
    const sc = HALVING_BASE_SC + i;
    const earnings = earningsForSc(sc);
    const hours = exampleRunHours(earnings);
    return { sc, earnings, step: i === 0 ? 1 : earnings / earningsForSc(sc - 1), hours, scPerHour: sc / hours };
  });
}

export function scMilestoneTable(count = 8, lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const ms = scMilestones(count);
  const best = ms.reduce((a, b) => (b.scPerHour > a.scPerHour ? b : a));
  return {
    id: 'sc-milestones',
    caption: x('Recompensa de The Halving', 'The Halving reward'),
    columns: [
      { label: '$SC' }, { label: x('Ganancias de la run', 'Run earnings'), align: 'right' }, { label: x('Salto', 'Step'), align: 'right' },
      { label: x('Llegada (ejemplo)', 'Reached at (example)'), align: 'right' }, { label: x('$SC/h (ejemplo)', '$SC/h (example)'), align: 'right' },
    ],
    rows: ms.map((m): WikiRow => ({
      id: `sc-${m.sc}`,
      color: m === best ? '#facc15' : undefined,
      cells: [
        `${m.sc} $SC${m === best ? x(' (pico)', ' (peak)') : ''}`,
        formatCash(m.earnings),
        m.step === 1 ? x('umbral', 'threshold') : `x${formatNumber(m.step, 0)}`,
        formatDuration(m.hours * 3600),
        m.scPerHour.toFixed(2),
      ],
    })),
    note: x(
      `Ejemplo ilustrativo: una run cuyas ganancias crecen como t^${EXAMPLE_RUN.exponent} y llegan al umbral en ${EXAMPLE_RUN.thresholdHours} h. Tu ritmo real lo ves en la pestaña Halving ($SC / HOUR).`,
      `Illustrative example: a run whose earnings grow like t^${EXAMPLE_RUN.exponent} and reach the threshold in ${EXAMPLE_RUN.thresholdHours} h. You can see your real pace in the Halving tab ($SC / HOUR).`,
    ),
  };
}

const TALENT_TEXT: Record<TalentId, readonly [string, string]> = {
  hash_core: ['Bonus de hashrate global en todos los dispositivos.', 'Global hashrate bonus on every device.'],
  power_discount: ['Contrato de energía renovable: factura eléctrica más barata.', 'Renewable energy contract: cheaper electricity bill.'],
  thermal_mastery: ['Firmware eficiente: los dispositivos generan menos calor.', 'Efficient firmware: devices produce less heat.'],
  quick_start: ['Empiezas cada run con más efectivo.', 'You start every run with more cash.'],
  offline_ext: ['Amplía el límite de horas del progreso offline.', 'Raises the hour cap of offline progress.'],
  silicon_luck: ['Mejores probabilidades Gold y Silicon God en la silicon lottery.', 'Better Gold and Silicon God odds in the silicon lottery.'],
  market_insight: ['Vendes monedas con prima sobre el precio de mercado.', 'You sell coins at a premium over the market price.'],
  tech_union: ['Técnico gratis al empezar cada run y mantenimiento más rápido.', 'A free technician at the start of every run and faster maintenance.'],
  vip_slots: ['Un pad extra para racks en cada sala.', 'One extra rack pad in every room.'],
  quantum_entanglement: ['Multiplicador de hashrate de fin de partida (se multiplica con Hash Amplifier).', 'Endgame hashrate multiplier (stacks multiplicatively with Hash Amplifier).'],
  room_keeper: ['Conservas las salas compradas en cada Halving.', 'You keep your purchased rooms through every Halving.'],
  drone_uplink: ['Los drones de suministros traen cajas más grandes (dinero, monedas y Overdrive más largo).', 'Supply drones carry bigger crates (cash, coins and a longer Overdrive).'],
  lab_grant: ['Los proyectos del Lab terminan antes.', 'Lab projects finish sooner.'],
};

export const talentTotalCost = (id: TalentId): number => {
  const node = TALENT_BY_ID[id];
  return Array.from({ length: node.maxLevel }, (_, l) => talentCost(node, l)).reduce((a, b) => a + b, 0);
};

export function talentTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'talents',
    caption: x('Árbol de Smart Contracts', 'Smart Contract tree'),
    columns: [
      { label: x('Talento', 'Talent') }, { label: x('Qué hace', 'What it does') }, { label: x('Niv.', 'Lv.'), align: 'right' }, { label: x('Efecto máx.', 'Max effect') },
      { label: x('Coste por nivel ($SC)', 'Cost per level ($SC)') }, { label: 'Total', align: 'right' }, { label: x('Requiere', 'Requires') },
    ],
    rows: PRESTIGE_TREE.map((n) => ({
      id: n.id,
      icon: { kind: 'talent', icon: n.icon },
      cells: [
        nm(n.name),
        x(...TALENT_TEXT[n.id]),
        String(n.maxLevel),
        n.format(n.maxLevel),
        Array.from({ length: n.maxLevel }, (_, l) => talentCost(n, l)).join(' · '),
        String(talentTotalCost(n.id)),
        n.requires.length ? n.requires.map((r) => nm(TALENT_BY_ID[r].name)).join(' + ') : '—',
      ],
    })),
    note: x(
      `Árbol completo: ${PRESTIGE_TREE.reduce((a, n) => a + talentTotalCost(n.id), 0)} $SC. Un talento se desbloquea cuando todos sus requisitos tienen al menos un nivel.`,
      `Full tree: ${PRESTIGE_TREE.reduce((a, n) => a + talentTotalCost(n.id), 0)} $SC. A talent unlocks when all its requirements have at least one level.`,
    ),
  };
}

// ───────────────────────── VIP, gems & achievements ─────────────────────────

export function vipTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'vip',
    caption: x('Tienda VIP', 'VIP shop'),
    columns: [{ label: x('Mejora', 'Upgrade') }, { label: x('Coste', 'Cost'), align: 'right' }, { label: x('Qué hace', 'What it does') }],
    rows: [
      {
        id: 'goldRack',
        icon: { kind: 'rack', id: 'gold' },
        cells: [
          nm(RACK_BY_ID.gold.name),
          `${VIP_COSTS.goldRack} ${x('gemas', 'gems')}`,
          x(
            `${RACK_BY_ID.gold.slots} slots, sin PSU ni factura, ${pct(1 - RACK_BY_ID.gold.heatMul)} menos calor, no usa la línea de la sala. Máximo ${VIP_COSTS.maxGoldRacks}. Sobrevive a The Halving.`,
            `${RACK_BY_ID.gold.slots} slots, no PSU and no bill, ${pct(1 - RACK_BY_ID.gold.heatMul)} less heat, does not use the room line. Max ${VIP_COSTS.maxGoldRacks}. Survives The Halving.`,
          ),
        ],
      },
      {
        id: 'aiDiagnostics',
        icon: { kind: 'swatch', color: '#22d3ee' },
        cells: [
          nm('AI Self-Diagnostics'),
          `${VIP_COSTS.aiDiagnostics} ${x('gemas', 'gems')}`,
          x('Añade F9 Auto-Tune a todas las BIOS: overclock seguro, sin riesgo de BSOD.', 'Adds F9 Auto-Tune to every BIOS: safe overclock with no BSOD risk.'),
        ],
      },
      {
        id: 'autoSellPeaks',
        icon: { kind: 'swatch', color: '#facc15' },
        cells: [
          nm('Peak Auto-Seller'),
          `${VIP_COSTS.autoSellPeaks} ${x('gemas', 'gems')}`,
          x(
            `Vende todos tus $CC en cuanto el precio supera x${MARKET.vipPeakThreshold} su base. Se puede apagar.`,
            `Sells all your $CC as soon as the price goes above x${MARKET.vipPeakThreshold} its base. Can be switched off.`,
          ),
        ],
      },
    ],
  };
}

/** Spanish goal text for the achievements (falls back to the in-game English text for new ones). */
const ACHIEVEMENT_ES: Record<string, string> = {
  first_hash: 'Llegar a 50 MH/s.',
  gh: 'Llegar a 1 GH/s.',
  th: 'Llegar a 1 TH/s.',
  ph: 'Llegar a 1 PH/s.',
  k: 'Ganar $1K en total.',
  m: 'Ganar $1M en total.',
  b: 'Ganar $1B en total.',
  gpu10: 'Tener 10 dispositivos de minado.',
  god: 'Conseguir una GPU Silicon God.',
  rooms3: 'Tener 3 salas.',
  halving: 'Hacer The Halving.',
  block: 'Encontrar un bloque en Solo.',
  block10: 'Encontrar 10 bloques en Solo.',
  raid: 'Sobrevivir a una redada del darknet.',
  bsod: 'Colgar un rig con un mal overclock.',
  oc5: 'Aplicar 5 overclocks estables.',
  tech3: 'Contratar 3 técnicos.',
  trade: 'Ganar $1K en una sola operación de $MEME.',
  contracts10: 'Reclamar 10 contratos.',
};

export function achievementTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  const total = ACHIEVEMENTS.reduce((a, x) => a + x.gems, 0);
  return {
    id: 'achievements',
    caption: x('Logros', 'Achievements'),
    columns: [{ label: x('Logro', 'Achievement') }, { label: x('Objetivo', 'Goal') }, { label: x('Gemas', 'Gems'), align: 'right' }],
    rows: ACHIEVEMENTS.map((a) => ({ id: a.id, cells: [nm(a.name), lang === 'es' ? ACHIEVEMENT_ES[a.id] ?? nm(a.description) : a.description, String(a.gems)] })),
    note: x(
      `${ACHIEVEMENTS.length} logros, ${total} gemas en total. Se conservan para siempre (también tras The Halving).`,
      `${ACHIEVEMENTS.length} achievements, ${total} gems in total. They are kept forever (also after The Halving).`,
    ),
  };
}

export const achievementGems = (): number => ACHIEVEMENTS.reduce((a, x) => a + x.gems, 0);

// ───────────────────────── BIOS ─────────────────────────

export function ocLimitsTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const stock = OC_LIMITS.voltage.stock;
  const coreMax = { core: OC_LIMITS.core.max, mem: 0, voltage: stock };
  const memMax = { core: 0, mem: OC_LIMITS.mem.max, voltage: stock };
  const vMax = { core: 0, mem: 0, voltage: OC_LIMITS.voltage.max };
  return {
    id: 'oc-limits',
    caption: x('Ajustes de la BIOS', 'BIOS settings'),
    columns: [{ label: x('Ajuste', 'Setting') }, { label: x('Rango', 'Range') }, { label: x('Paso', 'Step'), align: 'right' }, { label: x('Al máximo', 'At maximum') }],
    rows: [
      {
        id: 'core',
        cells: ['Core Clock Offset', `${OC_LIMITS.core.min} … +${OC_LIMITS.core.max} MHz`, `${OC_LIMITS.core.step} MHz`, `${signedPct(ocHashBonus(coreMax))} hashrate, ${signedPct(ocPowerMul(coreMax) - 1)} ${x('consumo', 'power')}`],
      },
      {
        id: 'mem',
        cells: ['Memory Clock Offset', `${OC_LIMITS.mem.min} … +${OC_LIMITS.mem.max} MHz`, `${OC_LIMITS.mem.step} MHz`, `${signedPct(ocHashBonus(memMax))} hashrate, ${signedPct(ocPowerMul(memMax) - 1)} ${x('consumo', 'power')}`],
      },
      {
        id: 'voltage',
        cells: ['Core Voltage', `${OC_LIMITS.voltage.min} … ${OC_LIMITS.voltage.max} mV (${x('serie', 'stock')} ${stock})`, `${OC_LIMITS.voltage.step} mV`, x(`${signedPct(ocPowerMul(vMax) - 1)} consumo y calor; más margen de core`, `${signedPct(ocPowerMul(vMax) - 1)} power and heat; more core headroom`)],
      },
    ],
    note: x(
      `El bonus total de hashrate está limitado a ${signedPct(-0.2)} … ${signedPct(OC_LIMITS.maxBonus)}. Más consumo es más calor, más carga en la PSU y más factura.`,
      `The total hashrate bonus is capped at ${signedPct(-0.2)} … ${signedPct(OC_LIMITS.maxBonus)}. More power means more heat, more PSU load and a bigger bill.`,
    ),
  };
}

// ───────────────────────── Gems ─────────────────────────

/** Halving gem bonus and solo-block gem odds, as coded in economySlice / gamePhysics. */
export const HALVING_GEMS = 5;
export const SOLO_BLOCK_GEM_CHANCE = 0.3;

export function gemSourceTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  const levels = [2, 3] as const;
  return {
    id: 'gem-sources',
    caption: x('De dónde salen las gemas', 'Where gems come from'),
    columns: [{ label: x('Fuente', 'Source') }, { label: x('Gemas', 'Gems') }],
    rows: [
      { id: 'achievements', cells: [x('Logros', 'Achievements'), x(`${achievementGems()} en total (${ACHIEVEMENTS.length} logros, una sola vez)`, `${achievementGems()} in total (${ACHIEVEMENTS.length} achievements, once each)`)] },
      { id: 'solo', cells: [x('Bloques en Solo Mining', 'Blocks in Solo Mining'), x(`${pct(SOLO_BLOCK_GEM_CHANCE)} de probabilidad de 1 gema por bloque`, `${pct(SOLO_BLOCK_GEM_CHANCE)} chance of 1 gem per block`)] },
      { id: 'halving', cells: ['The Halving', x(`+${HALVING_GEMS} por cada Halving`, `+${HALVING_GEMS} per Halving`)] },
      ...levels.map((d) => {
        const def = CONTRACT_DIFFICULTY[d];
        return {
          id: `contract-${d}`,
          cells: [
            `${x('Contratos', 'Contracts')} ${nm(def.label)}`,
            `${pct(def.gemChance)} ${x('de', 'for')} ${def.gems}${def.bonusGemChance > 0 ? `, ${x('+1 extra al', '+1 extra at')} ${pct(def.bonusGemChance)}` : ''}`,
          ],
        };
      }),
    ],
  };
}

// ───────────────────────── Lab, roadmap, drones and daily bonus ─────────────────────────

export function researchTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'research',
    caption: x('Proyectos del Laboratorio', 'Lab projects'),
    columns: [
      { label: x('Proyecto', 'Project') }, { label: x('Por nivel', 'Per level') }, { label: x('Niveles', 'Levels'), align: 'right' },
      { label: x('Coste nv. 1 → máx.', 'Cost lv. 1 → max'), align: 'right' }, { label: x('Tiempo nv. 1 → máx.', 'Time lv. 1 → max'), align: 'right' },
    ],
    rows: RESEARCH.map((r) => {
      const one = r.effectOf(1);
      return {
        id: r.id,
        color: r.color,
        icon: { kind: 'swatch', color: r.color },
        cells: [
          nm(r.name),
          tr(one.key, one.params, lang),
          String(r.maxLevel),
          `${formatCash(researchCost(r, 0))} → ${formatCash(researchCost(r, r.maxLevel - 1))}`,
          `${formatDuration(researchTime(r, 0))} → ${formatDuration(researchTime(r, r.maxLevel - 1))}`,
        ],
      };
    }),
    note: x(
      'Un proyecto cada vez. Cancelar devuelve el coste completo. El Halving borra todos los niveles.',
      'One project at a time. Cancelling refunds the full cost. The Halving wipes every level.',
    ),
  };
}

export function roadmapTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const nm = namer(lang);
  return {
    id: 'roadmap',
    caption: x('Hoja de ruta', 'Roadmap'),
    columns: [{ label: '#', align: 'right' }, { label: x('Objetivo', 'Goal') }, { label: x('Cómo', 'How') }, { label: x('Recompensa', 'Reward'), align: 'right' }],
    rows: ROADMAP.map((g, i) => ({
      id: g.id,
      cells: [
        String(i + 1),
        nm(g.title),
        nm(g.hint),
        [g.cash > 0 ? formatCash(g.cash) : '', g.gems > 0 ? `${g.gems} ${x('gemas', 'gems')}` : ''].filter(Boolean).join(' + '),
      ],
    })),
    note: x(
      `${ROADMAP.length} objetivos, ${ROADMAP.reduce((a, g) => a + g.gems, 0)} gemas en total. Se reclaman en orden y sobreviven al Halving.`,
      `${ROADMAP.length} goals, ${ROADMAP.reduce((a, g) => a + g.gems, 0)} gems in total. They are claimed in order and survive The Halving.`,
    ),
  };
}

const AIRDROP_TEXT: Record<AirdropKind, { color: string; name: readonly [string, string]; reward: readonly [string, string] }> = {
  cash: {
    color: '#facc15',
    name: ['Efectivo', 'Cash'],
    reward: [
      `${AIRDROP.cashIncomeSec} s de tu ingreso neto estimado (mínimo ${formatCash(AIRDROP.minCash)}).`,
      `${AIRDROP.cashIncomeSec} s of your estimated net income (at least ${formatCash(AIRDROP.minCash)}).`,
    ],
  },
  coins: {
    color: '#22d3ee',
    name: ['Monedas', 'Coins'],
    reward: [
      `${AIRDROP.coinsSec} s de minado en la moneda que estés minando (efectivo si no tienes hashrate).`,
      `${AIRDROP.coinsSec} s of mining in the coin you are mining (cash if you have no hashrate).`,
    ],
  },
  overdrive: {
    color: '#a3e635',
    name: ['Overdrive', 'Overdrive'],
    reward: [
      `Hashrate x${AIRDROP.overdriveMul} durante ${AIRDROP.overdriveSec} s; se acumula hasta ${AIRDROP.overdriveMaxSec} s.`,
      `Hashrate x${AIRDROP.overdriveMul} for ${AIRDROP.overdriveSec} s; it stacks up to ${AIRDROP.overdriveMaxSec} s.`,
    ],
  },
  gem: { color: '#e879f9', name: ['Gema', 'Gem'], reward: [`${AIRDROP.gems} gema.`, `${AIRDROP.gems} gem.`] },
};

export function airdropTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  const total = AIRDROP_KINDS.reduce((a, k) => a + AIRDROP.weights[k], 0);
  return {
    id: 'airdrops',
    caption: x('Cajas de los drones', 'Drone crates'),
    columns: [{ label: x('Caja', 'Crate') }, { label: x('Probabilidad', 'Odds'), align: 'right' }, { label: x('Contenido', 'Contents') }],
    rows: AIRDROP_KINDS.map((k) => ({
      id: k,
      color: AIRDROP_TEXT[k].color,
      icon: { kind: 'swatch', color: AIRDROP_TEXT[k].color },
      cells: [x(...AIRDROP_TEXT[k].name), pct(AIRDROP.weights[k] / total), x(...AIRDROP_TEXT[k].reward)],
    })),
  };
}

export function dailyTable(lang: Lang = curLang()): WikiTable {
  const x = pick(lang);
  return {
    id: 'daily',
    caption: x('Bonus diario', 'Daily bonus'),
    columns: [{ label: x('Día', 'Day'), align: 'right' }, { label: x('Efectivo', 'Cash') }, { label: x('Gemas', 'Gems'), align: 'right' }],
    rows: DAILY_REWARDS.map((r, i) => ({
      id: `day${i + 1}`,
      cells: [String(i + 1), x(`${r.incomeMin} min de ingreso neto`, `${r.incomeMin} min of net income`), r.gems > 0 ? String(r.gems) : '—'],
    })),
    note: x(
      `El efectivo nunca baja de ${formatCash(DAILY_MIN_CASH)}. Tras el día ${DAILY_REWARDS.length} la escalera vuelve a empezar.`,
      `Cash never drops below ${formatCash(DAILY_MIN_CASH)}. After day ${DAILY_REWARDS.length} the ladder starts over.`,
    ),
  };
}

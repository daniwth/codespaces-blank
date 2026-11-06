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
import { ROOM_BY_ID, ROOM_CATALOG } from './roomsCatalog';
import type { WikiRow, WikiTable } from './wikiTypes';
import { aiAutoTune, gridTariff, ocHashBonus, ocPowerMul } from '../store/gamePhysics';
import { createGpu } from '../store/initialState';
import { SELL_REFUND, repairCost, repasteCost } from '../store/slices/hardwareSlice';
import { technicianCost } from '../store/slices/roomsSlice';
import type { ContractKind } from '../types/contracts';
import type { NetworkEventId, PoolMode } from '../types/economy';
import type { CoolerKind, GpuInstance, SiliconQuality } from '../types/hardware';
import type { RoomId, TalentId } from '../types/player';
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

export function gpuTable(): WikiTable {
  return {
    id: 'gpus',
    caption: 'GPUs y ASICs',
    columns: [
      { label: 'Modelo' }, { label: 'Tier', align: 'right' }, { label: 'Precio', align: 'right' },
      { label: 'Hashrate', align: 'right' }, { label: 'Consumo', align: 'right' }, { label: 'Hash/W', align: 'right' },
      { label: 'Masa térmica', align: 'right' }, { label: 'ROI bruto', align: 'right' },
    ],
    rows: GPU_CATALOG.map((g) => ({
      id: g.id,
      icon: { kind: 'gpu', id: g.id },
      cells: [
        `${g.brand} ${g.name}`,
        `T${g.tier}`,
        formatCash(g.price),
        formatHashrate(g.hashrate),
        formatPower(g.power),
        formatHashrate(g.hashrate / g.power).replace('/s', '/W'),
        `${g.thermalMass} J/°C`,
        formatDuration(grossPaybackSec(g.id)),
      ],
    })),
    note: 'ROI bruto: tiempo de minado (a $1 por $CC, sin factura eléctrica) para recuperar el precio, como en la tienda. La masa térmica marca lo rápido que se calienta y se enfría el chip.',
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

export function qualityTable(): WikiTable {
  const whisperer = TALENT_BY_ID.silicon_luck;
  const levels = Array.from({ length: whisperer.maxLevel }, (_, i) => i + 1);
  const odds = [0, ...levels].map((l) => qualityOdds(l));
  return {
    id: 'qualities',
    caption: 'Silicon lottery',
    columns: [
      { label: 'Calidad' },
      { label: 'Probabilidad', align: 'right' },
      ...levels.map((l) => ({ label: `${whisperer.name} Lv.${l}`, align: 'right' as const })),
      { label: 'Margen core', align: 'right' },
      { label: 'Margen memoria', align: 'right' },
      { label: 'MHz por +10 mV', align: 'right' },
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
          q.label,
          ...odds.map((o) => pct(o[id], 1)),
          `+${q.coreHeadroom[0]}…${q.coreHeadroom[1]} MHz`,
          `+${q.memHeadroom[0]}…${q.memHeadroom[1]} MHz`,
          `${q.vScale[0]}…${q.vScale[1]}`,
          `${signedPct(lo)} … ${signedPct(hi)}`,
        ],
      };
    }),
    note: `${whisperer.name} multiplica el peso de Gold y Silicon God. Auto-Tune: bonus de hashrate del perfil seguro de AI Self-Diagnostics con el peor y el mejor chip de cada calidad.`,
  };
}

export function psuTable(): WikiTable {
  return {
    id: 'psus',
    caption: 'Fuentes de alimentación (PSU)',
    columns: [
      { label: 'Modelo' }, { label: 'Tier', align: 'right' }, { label: 'Precio', align: 'right' },
      { label: 'Carga máx.', align: 'right' }, { label: 'Eficiencia', align: 'right' }, { label: 'Calor a plena carga', align: 'right' },
    ],
    rows: PSU_CATALOG.map((p) => ({
      id: p.id,
      icon: { kind: 'psu', id: p.id },
      cells: [p.name, `T${p.tier}`, formatCash(p.price), formatPower(p.capacity), pct(p.efficiency), formatPower(p.capacity * (1 / p.efficiency - 1))],
    })),
    note: 'Consumo de pared = carga / eficiencia. Lo que se pierde en la PSU se paga y además calienta la sala.',
  };
}

const COOLER_KIND_ES: Record<CoolerKind, string> = { air: 'Aire', liquid: 'Líquida', immersion: 'Inmersión', cryo: 'Criogénica' };

/** Cooler slots per GPU slot in a rack (the same 1:2 ratio on every model). */
const fanRatio = (rackId: string): number => RACK_BY_ID[rackId].fanSlots / RACK_BY_ID[rackId].slots;

export function coolerTable(): WikiTable {
  const ratio = fanRatio('cabinet');
  return {
    id: 'coolers',
    caption: 'Refrigeración',
    columns: [
      { label: 'Modelo' }, { label: 'Tier', align: 'right' }, { label: 'Precio', align: 'right' }, { label: 'Tipo' },
      { label: 'Transferencia', align: 'right' }, { label: 'Consumo', align: 'right' }, { label: 'k por GPU (rack lleno)', align: 'right' },
    ],
    rows: COOLER_CATALOG.map((c) => ({
      id: c.id,
      icon: { kind: 'cooler', id: c.id },
      cells: [
        c.name, `T${c.tier}`, formatCash(c.price), COOLER_KIND_ES[c.kind], `${c.cooling} W/°C`, formatPower(c.power),
        `${formatNumber(PHYSICS.baseCooling + c.cooling * ratio, 1)} W/°C`,
      ],
    })),
    note: `Cada GPU disipa ${PHYSICS.baseCooling} W/°C por su cuenta más su parte de los coolers del rack (la suma de los coolers repartida entre las GPUs montadas). El consumo del cooler cuenta como carga de la PSU.`,
  };
}

export function rackTable(): WikiTable {
  return {
    id: 'racks',
    caption: 'Racks',
    columns: [
      { label: 'Modelo' }, { label: 'Precio', align: 'right' }, { label: 'Slots GPU', align: 'right' },
      { label: 'Slots cooler', align: 'right' }, { label: 'Calor', align: 'right' }, { label: 'Energía' },
    ],
    rows: RACK_CATALOG.map((r) => ({
      id: r.id,
      icon: { kind: 'rack', id: r.id },
      cells: [
        r.name,
        r.vip ? `${r.gemPrice} gemas` : formatCash(r.price),
        String(r.slots),
        String(r.fanSlots),
        r.heatMul === 1 ? 'x1' : `${formatMultiplier(r.heatMul)} (${pct(1 - r.heatMul)} menos)`,
        r.selfPowered ? 'Reactor propio: sin PSU, sin factura y sin usar la línea' : '1 PSU',
      ],
    })),
    note: `El ${RACK_BY_ID.gold.name} es VIP (máximo ${VIP_COSTS.maxGoldRacks}), no se puede vender y sobrevive a The Halving.`,
  };
}

// ───────────────────────── Thermal & power ─────────────────────────

export function gridTariffTable(): WikiTable {
  return {
    id: 'grid-tariff',
    caption: 'Tarifa de red por modelo',
    columns: [
      { label: 'Modelo' }, { label: 'Tarifa', align: 'right' }, { label: 'Luz por hora', align: 'right' },
      { label: 'Luz / ingresos', align: 'right' }, { label: 'En la sala más barata', align: 'right' },
    ],
    rows: GPU_CATALOG.map((g) => {
      const cheapest = ROOM_CATALOG.reduce((a, r) => (r.priceMul < a.priceMul ? r : a));
      return {
        id: g.id,
        icon: { kind: 'gpu', id: g.id },
        cells: [
          g.name,
          formatMultiplier(gridTariff(g.id)),
          formatCash(gpuPowerCostPerSec(g.id) * 3600),
          pct(gpuPowerShare(g.id)),
          `${pct(gpuPowerShare(g.id, cheapest.id))} (${cheapest.name})`,
        ],
      };
    }),
    note: 'Una GPU sin overclock en el Bedroom, con una PSU ideal al 100%, sin talentos y con $CC a $1 en el pool público. Divide por la eficiencia de tu PSU para el coste real.',
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

export function coolingGuideTable(): WikiTable {
  return {
    id: 'cooling-guide',
    caption: `Cooler mínimo para no pasar de ${PHYSICS.throttleTemp} °C con la sala a tope`,
    columns: [{ label: 'GPU' }, ...ROOM_CATALOG.map((r) => ({ label: r.name }))],
    rows: GPU_CATALOG.map((g) => ({
      id: g.id,
      icon: { kind: 'gpu', id: g.id },
      cells: [
        g.name,
        ...ROOM_CATALOG.map((r) => {
          const a = minimumCooler(g.id, r.id);
          if (a.kind === 'no-power') return 'Sin línea';
          if (a.kind === 'too-hot') return 'Demasiado calor';
          return `${COOLER_BY_ID[a.coolerId].name}\n${formatTemp(a.temp)} · ${a.gpus} GPU${a.gpus === 1 ? '' : 's'}`;
        }),
      ],
    })),
    note: 'Sala a tope: tantas GPUs como caben en los pads y aguanta la línea sin brownout, un cooler por cada dos GPUs, la mejor PSU, pasta nueva, sin overclock ni talentos. Se indica la temperatura estable del chip y cuántas GPUs caben. «Sin línea»: la línea de la sala no alimenta ni una. Con menos GPUs la sala se calienta menos y puede bastar algo más barato.',
  };
}

/** Repaste price as a share of the GPU price (read on the priciest model, above the $5 floor). */
export const repasteShare = (): number => {
  const top = GPU_CATALOG.reduce((a, g) => (g.price > a.price ? g : a));
  return repasteCost({ ...createGpu(top.id, 'bronze'), wear: 0 }) / top.price;
};

export function maintenanceTable(): WikiTable {
  const at = (modelId: string, wear: number): GpuInstance => ({ ...createGpu(modelId, 'bronze'), wear });
  return {
    id: 'maintenance',
    caption: 'Mantenimiento y reventa',
    columns: [
      { label: 'Modelo' }, { label: 'Repaste', align: 'right' }, { label: 'Reparar 10%', align: 'right' },
      { label: `Reparar ${pct(PHYSICS.maxWear)}`, align: 'right' }, { label: 'Venta (sin desgaste)', align: 'right' },
    ],
    rows: GPU_CATALOG.map((g) => ({
      id: g.id,
      icon: { kind: 'gpu', id: g.id },
      cells: [
        g.name,
        formatCash(repasteCost(at(g.id, 0))),
        formatCash(repairCost(at(g.id, 0.1))),
        formatCash(repairCost(at(g.id, PHYSICS.maxWear))),
        formatCash(g.price * SELL_REFUND),
      ],
    })),
    note: `Reparar cuesta en proporción al desgaste. Al vender recuperas el ${pct(SELL_REFUND)} del precio, menos el desgaste del chip.`,
  };
}

// ───────────────────────── Rooms & crew ─────────────────────────

export function roomTable(): WikiTable {
  return {
    id: 'rooms',
    caption: 'Salas',
    columns: [
      { label: 'Sala' }, { label: 'Precio', align: 'right' }, { label: 'Ambiente', align: 'right' }, { label: 'Línea', align: 'right' },
      { label: 'Pads', align: 'right' }, { label: 'Precio luz', align: 'right' }, { label: 'Refrigeración', align: 'right' },
      { label: 'Calentamiento', align: 'right' },
    ],
    rows: ROOM_CATALOG.map((r) => ({
      id: r.id,
      icon: { kind: 'room', id: r.id },
      cells: [
        r.name,
        r.price > 0 ? formatCash(r.price) : 'Inicial',
        formatTemp(r.ambient),
        formatPower(r.maxPowerW),
        String(r.pads),
        formatMultiplier(r.priceMul),
        formatMultiplier(r.coolingMul),
        `+${formatNumber(r.heatPerWatt * 1000, 2)} °C/kW`,
      ],
    })),
    note: 'Línea: potencia de pared contratada. Precio luz multiplica la tarifa eléctrica; Refrigeración multiplica la transferencia de calor de todos los racks; Calentamiento: grados que sube el aire por cada kW de calor residual.',
  };
}

export function technicianTable(): WikiTable {
  return {
    id: 'technicians',
    caption: 'Coste de los técnicos',
    columns: [{ label: 'Técnico' }, { label: 'Coste', align: 'right' }],
    rows: Array.from({ length: MAX_TECHNICIANS }, (_, i) => ({
      id: `tech-${i + 1}`,
      cells: [`#${i + 1}`, formatCash(technicianCost(i, 0))],
    })),
    note: `Sin Tech Union. Cada nivel de Tech Union regala un técnico al empezar la run y esos no cuentan para el precio. Máximo ${MAX_TECHNICIANS}.`,
  };
}

// ───────────────────────── Pools & network ─────────────────────────

const POOL_RISK_ES: Record<PoolMode, string> = {
  public: 'Ninguno: cobras cada share de forma continua.',
  solo: `Nada entre bloques. Un bloque cada ${formatDuration(PHYSICS.soloBlockMeanSec)} de media paga ${formatDuration(PHYSICS.soloBlockMeanSec)} de minado x${PHYSICS.soloEvMul} y puede dar 1 gema.`,
  darknet: `Redadas cada ~${formatDuration(PHYSICS.darknetRaidMeanSec)} de media: multa y racks de una sala apagados ${formatDuration(PHYSICS.inspectionRebootMs / 1000)}.`,
};

export function poolTable(): WikiTable {
  return {
    id: 'pools',
    caption: 'Pools de minado',
    columns: [{ label: 'Pool' }, { label: 'Rendimiento', align: 'right' }, { label: 'Comisión', align: 'right' }, { label: 'Nivel', align: 'right' }, { label: 'Riesgo' }],
    rows: POOL_ORDER.map((id) => {
      const p = POOLS[id];
      return {
        id,
        color: p.color,
        icon: { kind: 'swatch', color: p.color },
        cells: [p.name, `x${p.payoutMul}`, p.fee > 0 ? pct(p.fee) : '0%', `LV ${p.unlockLevel}`, POOL_RISK_ES[id]],
      };
    }),
  };
}

const EVENT_EFFECT_ES: Record<NetworkEventId, string> = {
  difficulty_spike: `Dificultad x${EVENT_EFFECTS.difficultyMul}: minas un ${pct(1 - 1 / EVENT_EFFECTS.difficultyMul)} menos.`,
  blackout: 'Una de tus salas, al azar, se queda sin luz: sus racks se apagan (los Gold Edition siguen).',
  heatwave: `+${EVENT_EFFECTS.heatwaveDelta} °C de ambiente en todas las salas.`,
  cold_snap: `${EVENT_EFFECTS.coldSnapDelta} °C de ambiente en todas las salas.`,
  bull_run: `El precio medio de $CC tiende a x${EVENT_EFFECTS.bullMeanMul}.`,
  meme_mania: `La volatilidad de $MEME se multiplica por ${EVENT_EFFECTS.memeVolMul}.`,
};

export function eventTable(): WikiTable {
  return {
    id: 'events',
    caption: 'Eventos de red',
    columns: [{ label: 'Evento' }, { label: 'Tipo' }, { label: 'Efecto' }, { label: 'Duración', align: 'right' }],
    rows: (Object.keys(NETWORK_EVENTS) as NetworkEventId[]).map((id) => {
      const e = NETWORK_EVENTS[id];
      return {
        id,
        color: e.color,
        icon: { kind: 'swatch', color: e.color },
        cells: [e.name, e.positive ? 'Bueno' : 'Malo', EVENT_EFFECT_ES[id], `${e.duration[0]}–${e.duration[1]} s`],
      };
    }),
  };
}

/** Player levels with what each one unlocks (pools, bots, contract types). */
export function levelTable(maxLevel = 10): WikiTable {
  const unlocks = (level: number): string[] => [
    ...POOL_ORDER.filter((id) => POOLS[id].unlockLevel === level).map((id) => POOLS[id].name),
    ...(level === BOT_UNLOCK_LEVEL ? ['Trading bots'] : []),
    ...CONTRACT_KINDS.filter((k) => level > 1 && CONTRACT_DEFS[k].minLevel === level).map((k) => `Contrato ${CONTRACT_DEFS[k].name}`),
  ];
  const top = Math.max(maxLevel, ...POOL_ORDER.map((id) => POOLS[id].unlockLevel), BOT_UNLOCK_LEVEL);
  return {
    id: 'levels',
    caption: 'Niveles de jugador',
    columns: [{ label: 'Nivel' }, { label: 'Ganancias totales', align: 'right' }, { label: 'Desbloquea' }],
    rows: Array.from({ length: top }, (_, i) => {
      const level = i + 1;
      return {
        id: `lv-${level}`,
        cells: [`LV ${level}`, level === 1 ? '$0' : formatCash(earningsForLevel(level)), unlocks(level).join(', ') || '—'],
      };
    }),
    note: 'El nivel sale de las ganancias de toda la vida (lifetime): solo beneficio realizado al vender, nunca se pierde con The Halving.',
  };
}

// ───────────────────────── Contracts ─────────────────────────

const CONTRACT_GOAL_ES: Record<ContractKind, string> = {
  deliver_cc: 'Minar una cantidad de $CC (vendidos o guardados; los comprados no cuentan).',
  earn_profit: 'Realizar beneficio vendiendo monedas por encima de su coste.',
  reach_hash: `Llegar a un hashrate total (${CONTRACT_DEFS.reach_hash.scale.map((x) => `x${x}`).join(' / ')} el actual).`,
  keep_cool: `Mantener todos los chips por debajo de X °C durante ${KEEP_COOL_STREAK_MIN.join(' / ')} min seguidos.`,
  gpu_tier: 'Tener funcionando a la vez N GPUs de tier T o superior.',
  solo_block: 'Encontrar bloques minando en Solo.',
  survive_event: 'Aguantar eventos de red sin ningún apagado térmico.',
  bot_profit: 'Ganar beneficio con las ventas de tus trading bots.',
};

const triple = (v: readonly [number, number, number], fmt: (n: number) => string) => v.map(fmt).join(' / ');

export function contractKindTable(): WikiTable {
  return {
    id: 'contract-kinds',
    caption: 'Tipos de contrato',
    columns: [{ label: 'Contrato' }, { label: 'Objetivo' }, { label: 'Plazo', align: 'right' }, { label: 'Pago', align: 'right' }, { label: 'Nivel', align: 'right' }],
    rows: CONTRACT_KINDS.map((k) => {
      const d = CONTRACT_DEFS[k];
      return {
        id: k,
        color: d.color,
        icon: { kind: 'swatch', color: d.color },
        cells: [d.name, CONTRACT_GOAL_ES[k], triple(d.minutes, (m) => `${m}`) + ' min', triple(d.rewardShare, (s) => pct(s)), `LV ${d.minLevel}`],
      };
    }),
    note: 'Plazo y pago por dificultad (Easy / Medium / Hard). Pago: porcentaje de los ingresos netos estimados de tu granja durante el plazo.',
  };
}

export function contractDifficultyTable(): WikiTable {
  const levels = [1, 2, 3] as const;
  const total = levels.reduce((a, d) => a + CONTRACT_DIFFICULTY[d].weight, 0);
  return {
    id: 'contract-difficulty',
    caption: 'Dificultades',
    columns: [{ label: 'Dificultad' }, { label: 'Probabilidad', align: 'right' }, { label: 'Gemas' }, { label: 'GPU gratis' }],
    rows: levels.map((d) => {
      const def = CONTRACT_DIFFICULTY[d];
      const gems = def.gemChance > 0
        ? `${pct(def.gemChance)} de ${def.gems}${def.bonusGemChance > 0 ? ` (+1 extra al ${pct(def.bonusGemChance)})` : ''}`
        : 'No';
      const gpu = def.gpuChance > 0
        ? `${pct(def.gpuChance)}, ${def.gpuTierOffset === 0 ? 'de tu mejor tier' : `${Math.abs(def.gpuTierOffset)} tier por debajo de tu mejor`}`
        : 'No';
      return { id: `d${d}`, color: def.color, icon: { kind: 'swatch', color: def.color }, cells: [def.label, pct(def.weight / total), gems, gpu] };
    }),
    note: `Si toca GPU, el premio en efectivo se reduce a la mitad. El efectivo nunca baja de ${formatCash(CONTRACTS.minCashReward)}.`,
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

export function scMilestoneTable(count = 8): WikiTable {
  const ms = scMilestones(count);
  const best = ms.reduce((a, b) => (b.scPerHour > a.scPerHour ? b : a));
  return {
    id: 'sc-milestones',
    caption: 'Recompensa de The Halving',
    columns: [
      { label: '$SC' }, { label: 'Ganancias de la run', align: 'right' }, { label: 'Salto', align: 'right' },
      { label: 'Llegada (ejemplo)', align: 'right' }, { label: '$SC/h (ejemplo)', align: 'right' },
    ],
    rows: ms.map((m): WikiRow => ({
      id: `sc-${m.sc}`,
      color: m === best ? '#facc15' : undefined,
      cells: [
        `${m.sc} $SC${m === best ? ' (pico)' : ''}`,
        formatCash(m.earnings),
        m.step === 1 ? 'umbral' : `x${formatNumber(m.step, 0)}`,
        formatDuration(m.hours * 3600),
        m.scPerHour.toFixed(2),
      ],
    })),
    note: `Ejemplo ilustrativo: una run cuyas ganancias crecen como t^${EXAMPLE_RUN.exponent} y llegan al umbral en ${EXAMPLE_RUN.thresholdHours} h. Tu ritmo real lo ves en la pestaña Halving ($SC / HOUR).`,
  };
}

const TALENT_ES: Record<TalentId, string> = {
  hash_core: 'Bonus de hashrate global en todos los dispositivos.',
  power_discount: 'Contrato de energía renovable: factura eléctrica más barata.',
  thermal_mastery: 'Firmware eficiente: los dispositivos generan menos calor.',
  quick_start: 'Empiezas cada run con más efectivo.',
  offline_ext: 'Amplía el límite de horas del progreso offline.',
  silicon_luck: 'Mejores probabilidades Gold y Silicon God en la silicon lottery.',
  market_insight: 'Vendes monedas con prima sobre el precio de mercado.',
  tech_union: 'Técnico gratis al empezar cada run y mantenimiento más rápido.',
  vip_slots: 'Un pad extra para racks en cada sala.',
  quantum_entanglement: 'Multiplicador de hashrate de fin de partida (se multiplica con Hash Amplifier).',
  room_keeper: 'Conservas las salas compradas en cada Halving.',
};

export const talentTotalCost = (id: TalentId): number => {
  const node = TALENT_BY_ID[id];
  return Array.from({ length: node.maxLevel }, (_, l) => talentCost(node, l)).reduce((a, b) => a + b, 0);
};

export function talentTable(): WikiTable {
  return {
    id: 'talents',
    caption: 'Árbol de Smart Contracts',
    columns: [
      { label: 'Talento' }, { label: 'Qué hace' }, { label: 'Niv.', align: 'right' }, { label: 'Efecto máx.' },
      { label: 'Coste por nivel ($SC)' }, { label: 'Total', align: 'right' }, { label: 'Requiere' },
    ],
    rows: PRESTIGE_TREE.map((n) => ({
      id: n.id,
      icon: { kind: 'talent', icon: n.icon },
      cells: [
        n.name,
        TALENT_ES[n.id],
        String(n.maxLevel),
        n.format(n.maxLevel),
        Array.from({ length: n.maxLevel }, (_, l) => talentCost(n, l)).join(' · '),
        String(talentTotalCost(n.id)),
        n.requires.length ? n.requires.map((r) => TALENT_BY_ID[r].name).join(' + ') : '—',
      ],
    })),
    note: `Árbol completo: ${PRESTIGE_TREE.reduce((a, n) => a + talentTotalCost(n.id), 0)} $SC. Un talento se desbloquea cuando todos sus requisitos tienen al menos un nivel.`,
  };
}

// ───────────────────────── VIP, gems & achievements ─────────────────────────

export function vipTable(): WikiTable {
  return {
    id: 'vip',
    caption: 'Tienda VIP',
    columns: [{ label: 'Mejora' }, { label: 'Coste', align: 'right' }, { label: 'Qué hace' }],
    rows: [
      {
        id: 'goldRack',
        icon: { kind: 'rack', id: 'gold' },
        cells: [RACK_BY_ID.gold.name, `${VIP_COSTS.goldRack} gemas`, `${RACK_BY_ID.gold.slots} slots, sin PSU ni factura, ${pct(1 - RACK_BY_ID.gold.heatMul)} menos calor, no usa la línea de la sala. Máximo ${VIP_COSTS.maxGoldRacks}. Sobrevive a The Halving.`],
      },
      {
        id: 'aiDiagnostics',
        icon: { kind: 'swatch', color: '#22d3ee' },
        cells: ['AI Self-Diagnostics', `${VIP_COSTS.aiDiagnostics} gemas`, 'Añade F9 Auto-Tune a todas las BIOS: overclock seguro, sin riesgo de BSOD.'],
      },
      {
        id: 'autoSellPeaks',
        icon: { kind: 'swatch', color: '#facc15' },
        cells: ['Peak Auto-Seller', `${VIP_COSTS.autoSellPeaks} gemas`, `Vende todos tus $CC en cuanto el precio supera x${MARKET.vipPeakThreshold} su base. Se puede apagar.`],
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

export function achievementTable(): WikiTable {
  const total = ACHIEVEMENTS.reduce((a, x) => a + x.gems, 0);
  return {
    id: 'achievements',
    caption: 'Logros',
    columns: [{ label: 'Logro' }, { label: 'Objetivo' }, { label: 'Gemas', align: 'right' }],
    rows: ACHIEVEMENTS.map((a) => ({ id: a.id, cells: [a.name, ACHIEVEMENT_ES[a.id] ?? a.description, String(a.gems)] })),
    note: `${ACHIEVEMENTS.length} logros, ${total} gemas en total. Se conservan para siempre (también tras The Halving).`,
  };
}

export const achievementGems = (): number => ACHIEVEMENTS.reduce((a, x) => a + x.gems, 0);

// ───────────────────────── BIOS ─────────────────────────

export function ocLimitsTable(): WikiTable {
  const stock = OC_LIMITS.voltage.stock;
  const coreMax = { core: OC_LIMITS.core.max, mem: 0, voltage: stock };
  const memMax = { core: 0, mem: OC_LIMITS.mem.max, voltage: stock };
  const vMax = { core: 0, mem: 0, voltage: OC_LIMITS.voltage.max };
  return {
    id: 'oc-limits',
    caption: 'Ajustes de la BIOS',
    columns: [{ label: 'Ajuste' }, { label: 'Rango' }, { label: 'Paso', align: 'right' }, { label: 'Al máximo' }],
    rows: [
      {
        id: 'core',
        cells: ['Core Clock Offset', `${OC_LIMITS.core.min} … +${OC_LIMITS.core.max} MHz`, `${OC_LIMITS.core.step} MHz`, `${signedPct(ocHashBonus(coreMax))} hashrate, ${signedPct(ocPowerMul(coreMax) - 1)} consumo`],
      },
      {
        id: 'mem',
        cells: ['Memory Clock Offset', `${OC_LIMITS.mem.min} … +${OC_LIMITS.mem.max} MHz`, `${OC_LIMITS.mem.step} MHz`, `${signedPct(ocHashBonus(memMax))} hashrate, ${signedPct(ocPowerMul(memMax) - 1)} consumo`],
      },
      {
        id: 'voltage',
        cells: ['Core Voltage', `${OC_LIMITS.voltage.min} … ${OC_LIMITS.voltage.max} mV (serie ${stock})`, `${OC_LIMITS.voltage.step} mV`, `${signedPct(ocPowerMul(vMax) - 1)} consumo y calor; más margen de core`],
      },
    ],
    note: `El bonus total de hashrate está limitado a ${signedPct(-0.2)} … ${signedPct(OC_LIMITS.maxBonus)}. Más consumo es más calor, más carga en la PSU y más factura.`,
  };
}

// ───────────────────────── Gems ─────────────────────────

/** Halving gem bonus and solo-block gem odds, as coded in economySlice / gamePhysics. */
export const HALVING_GEMS = 5;
export const SOLO_BLOCK_GEM_CHANCE = 0.3;

export function gemSourceTable(): WikiTable {
  const levels = [2, 3] as const;
  return {
    id: 'gem-sources',
    caption: 'De dónde salen las gemas',
    columns: [{ label: 'Fuente' }, { label: 'Gemas' }],
    rows: [
      { id: 'achievements', cells: ['Logros', `${achievementGems()} en total (${ACHIEVEMENTS.length} logros, una sola vez)`] },
      { id: 'solo', cells: ['Bloques en Solo Mining', `${pct(SOLO_BLOCK_GEM_CHANCE)} de probabilidad de 1 gema por bloque`] },
      { id: 'halving', cells: ['The Halving', `+${HALVING_GEMS} por cada Halving`] },
      ...levels.map((d) => {
        const def = CONTRACT_DIFFICULTY[d];
        return {
          id: `contract-${d}`,
          cells: [`Contratos ${def.label}`, `${pct(def.gemChance)} de ${def.gems}${def.bonusGemChance > 0 ? `, +1 extra al ${pct(def.bonusGemChance)}` : ''}`],
        };
      }),
    ],
  };
}

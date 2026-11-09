import type { CoolerModel, GpuModel, PsuModel, RackModel, SiliconQuality } from '../types/hardware';

/**
 * GPU / ASIC tiers. Balanced so that payback time (price / yield at $1 CC)
 * grows ~1.5x per tier while thermal and power demands force better
 * cooling, PSUs and rooms.
 */
export const GPU_CATALOG: GpuModel[] = [
  {
    id: 'px460', name: 'PX-460', brand: 'Pixelia', tier: 1, price: 45,
    hashrate: 25e6, power: 120, thermalMass: 70, style: 'card', fans: 1,
    palette: { shroud: '#52525b', shroudDark: '#27272a', accent: '#22c55e', pcb: '#14532d' },
  },
  {
    id: 'px580', name: 'PX-580', brand: 'Pixelia', tier: 2, price: 225,
    hashrate: 80e6, power: 170, thermalMass: 80, style: 'card', fans: 2,
    palette: { shroud: '#1d4ed8', shroudDark: '#1e3a8a', accent: '#ef4444', pcb: '#172554' },
  },
  {
    id: 'vx2070', name: 'VX-2070', brand: 'Voxel', tier: 3, price: 1_200,
    hashrate: 275e6, power: 220, thermalMass: 90, style: 'card', fans: 2,
    palette: { shroud: '#1f2937', shroudDark: '#111827', accent: '#a3e635', pcb: '#0f172a' },
  },
  {
    id: 'vx3080', name: 'VX-3080 Ti', brand: 'Voxel', tier: 4, price: 6_000,
    hashrate: 900e6, power: 300, thermalMass: 110, style: 'card', fans: 3,
    palette: { shroud: '#3f3f46', shroudDark: '#18181b', accent: '#f97316', pcb: '#1c1917' },
  },
  {
    id: 'nca100', name: 'A100 Tensor', brand: 'NeoCore', tier: 5, price: 35_000,
    hashrate: 3.5e9, power: 400, thermalMass: 140, style: 'card', fans: 3,
    palette: { shroud: '#a1a1aa', shroudDark: '#52525b', accent: '#38bdf8', pcb: '#0c4a6e' },
  },
  {
    id: 'qb9', name: 'QB-9 Qubit', brand: 'QuantumBit', tier: 6, price: 220_000,
    hashrate: 15e9, power: 520, thermalMass: 160, style: 'card', fans: 3,
    palette: { shroud: '#6d28d9', shroudDark: '#3b0764', accent: '#e879f9', pcb: '#2e1065' },
  },
  {
    id: 'hydra', name: 'Hydra S9', brand: 'ASIC', tier: 7, price: 1_500_000,
    hashrate: 68e9, power: 1_200, thermalMass: 260, style: 'asic', fans: 2,
    palette: { shroud: '#94a3b8', shroudDark: '#475569', accent: '#facc15', pcb: '#334155' },
  },
  {
    id: 'leviathan', name: 'Leviathan X', brand: 'ASIC', tier: 8, price: 12_000_000,
    hashrate: 360e9, power: 2_400, thermalMass: 380, style: 'asic', fans: 3,
    palette: { shroud: '#334155', shroudDark: '#0f172a', accent: '#22d3ee', pcb: '#082f49' },
  },
  {
    id: 'prism', name: 'Prism Photonic', brand: 'Lumen', tier: 9, price: 120_000_000,
    hashrate: 2.4e12, power: 1_800, thermalMass: 300, style: 'photonic', fans: 1,
    palette: { shroud: '#0e7490', shroudDark: '#164e63', accent: '#f0abfc', pcb: '#083344' },
  },
  {
    id: 'singularity', name: 'Singularity Core', brand: 'Event Horizon', tier: 10, price: 2_000_000_000,
    hashrate: 27e12, power: 3_000, thermalMass: 420, style: 'singularity', fans: 1,
    palette: { shroud: '#1e1b4b', shroudDark: '#020617', accent: '#a78bfa', pcb: '#0b0a1f' },
  },
];

export const PSU_CATALOG: PsuModel[] = [
  { id: 'psu500', name: 'Bronze 500W', tier: 1, price: 25, capacity: 500, efficiency: 0.82, color: '#b45309' },
  { id: 'psu1000', name: 'Silver 1000W', tier: 2, price: 300, capacity: 1_000, efficiency: 0.87, color: '#94a3b8' },
  { id: 'psu2000', name: 'Gold 2000W', tier: 3, price: 2_500, capacity: 2_000, efficiency: 0.9, color: '#eab308' },
  { id: 'psu5000', name: 'Platinum 5kW', tier: 4, price: 30_000, capacity: 5_000, efficiency: 0.92, color: '#e2e8f0' },
  { id: 'psu12k', name: 'Titanium 12kW', tier: 5, price: 400_000, capacity: 12_000, efficiency: 0.95, color: '#67e8f9' },
  { id: 'psu30k', name: 'Fusion Busbar 30kW', tier: 6, price: 8_000_000, capacity: 30_000, efficiency: 0.98, color: '#c084fc' },
];

export const COOLER_CATALOG: CoolerModel[] = [
  { id: 'fan80', name: '80mm Case Fan', tier: 1, price: 10, cooling: 2.5, power: 2, kind: 'air' },
  { id: 'fan120', name: '120mm Turbo Fan', tier: 2, price: 150, cooling: 5, power: 5, kind: 'air' },
  { id: 'tower', name: 'Tower Heatsink', tier: 3, price: 800, cooling: 10, power: 8, kind: 'air' },
  { id: 'aio', name: 'Liquid AIO 360', tier: 4, price: 30_000, cooling: 30, power: 25, kind: 'liquid' },
  { id: 'immersion', name: 'Immersion Tank', tier: 5, price: 800_000, cooling: 50, power: 90, kind: 'immersion' },
  { id: 'cryo', name: 'Cryo Phase-Change', tier: 6, price: 40_000_000, cooling: 400, power: 350, kind: 'cryo' },
];

export const RACK_CATALOG: RackModel[] = [
  { id: 'bench', name: 'Open-Air Bench', price: 30, gemPrice: 0, slots: 2, fanSlots: 1, style: 'bench', vip: false, selfPowered: false, heatMul: 1 },
  { id: 'steel', name: 'Steel Rack 4U', price: 800, gemPrice: 0, slots: 4, fanSlots: 2, style: 'steel', vip: false, selfPowered: false, heatMul: 1 },
  { id: 'cabinet', name: 'Server Cabinet 42U', price: 25_000, gemPrice: 0, slots: 8, fanSlots: 4, style: 'cabinet', vip: false, selfPowered: false, heatMul: 1 },
  { id: 'gold', name: 'Gold Edition Rack', price: 0, gemPrice: 25, slots: 8, fanSlots: 4, style: 'gold', vip: true, selfPowered: true, heatMul: 0.5 },
];

const byId = <T extends { id: string }>(list: T[]): Record<string, T> =>
  Object.fromEntries(list.map((item) => [item.id, item]));

export const GPU_BY_ID = byId(GPU_CATALOG);
export const PSU_BY_ID = byId(PSU_CATALOG);
export const COOLER_BY_ID = byId(COOLER_CATALOG);
export const RACK_BY_ID = byId(RACK_CATALOG);

export interface QualityDefinition {
  id: SiliconQuality;
  label: string;
  color: string;
  glow: string;
  /** Base roll weight (before Silicon Whisperer talent). */
  weight: number;
  coreHeadroom: [number, number];
  memHeadroom: [number, number];
  vScale: [number, number];
}

export const QUALITY_DEFS: Record<SiliconQuality, QualityDefinition> = {
  bronze: { id: 'bronze', label: 'Bronze', color: '#d97706', glow: '#78350f', weight: 50, coreHeadroom: [40, 110], memHeadroom: [200, 450], vScale: [6, 10] },
  silver: { id: 'silver', label: 'Silver', color: '#cbd5e1', glow: '#475569', weight: 30, coreHeadroom: [110, 200], memHeadroom: [450, 750], vScale: [9, 14] },
  gold: { id: 'gold', label: 'Gold', color: '#facc15', glow: '#854d0e', weight: 15, coreHeadroom: [200, 300], memHeadroom: [750, 1100], vScale: [13, 18] },
  god: { id: 'god', label: 'Silicon God', color: '#f0abfc', glow: '#86198f', weight: 5, coreHeadroom: [300, 420], memHeadroom: [1100, 1500], vScale: [18, 24] },
};

export const QUALITY_ORDER: SiliconQuality[] = ['bronze', 'silver', 'gold', 'god'];

/** Overclock slider ranges. */
export const OC_LIMITS = {
  core: { min: -200, max: 500, step: 5 },
  mem: { min: -500, max: 1500, step: 25 },
  voltage: { min: 800, max: 1200, step: 5, stock: 1000 },
  maxBonus: 0.4,
} as const;

export const TECHNICIAN_BASE_COST = 1_500;
export const TECHNICIAN_COST_GROWTH = 3.2;
export const MAX_TECHNICIANS = 6;

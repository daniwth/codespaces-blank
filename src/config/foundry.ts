import type { GpuStyle } from '../types/hardware';
import type { FoundryNodeId } from '../types/player';

/**
 * Chip Foundry: a small tree bought with cash during the run (The Halving wipes it). After the
 * Clean Room it splits in two branches: third-party graphics cards, which rule the early tiers, and
 * in-house ASICs, which rule the late ones. Both can be climbed, but the two capstones are
 * exclusive: the fab specializes in one family for the rest of the run.
 */
export type ChipFamily = 'card' | 'asic';

/** Graphics cards on one side; everything purpose-built (ASIC, photonic, singularity) on the other. */
export const chipFamily = (style: GpuStyle): ChipFamily => (style === 'card' ? 'card' : 'asic');

export interface FoundryNode {
  id: FoundryNodeId;
  name: string;
  description: string;
  branch: 'root' | ChipFamily;
  /** 0 = root, 3 = capstone. */
  tier: 0 | 1 | 2 | 3;
  price: number;
  requires: FoundryNodeId | null;
  /** Capstone of the other branch: owning either one locks the other. */
  excludes?: FoundryNodeId;
  color: string;
}

export const FOUNDRY = {
  /** Clean Room and Binning Line: multiplier on the odds of Gold and God silicon. */
  cleanroomLuck: 1.15,
  binLuck: 1.35,
  cardHeatMul: 0.9,
  cardHashMul: 1.1,
  asicHeatMul: 0.88,
  asicHashMul: 1.06,
  asicCapHashMul: 1.12,
} as const;

const pct = (v: number): number => Math.round(Math.abs(v - 1) * 100);

export const FOUNDRY_NODES: FoundryNode[] = [
  {
    id: 'cleanroom', name: 'Clean Room', branch: 'root', tier: 0, price: 8_000, requires: null, color: '#e2e8f0',
    description: `Dust-free assembly: Gold and God silicon are ${pct(FOUNDRY.cleanroomLuck)}% more likely on every purchase.`,
  },
  {
    id: 'gpu_bin', name: 'Binning Line', branch: 'card', tier: 1, price: 60_000, requires: 'cleanroom', color: '#a3e635',
    description: `You test and sort the chips yourself: Gold and God silicon are another ${pct(FOUNDRY.binLuck)}% more likely.`,
  },
  {
    id: 'gpu_shroud', name: 'Custom Shrouds', branch: 'card', tier: 2, price: 1_500_000, requires: 'gpu_bin', color: '#a3e635',
    description: `Your own heatsink and shroud design: graphics cards give off ${pct(FOUNDRY.cardHeatMul)}% less heat.`,
  },
  {
    id: 'gpu_ref', name: 'Reference Design', branch: 'card', tier: 3, price: 40_000_000, requires: 'gpu_shroud', excludes: 'asic_tape', color: '#a3e635',
    description: `The vendor ships your board as its reference: graphics cards hash ${pct(FOUNDRY.cardHashMul)}% faster. Locks the ASIC capstone.`,
  },
  {
    id: 'asic_mask', name: 'Mask Set', branch: 'asic', tier: 1, price: 60_000, requires: 'cleanroom', color: '#22d3ee',
    description: `Your own lithography masks: ASIC, photonic and singularity miners give off ${pct(FOUNDRY.asicHeatMul)}% less heat.`,
  },
  {
    id: 'asic_pack', name: 'Advanced Packaging', branch: 'asic', tier: 2, price: 1_500_000, requires: 'asic_mask', color: '#22d3ee',
    description: `Stacked dies and shorter traces: ASIC, photonic and singularity miners hash ${pct(FOUNDRY.asicHashMul)}% faster.`,
  },
  {
    id: 'asic_tape', name: 'Tape-out', branch: 'asic', tier: 3, price: 40_000_000, requires: 'asic_pack', excludes: 'gpu_ref', color: '#22d3ee',
    description: `A chip of your own on the newest node: ASIC, photonic and singularity miners hash another ${pct(FOUNDRY.asicCapHashMul)}% faster. Locks the graphics card capstone.`,
  },
];

export const FOUNDRY_BY_ID = Object.fromEntries(FOUNDRY_NODES.map((n) => [n.id, n])) as Record<FoundryNodeId, FoundryNode>;
export const FOUNDRY_IDS: FoundryNodeId[] = FOUNDRY_NODES.map((n) => n.id);
export const isFoundryNode = (v: unknown): v is FoundryNodeId => typeof v === 'string' && v in FOUNDRY_BY_ID;

export type FoundryState = 'owned' | 'available' | 'locked' | 'excluded';

/** Whether a node can be bought with the nodes already owned (price aside). */
export function foundryState(owned: readonly FoundryNodeId[], id: FoundryNodeId): FoundryState {
  const node = FOUNDRY_BY_ID[id];
  if (owned.includes(id)) return 'owned';
  if (node.excludes && owned.includes(node.excludes)) return 'excluded';
  return node.requires === null || owned.includes(node.requires) ? 'available' : 'locked';
}

export interface FoundryModifiers {
  /** Multiplier on the odds of Gold and God silicon. */
  luckMul: number;
  hashMul: Record<ChipFamily, number>;
  heatMul: Record<ChipFamily, number>;
}

export function foundryModifiers(owned: readonly FoundryNodeId[] = []): FoundryModifiers {
  const has = (id: FoundryNodeId): boolean => owned.includes(id);
  return {
    luckMul: (has('cleanroom') ? FOUNDRY.cleanroomLuck : 1) * (has('gpu_bin') ? FOUNDRY.binLuck : 1),
    hashMul: {
      card: has('gpu_ref') ? FOUNDRY.cardHashMul : 1,
      asic: (has('asic_pack') ? FOUNDRY.asicHashMul : 1) * (has('asic_tape') ? FOUNDRY.asicCapHashMul : 1),
    },
    heatMul: { card: has('gpu_shroud') ? FOUNDRY.cardHeatMul : 1, asic: has('asic_mask') ? FOUNDRY.asicHeatMul : 1 },
  };
}

/**
 * A saved list is only kept as far as it is a legal tree: every node needs its parent, and of two
 * exclusive capstones the first one listed wins.
 */
export function legalFoundry(raw: readonly unknown[]): FoundryNodeId[] {
  const out: FoundryNodeId[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of raw) {
      if (isFoundryNode(id) && foundryState(out, id) === 'available') {
        out.push(id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Sandbox mode: a relaxed farm chosen when a new game starts. Hardware never degrades and nothing
 * bad comes from outside; the physics (heat, power, the market) stay the same. Challenge runs are
 * not available in it.
 */
export const SANDBOX = { startCash: 5_000 } as const;

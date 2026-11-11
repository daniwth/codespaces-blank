/**
 * The roadmap: a one-time chain of guided goals that walks a new player from the first sale to
 * the late game, introducing every system on the way. Goals are claimed in order; each pays a
 * small gift (cash is a gift like contract prizes: it never counts as earnings). It survives
 * The Halving and is only reset by a new game.
 */

/** Side panel a goal points to (subset of the store's SideTab). */
export type RoadmapTab = 'shop' | 'rigs' | 'lab' | 'market' | 'pools' | 'contracts' | 'halving' | 'vip';

/** Facts about the save a goal can look at (built by `roadmapContext` in the store). */
export interface RoadmapCtx {
  lifetimeEarnings: number;
  gpuCount: number;
  mountedGpus: number;
  placedRacks: number;
  /** Best hashrate ever reached (H/s). */
  peakHash: number;
  roomsOwned: number;
  technicians: number;
  contractsCompleted: number;
  stableOverclocks: number;
  bots: number;
  airdrops: number;
  blocksFound: number;
  /** 1 once any altcoin is held. */
  altsHeld: number;
  fusions: number;
  researchDone: number;
  halvings: number;
  talentLevels: number;
  challengesCleared: number;
  goldRacks: number;
  /** 1 once a daily bonus has been claimed. */
  dailyClaimed: number;
}

export type RoadmapUnit = 'count' | 'cash' | 'hash';

export interface RoadmapGoal {
  id: string;
  title: string;
  /** How to get there, in one sentence. */
  hint: string;
  tab?: RoadmapTab;
  target: number;
  unit: RoadmapUnit;
  value: (ctx: RoadmapCtx) => number;
  cash: number;
  gems: number;
}

const goal = (
  id: string, title: string, hint: string, target: number, unit: RoadmapUnit,
  value: (ctx: RoadmapCtx) => number, cash: number, gems = 0, tab?: RoadmapTab,
): RoadmapGoal => ({ id, title, hint, tab, target, unit, value, cash, gems });

export const ROADMAP: RoadmapGoal[] = [
  goal('first_sale', 'First sale', 'Sell your mined $CC with SELL ALL CC in the top bar.', 1, 'cash', (c) => c.lifetimeEarnings, 20),
  goal('second_gpu', 'A second card', 'Buy another GPU in Shop → GPUs.', 2, 'count', (c) => c.gpuCount, 25, 0, 'shop'),
  goal('mount_two', 'Fill the bench', 'Click the rack in the room and mount the new GPU (Auto-fill does it for you).', 2, 'count', (c) => c.mountedGpus, 40, 0, 'rigs'),
  goal('daily', 'Daily bonus', 'Claim your daily bonus with the gift button next to this goal.', 1, 'count', (c) => c.dailyClaimed, 50),
  goal('hash_100m', 'Triple digits', 'Reach 100 MH/s of hashrate.', 100e6, 'hash', (c) => c.peakHash, 120, 0, 'shop'),
  goal('second_rack', 'Room for more', 'Buy a Steel Rack, a PSU and coolers, then place the rack on the empty floor pad.', 2, 'count', (c) => c.placedRacks, 300, 0, 'shop'),
  goal('research_1', 'Science!', 'Complete a research project in the Lab.', 1, 'count', (c) => c.researchDone, 400, 0, 'lab'),
  goal('earn_2k', 'Pocket money', 'Earn $2K by selling what you mine.', 2_000, 'cash', (c) => c.lifetimeEarnings, 500, 1),
  goal('garage', 'Moving out', 'Buy the Garage in Shop → Rooms.', 2, 'count', (c) => c.roomsOwned, 1_000, 0, 'shop'),
  goal('contract', 'Odd jobs', 'Complete a contract and claim its reward.', 1, 'count', (c) => c.contractsCompleted, 1_500, 0, 'contracts'),
  goal('airdrop', 'Special delivery', 'Catch a supply drone when it flies over the room.', 1, 'count', (c) => c.airdrops, 0, 2),
  goal('technician', 'Hired help', 'Hire a technician in Shop → Crew.', 1, 'count', (c) => c.technicians, 2_500, 0, 'shop'),
  goal('overclock', 'More MHz', "Apply a stable overclock in a GPU's BIOS.", 1, 'count', (c) => c.stableOverclocks, 3_000, 1, 'rigs'),
  goal('hash_1g', 'Giga', 'Reach 1 GH/s of hashrate.', 1e9, 'hash', (c) => c.peakHash, 6_000, 0, 'shop'),
  goal('bot', 'Hands off', 'Add a trading bot in the Market tab.', 1, 'count', (c) => c.bots, 8_000, 0, 'market'),
  goal('altcoin', 'Diversify', 'Mine $BYT or $NOVA: pick the coin in the Pools tab.', 1, 'count', (c) => c.altsHeld, 10_000, 0, 'pools'),
  goal('solo', 'Jackpot', 'Switch to Solo Mining and find a block.', 1, 'count', (c) => c.blocksFound, 20_000, 1, 'pools'),
  goal('warehouse', 'Industrial scale', 'Buy the Industrial Warehouse.', 3, 'count', (c) => c.roomsOwned, 60_000, 2, 'shop'),
  goal('fuse', 'Alchemy', 'Fuse 3 spare GPUs of the same model and grade in Rigs → Silicon Forge.', 1, 'count', (c) => c.fusions, 50_000, 0, 'rigs'),
  goal('research_6', 'R&D department', 'Complete 6 research levels in the Lab.', 6, 'count', (c) => c.researchDone, 150_000, 0, 'lab'),
  goal('earn_1m', 'Seven figures', 'Earn $1M in total.', 1e6, 'cash', (c) => c.lifetimeEarnings, 0, 3),
  goal('halving', 'The Halving', 'Reach $4M of run earnings and trigger The Halving.', 1, 'count', (c) => c.halvings, 0, 5, 'halving'),
  goal('talent', 'Smart money', 'Spend your $SC on a talent in the Halving tab.', 1, 'count', (c) => c.talentLevels, 1_000, 1, 'halving'),
  goal('challenge', 'Hard mode', 'Complete a challenge run.', 1, 'count', (c) => c.challengesCleared, 0, 5, 'halving'),
  goal('gold_rack', 'Gold standard', 'Buy a Gold Edition Rack in the VIP tab.', 1, 'count', (c) => c.goldRacks, 0, 3, 'vip'),
  goal('hash_1t', 'Tera', 'Reach 1 TH/s of hashrate.', 1e12, 'hash', (c) => c.peakHash, 0, 5, 'shop'),
  goal('arctic', 'Cold storage', 'Buy the Arctic Datacenter.', 4, 'count', (c) => c.roomsOwned, 0, 6, 'shop'),
  goal('halving_5', 'Veteran', 'Perform The Halving 5 times.', 5, 'count', (c) => c.halvings, 0, 10, 'halving'),
  goal('submarine', 'Twenty thousand leagues', 'Buy the Submarine Datacenter.', 5, 'count', (c) => c.roomsOwned, 0, 15, 'shop'),
];

/** Goal the player is working on, or null once the roadmap is finished. */
export const currentGoal = (step: number): RoadmapGoal | null => ROADMAP[step] ?? null;

/** Progress of a goal clamped to 0-1. */
export const goalProgress = (g: RoadmapGoal, ctx: RoadmapCtx): number =>
  Math.max(0, Math.min(1, g.value(ctx) / g.target));

export const goalMet = (g: RoadmapGoal, ctx: RoadmapCtx): boolean => g.value(ctx) >= g.target;

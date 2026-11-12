/**
 * Investment planner of the AI Farm Manager. Pure: no store, no DOM, no randomness.
 *
 * The idea is model-predictive: every candidate purchase is applied to a copy of the farm and
 * the game's own simulation runs it for a few minutes. The difference in net income against the
 * untouched farm is the candidate's gain, so heat, throttling, PSU overloads, brownouts, grid
 * tariffs, talents and research are all accounted for without a second set of formulas.
 *
 *   gain     = net income with the purchase - net income without it        ($/s)
 *   payback  = cost / gain (+ research time)                               (s)
 *   wait     = max(0, cost - spendable cash) / net income                  (s)
 *   score    = payback + wait      → the lowest score is the target
 *
 * The target is bought as soon as it is affordable. While saving for it, a cheaper candidate is
 * bought only if it pays for itself before the target would be reached (it then shortens the wait).
 */
import { AUTOPILOT } from '../../config/autopilot';
import { PHYSICS } from '../../config/gameBalance';
import { COOLER_BY_ID, COOLER_CATALOG, GPU_BY_ID, GPU_CATALOG, PSU_BY_ID, PSU_CATALOG, RACK_BY_ID, RACK_CATALOG } from '../../config/hardwareCatalog';
import { runModifiers } from '../../config/modifiers';
import { talentModifiers } from '../../config/prestigeTree';
import { RESEARCH, researchCost, researchLevel, researchTime } from '../../config/research';
import { ROOM_BY_ID, ROOM_ORDER } from '../../config/roomsCatalog';
import type { CoolerModel, GpuInstance, PsuModel, RackInstance } from '../../types/hardware';
import type { ResearchId, RoomId } from '../../types/player';
import { bnToNumber } from '../../utils/bignum';
import { challengeRules } from '../../config/challenges';
import { STOCK_OC, ocPowerMul, rackTopology, simulate, usableRooms, type LiveMetrics, type SimInput } from '../gamePhysics';
import { hardwarePrice } from '../pricing';
import { padCount } from '../slices/roomsSlice';

/** One primitive purchase. `rackUid` may be `NEW_RACK` for the rack bought earlier in the same list. */
export type AutopilotOp =
  | { op: 'room'; roomId: RoomId }
  | { op: 'rack'; modelId: string; roomId: RoomId; pad: number }
  | { op: 'psu'; modelId: string; rackUid: string }
  | { op: 'cooler'; modelId: string; rackUid: string; slot: number }
  | { op: 'gpu'; modelId: string; rackUid: string; slot: number };

export const NEW_RACK = '$new-rack';

export interface AutopilotLabel {
  key: string;
  params: Record<string, string>;
}

export interface Candidate {
  id: string;
  label: AutopilotLabel;
  ops: AutopilotOp[];
  research?: ResearchId;
  /** Cash out of pocket (list prices with discounts, minus the refund of replaced parts). */
  cost: number;
  /** Seconds before the purchase starts paying (research time). */
  delaySec: number;
}

export interface Evaluated extends Candidate {
  gain: number;
  payback: number;
  wait: number;
  score: number;
}

export interface Plan {
  /** Net income of the farm as it is ($/s, simulated). */
  baseNet: number;
  /** Cash the manager may spend (cash minus the electricity reserve). */
  spendable: number;
  /** What the manager is working towards, or null when nothing is worth buying. */
  target: Evaluated | null;
  /** What to buy right now (the target itself, or a filler that pays back before it), or null to keep saving. */
  buyNow: Evaluated | null;
  evaluated: Evaluated[];
  live: LiveMetrics;
}

const SELL_REFUND = 0.5;
const SIM_GPU = { quality: 'bronze' as const };

/** Net $/s of a farm, averaged over a simulated window (coins valued at the current price). */
export function simulatedNet(world: SimInput, now: number): { net: number; live: LiveMetrics } {
  const gpus = Object.keys(world.gpus).length;
  const out = simulate(world, AUTOPILOT.simSeconds, now, { offline: true, maxStep: gpus > 300 ? 30 : 10 });
  const price = world.market[world.minedCoin].price;
  return { net: (out.coinMined * price - out.electricityPaid) / AUTOPILOT.simSeconds, live: out.live };
}

let simSeq = 0;
const simUid = (kind: string): string => {
  simSeq += 1;
  return `ap-${kind}-${simSeq}`;
};

function simGpu(modelId: string, roomTemp: number): GpuInstance {
  return {
    uid: simUid('gpu'), modelId, quality: SIM_GPU.quality,
    silicon: { coreHeadroom: 0, memHeadroom: 0, vScale: 0 },
    oc: { ...STOCK_OC }, ocBonus: 0, temp: roomTemp, wear: 0, paste: 1, shutdown: false, overheatSeconds: 0,
  };
}

/** Apply purchases to a copy of the world (pure). Replaced parts simply disappear: their refund is in the cost. */
export function applyOps(world: SimInput, ops: AutopilotOp[]): SimInput {
  const gpus = { ...world.gpus };
  const psus = { ...world.psus };
  const coolers = { ...world.coolers };
  const racks = { ...world.racks };
  let ownedRooms = world.ownedRooms;
  let newRack = '';
  const rackOf = (uid: string): RackInstance | undefined => racks[uid === NEW_RACK ? newRack : uid];
  ops.forEach((o) => {
    if (o.op === 'room') {
      if (!ownedRooms.includes(o.roomId)) ownedRooms = [...ownedRooms, o.roomId];
      return;
    }
    if (o.op === 'rack') {
      const m = RACK_BY_ID[o.modelId];
      newRack = simUid('rack');
      racks[newRack] = {
        uid: newRack, modelId: o.modelId, roomId: o.roomId, pad: o.pad,
        gpuSlots: Array.from({ length: m.slots }, () => null), fanSlots: Array.from({ length: m.fanSlots }, () => null), psuUid: null, rebootUntil: 0,
      };
      return;
    }
    const rack = rackOf(o.rackUid);
    if (!rack) return;
    if (o.op === 'psu') {
      const uid = simUid('psu');
      psus[uid] = { uid, modelId: o.modelId };
      racks[rack.uid] = { ...rack, psuUid: uid };
    } else if (o.op === 'cooler') {
      const uid = simUid('cool');
      coolers[uid] = { uid, modelId: o.modelId };
      const fanSlots = [...rack.fanSlots];
      fanSlots[o.slot] = uid;
      racks[rack.uid] = { ...rack, fanSlots };
    } else {
      const roomTemp = (rack.roomId && world.roomTemps[rack.roomId]) || (rack.roomId ? ROOM_BY_ID[rack.roomId].ambient : 25);
      const gpu = simGpu(o.modelId, roomTemp);
      gpus[gpu.uid] = gpu;
      const gpuSlots = [...rack.gpuSlots];
      gpuSlots[o.slot] = gpu.uid;
      racks[rack.uid] = { ...rack, gpuSlots };
    }
  });
  return { ...world, gpus, psus, coolers, racks, ownedRooms };
}

// ───────────────────────── Kit builder ─────────────────────────

interface KitContext {
  world: SimInput;
  price: (list: number) => number;
  heatMul: number;
  coolingMul: number;
}

/** GPU models mounted in a rack after putting `modelId` in `slot` (stock clocks for the new one). */
function gpuLoads(ctx: KitContext, rack: RackInstance, slot: number, modelId: string): { power: number; count: number; hottest: number } {
  let power = 0;
  let count = 0;
  let hottest = 0;
  rack.gpuSlots.forEach((uid, i) => {
    const g = i === slot ? null : uid ? ctx.world.gpus[uid] : null;
    const p = i === slot ? GPU_BY_ID[modelId].power : g ? GPU_BY_ID[g.modelId].power * ocPowerMul(g.oc) : 0;
    if (p <= 0) return;
    power += p;
    count += 1;
    hottest = Math.max(hottest, p);
  });
  return { power, count, hottest };
}

/**
 * Parts a rack needs to run `modelId` in `slot`: a PSU that carries the load and enough cooling to
 * hold the hottest card at the target temperature. Returns null when no catalog part can do it.
 */
function supportOps(ctx: KitContext, rack: RackInstance, rackUid: string, slot: number, modelId: string): { ops: AutopilotOp[]; cost: number } | null {
  const rackModel = RACK_BY_ID[rack.modelId];
  const room = ROOM_BY_ID[rack.roomId ?? 'bedroom'];
  const topo = rackTopology(rack, ctx.world);
  const loads = gpuLoads(ctx, rack, slot, modelId);
  const ops: AutopilotOp[] = [];
  let cost = 0;

  // Cooling: k per card = (base + fans / n) * room * research; solve for the fan total the hottest card needs.
  const roomTemp = room.ambient + 4;
  const heat = loads.hottest * ctx.heatMul * rackModel.heatMul;
  const kNeeded = heat / Math.max(5, AUTOPILOT.targetTemp - roomTemp) / (room.coolingMul * ctx.coolingMul);
  const fanNeeded = Math.max(0, (kNeeded - PHYSICS.baseCooling) * loads.count);
  let fanPower = topo.fanPower;
  if (topo.fanCooling < fanNeeded) {
    // Cheapest single change that closes the gap: fill a free bay, else replace the weakest cooler.
    const free = rack.fanSlots.findIndex((u) => !u || !ctx.world.coolers[u]);
    let bay = free;
    let lost: CoolerModel | null = null;
    if (bay < 0) {
      rack.fanSlots.forEach((u, i) => {
        const m = u ? COOLER_BY_ID[ctx.world.coolers[u].modelId] : null;
        if (m && (!lost || m.cooling < lost.cooling)) {
          lost = m;
          bay = i;
        }
      });
    }
    const gone: CoolerModel | null = lost;
    const gap = fanNeeded - topo.fanCooling + (gone ? (gone as CoolerModel).cooling : 0);
    const better = COOLER_CATALOG.filter((c) => !gone || c.cooling > (gone as CoolerModel).cooling);
    const pick = better.find((c) => c.cooling >= gap) ?? better[better.length - 1];
    if (pick && bay >= 0) {
      ops.push({ op: 'cooler', modelId: pick.id, rackUid, slot: bay });
      cost += ctx.price(pick.price) - (gone ? (gone as CoolerModel).price * SELL_REFUND : 0);
      fanPower += pick.power - (gone ? (gone as CoolerModel).power : 0);
    }
  }

  if (!rackModel.selfPowered) {
    const load = loads.power + fanPower;
    if (!topo.hasPsu || load > topo.capacity * AUTOPILOT.psuLoadShare) {
      const pick = PSU_CATALOG.find((p) => p.capacity * AUTOPILOT.psuLoadShare >= load);
      if (!pick) return null;
      const old: PsuModel | undefined = rack.psuUid && ctx.world.psus[rack.psuUid] ? PSU_BY_ID[ctx.world.psus[rack.psuUid].modelId] : undefined;
      ops.unshift({ op: 'psu', modelId: pick.id, rackUid });
      cost += ctx.price(pick.price) - (old ? old.price * SELL_REFUND : 0);
    }
  }
  return { ops, cost };
}

const emptyRack = (modelId: string, roomId: RoomId, pad: number): RackInstance => {
  const m = RACK_BY_ID[modelId];
  return { uid: NEW_RACK, modelId, roomId, pad, gpuSlots: Array.from({ length: m.slots }, () => null), fanSlots: Array.from({ length: m.fanSlots }, () => null), psuUid: null, rebootUntil: 0 };
};

// ───────────────────────── Candidates ─────────────────────────

/** Every purchase worth simulating right now (a dozen at most). */
export function candidates(world: SimInput, baseNet: number, live: LiveMetrics): Candidate[] {
  const cash = bnToNumber(world.cash);
  const budget = cash + Math.max(0, baseNet) * AUTOPILOT.reachSeconds;
  const price = (list: number): number => hardwarePrice(list, world);
  const mods = runModifiers(world.talents, world.research.levels);
  const ctx: KitContext = { world, price, heatMul: mods.heatMul, coolingMul: mods.coolingMul };
  const rules = challengeRules(world.challenge?.id);
  const rooms = usableRooms(world);
  const placed = Object.values(world.racks).filter((r) => r.roomId && rooms.includes(r.roomId));
  const out: Candidate[] = [];

  // The priciest cards within reach are the efficient ones; the cheapest is always an option.
  const reachable = GPU_CATALOG.filter((g) => price(g.price) <= budget);
  const models = (reachable.length ? reachable.slice(-3) : [GPU_CATALOG[0]]).reverse();

  // A. A card in a free slot (with the PSU / cooler the rack then needs).
  const withSlot = placed
    .map((r) => ({ r, slot: r.gpuSlots.findIndex((u) => !u || !world.gpus[u]) }))
    .filter((x) => x.slot >= 0)
    .sort((a, b) => (live.racks[a.r.uid]?.maxTemp ?? 0) - (live.racks[b.r.uid]?.maxTemp ?? 0))[0];
  if (withSlot) {
    models.forEach((m) => {
      const support = supportOps(ctx, withSlot.r, withSlot.r.uid, withSlot.slot, m.id);
      if (!support) return;
      out.push({
        id: `gpu:${m.id}`, label: { key: 'GPU {name}', params: { name: m.name } }, delaySec: 0,
        ops: [...support.ops, { op: 'gpu', modelId: m.id, rackUid: withSlot.r.uid, slot: withSlot.slot }],
        cost: price(m.price) + support.cost,
      });
    });
  }

  // B. Replace the weakest mounted card with a better model.
  let weakest: { rack: RackInstance; slot: number; gpu: GpuInstance } | null = null;
  placed.forEach((rack) => rack.gpuSlots.forEach((uid, slot) => {
    const gpu = uid ? world.gpus[uid] : undefined;
    if (gpu && (!weakest || GPU_BY_ID[gpu.modelId].hashrate < GPU_BY_ID[weakest.gpu.modelId].hashrate)) weakest = { rack, slot, gpu };
  }));
  const weak = weakest as { rack: RackInstance; slot: number; gpu: GpuInstance } | null;
  if (weak) {
    const old = GPU_BY_ID[weak.gpu.modelId];
    models.filter((m) => m.hashrate > old.hashrate).slice(0, 2).forEach((m) => {
      const support = supportOps(ctx, weak.rack, weak.rack.uid, weak.slot, m.id);
      if (!support) return;
      out.push({
        id: `swap:${m.id}`, label: { key: 'GPU upgrade to {name}', params: { name: m.name } }, delaySec: 0,
        ops: [...support.ops, { op: 'gpu', modelId: m.id, rackUid: weak.rack.uid, slot: weak.slot }],
        cost: price(m.price) + support.cost - old.price * SELL_REFUND * (1 - weak.gpu.wear),
      });
    });
  }

  // C. A new rack on a free pad: best room first. D. The next room, with its first rack.
  const freePad = (roomId: RoomId): number => {
    const taken = new Set(Object.values(world.racks).filter((r) => r.roomId === roomId).map((r) => r.pad));
    for (let i = 0; i < padCount(roomId, world.talents); i += 1) if (!taken.has(i)) return i;
    return -1;
  };
  const rackKit = (roomId: RoomId, pad: number, room: number, tag: string, label: (rack: string, gpu: string) => AutopilotLabel): void => {
    const rackModels = RACK_CATALOG.filter((r) => !r.vip && price(r.price) + room <= budget).slice(-2);
    rackModels.forEach((rm) => {
      const gpu = models.find((m) => price(m.price) + price(rm.price) + room <= budget) ?? GPU_CATALOG[0];
      const support = supportOps(ctx, emptyRack(rm.id, roomId, pad), NEW_RACK, 0, gpu.id);
      if (!support) return;
      out.push({
        id: `${tag}:${rm.id}`, label: label(rm.name, gpu.name), delaySec: 0,
        ops: [
          ...(room > 0 ? [{ op: 'room', roomId } as AutopilotOp] : []),
          { op: 'rack', modelId: rm.id, roomId, pad }, ...support.ops, { op: 'gpu', modelId: gpu.id, rackUid: NEW_RACK, slot: 0 },
        ],
        cost: room + price(rm.price) + price(gpu.price) + support.cost,
      });
    });
  };
  const roomWithPad = [...rooms].reverse().find((id) => freePad(id) >= 0);
  if (roomWithPad) rackKit(roomWithPad, freePad(roomWithPad), 0, 'rack', (rack, gpu) => ({ key: 'new rack: {rack} with {name}', params: { rack, name: gpu } }));
  const nextRoom = rules.singleRoom ? undefined : ROOM_ORDER.find((id) => !world.ownedRooms.includes(id));
  // Rooms are bought in order: only the first one not owned yet.
  if (nextRoom && ROOM_ORDER.indexOf(nextRoom) <= world.ownedRooms.length) {
    const roomPrice = ROOM_BY_ID[nextRoom].price;
    if (roomPrice <= budget) rackKit(nextRoom, 0, roomPrice, 'room', (rack) => ({ key: 'new room: {room} with a {rack}', params: { room: ROOM_BY_ID[nextRoom].name, rack } }));
  }

  // E. A rack that runs hot gets a cooling upgrade.
  const hot = placed
    .filter((r) => (live.racks[r.uid]?.maxTemp ?? 0) >= AUTOPILOT.hotTemp)
    .sort((a, b) => (live.racks[b.uid]?.maxTemp ?? 0) - (live.racks[a.uid]?.maxTemp ?? 0))[0];
  if (hot) {
    let bay = hot.fanSlots.findIndex((u) => !u || !world.coolers[u]);
    let lost: CoolerModel | null = null;
    if (bay < 0) {
      hot.fanSlots.forEach((u, i) => {
        const m = u ? COOLER_BY_ID[world.coolers[u].modelId] : null;
        if (m && (!lost || m.cooling < lost.cooling)) {
          lost = m;
          bay = i;
        }
      });
    }
    const gone = lost as CoolerModel | null;
    const next = COOLER_CATALOG.filter((c) => (!gone || c.cooling > gone.cooling) && price(c.price) <= budget).slice(0, 2);
    next.forEach((c) => {
      if (bay < 0) return;
      out.push({
        id: `cool:${c.id}`, label: { key: 'cooling: {name}', params: { name: c.name } }, delaySec: 0,
        ops: [{ op: 'cooler', modelId: c.id, rackUid: hot.uid, slot: bay }],
        cost: price(c.price) - (gone ? gone.price * SELL_REFUND : 0),
      });
    });
  }

  // F. Research, when the Lab is idle.
  if (!world.research.active) {
    const timeMul = talentModifiers(world.talents).researchTimeMul;
    RESEARCH.forEach((r) => {
      const level = researchLevel(world.research.levels, r.id);
      const cost = researchCost(r, level);
      if (level >= r.maxLevel || cost > budget) return;
      out.push({
        id: `research:${r.id}`, label: { key: 'research: {name}', params: { name: r.name } }, delaySec: researchTime(r, level, timeMul),
        ops: [], research: r.id, cost,
      });
    });
  }
  return out;
}

// ───────────────────────── Decision ─────────────────────────

export function evaluate(world: SimInput, c: Candidate, baseNet: number, spendable: number, now: number): Evaluated {
  let gain: number;
  if (c.research === 'logistics') {
    // Cheaper hardware does not show in a simulation: it saves a share of what the farm reinvests (about its income).
    gain = Math.max(0, baseNet) * (RESEARCH.find((r) => r.id === 'logistics')?.effect ?? 0);
  } else {
    const next = c.research
      ? { ...world, research: { ...world.research, levels: { ...world.research.levels, [c.research]: researchLevel(world.research.levels, c.research) + 1 } } }
      : applyOps(world, c.ops);
    gain = simulatedNet(next, now).net - baseNet;
  }
  const payback = gain > 0 ? c.cost / gain + c.delaySec : Number.POSITIVE_INFINITY;
  const missing = Math.max(0, c.cost - spendable);
  const wait = missing <= 0 ? 0 : baseNet > 0 ? missing / baseNet : Number.POSITIVE_INFINITY;
  return { ...c, gain, payback, wait, score: payback + wait };
}

export function plan(world: SimInput, now: number): Plan {
  const base = simulatedNet(world, now);
  const spendable = bnToNumber(world.cash) - base.live.electricityPerSec * AUTOPILOT.reserveBillSec;
  const evaluated = candidates(world, base.net, base.live)
    .map((c) => evaluate(world, c, base.net, spendable, now))
    .filter((e) => e.gain > 0 && e.cost > 0 && e.payback <= AUTOPILOT.maxPaybackSec && Number.isFinite(e.score))
    .sort((a, b) => a.score - b.score);
  const target = evaluated[0] ?? null;
  let buyNow: Evaluated | null = null;
  if (target) {
    if (target.wait === 0) buyNow = target;
    else {
      // A filler must be affordable and pay for itself before the target would be reached.
      buyNow = evaluated.filter((e) => e.wait === 0 && e.payback < target.wait).sort((a, b) => a.payback - b.payback)[0] ?? null;
    }
  }
  return { baseNet: base.net, spendable, target, buyNow, evaluated, live: base.live };
}

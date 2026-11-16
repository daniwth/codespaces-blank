import { PHYSICS } from './gameBalance';
import type { LiveMetrics } from '../store/gamePhysics';
import type { SideTab } from '../store/storeTypes';
import type { GameData } from '../types/player';

/**
 * Contextual hints: a one-time tip shown the first time a mechanic becomes relevant (never a
 * scripted tutorial). Each one is remembered in the save, so it is shown once per player.
 */
export interface HintContext extends Pick<GameData, 'gpus' | 'racks' | 'ownedRooms' | 'research' | 'cycle' | 'stats'> {
  live: LiveMetrics;
}

export interface HintDef {
  id: string;
  title: string;
  text: string;
  /** Values interpolated into `text`. */
  params?: Record<string, string | number>;
  /** Panel the hint points at ("Show me"). */
  tab?: SideTab;
  when: (ctx: HintContext) => boolean;
}

/** Paste level under which the re-paste hint fires (same threshold as the mass action). */
const DRY_PASTE = 0.5;

const mounted = (ctx: HintContext) =>
  Object.values(ctx.racks).filter((r) => r.roomId).flatMap((r) => r.gpuSlots).filter((u): u is string => Boolean(u && ctx.gpus[u]));

/** In priority order: when several apply at once, the first unseen one is shown. */
export const HINTS: HintDef[] = [
  {
    id: 'overload', title: 'PSU tripped',
    text: 'A rack draws more watts than its PSU delivers, so it shut down. Fit a bigger PSU or take a GPU out.', tab: 'shop',
    when: (c) => Object.values(c.live.racks).some((r) => r.status === 'overload'),
  },
  {
    id: 'throttle', title: 'Thermal throttling',
    text: 'A GPU above {temp}°C hashes at half speed. Press T for the thermal view, then add cooling or re-paste it.', params: { temp: PHYSICS.throttleTemp },
    when: (c) => Object.values(c.live.gpus).some((g) => g.throttled),
  },
  {
    id: 'brownout', title: 'Power line saturated',
    text: 'This room asks for more power than its line carries, so every rig in it slows down. Move racks to another room or research Line Upgrade.', tab: 'lab',
    when: (c) => Object.values(c.live.rooms).some((r) => r !== undefined && r.brownout < 1),
  },
  {
    id: 'paste', title: 'Dried thermal paste',
    text: 'Thermal paste dries with heat and the GPU runs hotter. Press R to re-paste every GPU of the room.',
    when: (c) => mounted(c).some((u) => c.gpus[u].paste < DRY_PASTE),
  },
  {
    id: 'cluster', title: 'Cluster Bonus',
    text: 'Four or more GPUs of the same model and grade in one rack share a power profile and draw less electricity.', tab: 'rigs',
    when: (c) => Object.values(c.live.racks).some((r) => r.clustered > 0),
  },
  {
    id: 'rooms', title: 'Every room has its own rules',
    text: 'Day and night, heat waves, condensation, hull limits: each room card in the Shop lists its traits.', tab: 'shop',
    when: (c) => c.ownedRooms.length >= 2,
  },
  {
    id: 'bull', title: 'Bull Run',
    text: 'The market entered a Bull Run: prices climb, so it is a good moment to sell what you mined.', tab: 'market',
    when: (c) => c.cycle.phase === 'bull',
  },
  {
    id: 'bear', title: 'Bear Market',
    text: 'Prices sink during a Bear Market. Hold your coins if you can pay the power bill, or buy cheap.', tab: 'market',
    when: (c) => c.cycle.phase === 'bear',
  },
  {
    id: 'bmc', title: 'Smart BMC online',
    text: 'The Smart BMC re-pastes and repairs GPUs on its own. Set its thresholds and budget in the Lab.', tab: 'lab',
    when: (c) => (c.research.levels.bmc ?? 0) > 0,
  },
  {
    id: 'orders', title: 'Order Desk open',
    text: 'You can now leave take-profit and stop-loss orders in the Market: they sell for you, even while you are away.', tab: 'market',
    when: (c) => (c.research.levels.orders ?? 0) > 0,
  },
  {
    id: 'pnl', title: 'Live profit and loss',
    text: 'Hover the hashrate in the top bar to see what you earn per second and what is holding the farm back.',
    when: (c) => c.stats.playTimeSec > 120,
  },
  {
    id: 'hotkeys', title: 'Keyboard shortcuts',
    text: 'Press ? to see every shortcut: number keys switch panels, T toggles the thermal view, R re-pastes.',
    when: (c) => c.stats.playTimeSec > 300,
  },
];

export const HINT_IDS: string[] = HINTS.map((h) => h.id);
export const HINT_BY_ID: Record<string, HintDef> = Object.fromEntries(HINTS.map((h) => [h.id, h]));

/** First hint whose moment has come and that the player has not seen yet. */
export const nextHint = (seen: readonly string[], ctx: HintContext): HintDef | null =>
  HINTS.find((h) => !seen.includes(h.id) && h.when(ctx)) ?? null;

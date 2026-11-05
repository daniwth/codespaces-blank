import type { RoomDefinition, RoomId } from '../types/player';

/**
 * Progressive rooms. Each one adds rack pads, a bigger contracted power line,
 * cheaper electricity and a better thermal environment.
 */
export const ROOM_CATALOG: RoomDefinition[] = [
  {
    id: 'bedroom', name: 'Bedroom', subtitle: 'Mom says the PC is too loud',
    price: 0, ambient: 24, maxPowerW: 1_500, pads: 2, priceMul: 1, coolingMul: 1, heatPerWatt: 0.008,
    theme: { wall: '#3b2f5c', wallDark: '#261d40', floorA: '#6b4f3a', floorB: '#5c4331', trim: '#8b6b52', light: '#fde68a' },
  },
  {
    id: 'garage', name: 'Garage', subtitle: 'Summer heat: +35°C ambient',
    price: 5_000, ambient: 35, maxPowerW: 6_000, pads: 4, priceMul: 0.85, coolingMul: 1.05, heatPerWatt: 0.0016,
    theme: { wall: '#4b5563', wallDark: '#374151', floorA: '#57534e', floorB: '#44403c', trim: '#a16207', light: '#fef9c3' },
  },
  {
    id: 'warehouse', name: 'Industrial Warehouse', subtitle: 'Three-phase power & ceiling fans',
    price: 200_000, ambient: 22, maxPowerW: 60_000, pads: 6, priceMul: 0.65, coolingMul: 1.15, heatPerWatt: 0.00022,
    theme: { wall: '#334155', wallDark: '#1e293b', floorA: '#475569', floorB: '#3f4b5c', trim: '#f59e0b', light: '#e0f2fe' },
  },
  {
    id: 'arctic', name: 'Arctic Datacenter', subtitle: 'Free cooling at -10°C',
    price: 20_000_000, ambient: -10, maxPowerW: 400_000, pads: 10, priceMul: 0.45, coolingMul: 1.3, heatPerWatt: 0.00005,
    theme: { wall: '#cbd5e1', wallDark: '#94a3b8', floorA: '#e2e8f0', floorB: '#cfd8e3', trim: '#0ea5e9', light: '#f0f9ff' },
  },
  {
    id: 'submarine', name: 'Submarine Datacenter', subtitle: 'Ocean-cooled hull, 4°C',
    price: 1_500_000_000, ambient: 4, maxPowerW: 2_000_000, pads: 13, priceMul: 0.3, coolingMul: 1.6, heatPerWatt: 0.000012,
    theme: { wall: '#0c4a6e', wallDark: '#082f49', floorA: '#155e75', floorB: '#134e5e', trim: '#facc15', light: '#a5f3fc' },
  },
];

export const ROOM_BY_ID = Object.fromEntries(ROOM_CATALOG.map((r) => [r.id, r])) as Record<RoomId, RoomDefinition>;

export const ROOM_ORDER: RoomId[] = ROOM_CATALOG.map((r) => r.id);

/** Hard cap of pads that fit on the canvas floor (2 rows × 8). */
export const MAX_PADS = 16;

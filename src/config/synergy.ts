import type { BiosProfileId, BmcConfig, RoomUpgrades } from '../types/player';
import type { OverclockSettings } from '../types/hardware';

/** Rack synergies (pure rules read by the simulation and the rack modal). */
export const SYNERGY = {
  /** Cluster Bonus: this many GPUs of one model and one silicon grade in the same rack… */
  clusterSize: 4,
  /**
   * …hash this much faster and draw this much less from the PSU (shared power delivery). The dies give
   * off the same heat as ever, so the cooling a build needs does not change.
   */
  clusterHash: 0.08,
  clusterPower: 0.05,
  /**
   * Liquid Cooling Spillover: share of a rack's liquid-loop cooling (W/°C) that also reaches each rack
   * right next to it, as long as that neighbour has no liquid loop of its own (a closed loop gains
   * nothing from chilled air next door). A liquid rack between two air-cooled ones cools all three.
   */
  spillShare: 0.15,
} as const;

export const DEFAULT_BMC: BmcConfig = { enabled: true, autoPaste: true, pasteBelow: 0.25, autoRepair: true, healthBelow: 0.4 };
/** Slider ranges of the Smart BMC thresholds. */
export const BMC_LIMITS = { paste: [0.05, 0.9], health: [0.1, 0.9], step: 0.05 } as const;

export const DEFAULT_UPGRADES: RoomUpgrades = { battery: false };

export const BIOS_PROFILE_IDS: BiosProfileId[] = ['eco', 'balanced', 'max'];
export const BIOS_PROFILE_NAMES: Record<BiosProfileId, string> = { eco: 'Eco', balanced: 'Balanced', max: 'Max Hash' };

/** Factory profiles: a mild undervolt, a light overclock at stock voltage and an aggressive overvolted one. */
export const DEFAULT_BIOS_PROFILES: Record<BiosProfileId, OverclockSettings> = {
  eco: { core: -50, mem: 0, voltage: 950 },
  balanced: { core: 50, mem: 200, voltage: 1000 },
  max: { core: 250, mem: 800, voltage: 1100 },
};

export const defaultBiosProfiles = (): Record<BiosProfileId, OverclockSettings> => ({
  eco: { ...DEFAULT_BIOS_PROFILES.eco },
  balanced: { ...DEFAULT_BIOS_PROFILES.balanced },
  max: { ...DEFAULT_BIOS_PROFILES.max },
});

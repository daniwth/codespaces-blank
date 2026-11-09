/**
 * Bumped whenever the whole world is replaced (new game, factory reset, save import, Halving).
 * A simulation tick computed from an older world must not be merged into the new one.
 */
let epoch = 0;

export const currentWorldEpoch = (): number => epoch;
export const bumpWorldEpoch = (): void => {
  epoch += 1;
};

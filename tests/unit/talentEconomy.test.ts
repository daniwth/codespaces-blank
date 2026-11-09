import { describe, expect, it } from 'vitest';
import { PRESTIGE_TREE, earningsForSc, scForEarnings, talentCost } from '../../src/config/prestigeTree';

const nodeTotal = (id: string): number => {
  const n = PRESTIGE_TREE.find((t) => t.id === id);
  if (!n) throw new Error(id);
  return Array.from({ length: n.maxLevel }, (_, l) => talentCost(n, l)).reduce((a, b) => a + b, 0);
};
const treeTotal = PRESTIGE_TREE.reduce((sum, n) => sum + nodeTotal(n.id), 0);

describe('talent tree is priced for the diminishing-returns Halving reward', () => {
  it('the whole tree costs a few dozen typical runs, not hundreds', () => {
    const typicalRun = scForEarnings(earningsForSc(7)); // a ~3 h run at the SC/h peak
    expect(typicalRun).toBe(7);
    const runs = treeTotal / typicalRun;
    expect(runs).toBeGreaterThan(20);
    expect(runs).toBeLessThan(50);
  });

  it('the first Halving buys real progress: at least two Hash Amplifier levels', () => {
    const firstReward = scForEarnings(4e6);
    const hash = PRESTIGE_TREE.find((t) => t.id === 'hash_core');
    expect(hash).toBeDefined();
    if (hash) expect(talentCost(hash, 0) + talentCost(hash, 1)).toBeLessThanOrEqual(firstReward);
  });

  it('Quantum Entangle stays the late-game sink (most expensive node)', () => {
    const q = nodeTotal('quantum_entanglement');
    PRESTIGE_TREE.filter((t) => t.id !== 'quantum_entanglement').forEach((t) => expect(nodeTotal(t.id)).toBeLessThan(q));
  });
});

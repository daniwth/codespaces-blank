/**
 * QA regressions for the title screen / main menu (leftover UI state across
 * Main menu -> Continue round trips).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialData } from '../../src/store/initialState';
import { useGameStore } from '../../src/store/useGameStore';

const game = () => useGameStore.getState();

beforeEach(() => {
  useGameStore.setState({ ...createInitialData(), screen: 'menu', wikiOpen: false, selectedRack: null, biosGpu: null, offlineReport: null });
});

describe('Main menu round trip', () => {
  // OPEN BUG: returnToMenu clears the rack/BIOS/toasts/wiki but not offlineReport, so a
  // "Welcome back" report left open (reachable by tabbing out of it to "Main menu")
  // shows again, stale, on the next Continue.
  it('discards a pending offline report, so Continue does not show a stale "Welcome back"', () => {
    game().continueGame();
    useGameStore.setState({
      offlineReport: { seconds: 3600, requested: 3600, ccMined: 12, electricity: 3, earnedCash: 0, ccDelta: 12, cashDelta: -3 },
    });
    game().returnToMenu();
    expect(game().offlineReport).toBeNull();
    game().continueGame();
    expect(game().offlineReport).toBeNull();
  });
});

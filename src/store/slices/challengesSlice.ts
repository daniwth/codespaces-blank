import { tr } from '../../i18n';
import { CHALLENGE_BY_ID, challengeRules, type ChallengeRules } from '../../config/challenges';
import { HALVING_MIN_EARNINGS } from '../../config/prestigeTree';
import type { GameData } from '../../types/player';
import { bnToNumber } from '../../utils/bignum';
import { fxBus, sfxBus } from '../../utils/eventBus';
import { formatDuration } from '../../utils/formatters';
import type { ChallengesSlice, GetState, SetState } from '../storeTypes';

/** True while the active challenge enforces the given boolean rule. */
export const challengeBlocks = (s: Pick<GameData, 'challenge'>, rule: 'lockOverclock' | 'bronzeOnly' | 'singleRoom'): boolean =>
  challengeRules(s.challenge?.id)[rule];

export const activeRules = (s: Pick<GameData, 'challenge'>): ChallengeRules => challengeRules(s.challenge?.id);

/** Share (0-1) of the Halving threshold reached by the current run. */
export const challengeProgress = (s: Pick<GameData, 'runEarnings'>): number =>
  Math.min(1, bnToNumber(s.runEarnings) / HALVING_MIN_EARNINGS);

export function createChallengesSlice(set: SetState, get: GetState): ChallengesSlice {
  return {
    /** Log + error cue explaining which challenge rule refused an action (pass the translated reason). Always returns false. */
    denyByChallenge: (reason) => {
      const s = get();
      const name = s.challenge ? tr(CHALLENGE_BY_ID[s.challenge.id].name) : '';
      s.pushLog(tr('Challenge {name}: {reason}', { name, reason }), 'warn');
      sfxBus.emit('error');
      return false;
    },

    abandonChallenge: () => {
      const s = get();
      if (!s.challenge) return false;
      const name = tr(CHALLENGE_BY_ID[s.challenge.id].name);
      set({ challenge: null });
      s.pushLog(tr('Challenge abandoned: {name}. The run continues unrestricted and keeps its normal Halving reward, without the challenge bonus.', { name }), 'info');
      sfxBus.emit('switch');
      return true;
    },

    checkChallenge: () => {
      const s = get();
      if (!s.challenge || bnToNumber(s.runEarnings) < HALVING_MIN_EARNINGS) return false;
      const def = CHALLENGE_BY_ID[s.challenge.id];
      const prev = s.challengeRecords[def.id];
      const first = !prev || prev.clears <= 0;
      const sc = first ? def.firstSc : def.repeatSc;
      const gems = first ? def.firstGems : def.repeatGems;
      const timeSec = Math.max(1, (s.lastTick - s.challenge.startedAt) / 1000);
      const best = prev ? Math.min(prev.bestTimeSec, timeSec) : timeSec;
      set({
        sc: s.sc + sc,
        scLifetime: s.scLifetime + sc,
        gems: s.gems + gems,
        challenge: null,
        challengeRecords: { ...s.challengeRecords, [def.id]: { clears: (prev?.clears ?? 0) + 1, bestTimeSec: best } },
      });
      s.pushLog(
        tr(first
          ? 'CHALLENGE COMPLETE: {name} in {time}! First clear bonus: +{sc} $SC and +{gems} gems. The restriction is lifted.'
          : 'CHALLENGE COMPLETE: {name} in {time}! Repeat bonus: +{sc} $SC and +{gems} gems. The restriction is lifted.',
        { name: tr(def.name), time: formatDuration(timeSec), sc, gems }),
        'good',
      );
      sfxBus.emit('halving');
      fxBus.emit({ kind: 'confetti', intensity: 1 });
      return true;
    },
  };
}

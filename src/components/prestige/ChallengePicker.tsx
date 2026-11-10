import { Swords } from 'lucide-react';
import { CHALLENGES, CHALLENGE_BY_ID } from '../../config/challenges';
import { useT } from '../../i18n';
import type { ChallengeId, ChallengeRecords } from '../../types/player';

interface Props {
  value: ChallengeId | null;
  onChange: (id: ChallengeId | null) => void;
  /** Completed challenges, to show which bonus applies (first clear vs repeat). */
  records?: ChallengeRecords;
  id?: string;
}

/** Optional challenge selector shown before a run starts (New game and The Halving). */
export function ChallengePicker({ value, onChange, records, id = 'challenge-picker' }: Props) {
  const t = useT();
  const def = value ? CHALLENGE_BY_ID[value] : null;
  const first = def ? !(records?.[def.id]?.clears ?? 0) : false;
  return (
    <div className="flex flex-col gap-1" data-testid={id}>
      <label htmlFor={`${id}-select`} className="flex items-center gap-1 font-silk text-[9px] text-dim">
        <Swords size={11} /> {t('CHALLENGE RUN (optional)')}
      </label>
      <select
        id={`${id}-select`}
        data-testid={`${id}-select`}
        className="retro-input w-full"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? (e.target.value as ChallengeId) : null)}
      >
        <option value="">{t('No challenge: free run')}</option>
        {CHALLENGES.map((c) => (
          <option key={c.id} value={c.id}>
            {t(c.name)} — {t(c.tagline)}
          </option>
        ))}
      </select>
      {def && (
        <p className="text-[15px] leading-tight" style={{ color: def.color }} data-testid={`${id}-info`}>
          {t(def.description)}{' '}
          <span className="text-gold">
            {first
              ? t('First clear: +{sc} $SC, +{gems} gems.', { sc: def.firstSc, gems: def.firstGems })
              : t('Repeat clear: +{sc} $SC, +{gems} gems.', { sc: def.repeatSc, gems: def.repeatGems })}
          </span>
        </p>
      )}
    </div>
  );
}

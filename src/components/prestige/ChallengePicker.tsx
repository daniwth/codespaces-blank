import { Swords } from 'lucide-react';
import { CHALLENGES, CHALLENGE_BY_ID } from '../../config/challenges';
import { RELICS, RELIC_IDS, relicOwned } from '../../config/collection';
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
          </span>{' '}
          <span className="text-[#f0abfc]" data-testid={`${id}-relic`}>
            {relicOwned(records ?? {}, def.id)
              ? t('Relic owned: {name} ({effect})', { name: t(RELICS[def.id].name), effect: t(RELICS[def.id].description) })
              : t('First clear also grants the relic {name}: {effect}', { name: t(RELICS[def.id].name), effect: t(RELICS[def.id].description) })}
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-1" data-testid={`${id}-relics`} aria-label={t('Relics')}>
        {RELIC_IDS.map((rid) => {
          const owned = relicOwned(records ?? {}, rid);
          const relic = RELICS[rid];
          return (
            <span
              key={rid}
              className="px-1.5 py-0.5 font-silk text-[9px] uppercase"
              style={owned ? { color: '#07060f', background: relic.color } : { color: '#8f89c4', boxShadow: 'inset 0 0 0 1px #3a3470' }}
              title={`${t(relic.name)}: ${t(relic.description)} (${t(CHALLENGE_BY_ID[rid].name)})`}
              data-owned={owned}
            >
              {owned ? '◆' : '◇'} {t(relic.name)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

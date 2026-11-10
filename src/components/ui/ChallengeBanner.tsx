import { Swords } from 'lucide-react';
import { useState } from 'react';
import { CHALLENGE_BY_ID } from '../../config/challenges';
import { HALVING_MIN_EARNINGS } from '../../config/prestigeTree';
import { useT } from '../../i18n';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { bnToNumber } from '../../utils/bignum';
import { formatCash, formatDuration } from '../../utils/formatters';
import { PixelButton } from './PixelButton';

/** HUD strip shown while a challenge restricts the run: rule, progress to the Halving threshold, abandon. */
export function ChallengeBanner() {
  const t = useT();
  const s = useGameShallow((st) => ({ challenge: st.challenge, run: st.runEarnings, now: st.lastTick }));
  const [confirm, setConfirm] = useState(false);
  if (!s.challenge) return null;
  const def = CHALLENGE_BY_ID[s.challenge.id];
  const progress = Math.min(1, bnToNumber(s.run) / HALVING_MIN_EARNINGS);
  const elapsed = Math.max(0, (s.now - s.challenge.startedAt) / 1000);
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1"
      style={{ background: `${def.color}18`, boxShadow: `inset 0 0 0 2px ${def.color}88` }}
      data-testid="challenge-banner"
    >
      <Swords size={14} className="shrink-0" style={{ color: def.color }} />
      <span className="font-pixel text-[9px]" style={{ color: def.color }}>
        {t('CHALLENGE')}: {t(def.name).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 basis-40 text-[16px] leading-tight text-ink/85">{t(def.tagline)}</span>
      <span className="flex min-w-0 items-center gap-2 text-[15px] leading-none text-dim">
        <span className="h-2 w-20 shrink-0 bg-black">
          <span className="block h-full" style={{ width: `${progress * 100}%`, background: def.color }} />
        </span>
        {formatCash(bnToNumber(s.run))}/{formatCash(HALVING_MIN_EARNINGS)} · {formatDuration(elapsed)}
      </span>
      {!confirm ? (
        <PixelButton size="xs" variant="ghost" onClick={() => setConfirm(true)} title={t('Abandon the challenge: keep the normal Halving reward, no bonus.')}>
          {t('Abandon')}
        </PixelButton>
      ) : (
        <span className="flex gap-1">
          <PixelButton size="xs" variant="danger" onClick={() => { useGameStore.getState().abandonChallenge(); setConfirm(false); }}>
            {t('Confirm abandon')}
          </PixelButton>
          <PixelButton size="xs" variant="ghost" onClick={() => setConfirm(false)}>
            {t('Cancel')}
          </PixelButton>
        </span>
      )}
    </div>
  );
}

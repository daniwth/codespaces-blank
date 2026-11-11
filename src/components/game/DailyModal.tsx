import { Check, Gem, Gift } from 'lucide-react';
import { DAILY_REWARDS, dailyCash, localDay } from '../../config/daily';
import { useT } from '../../i18n';
import { dailyAvailable, giftIncomePerSec, nextDailyStreak } from '../../store/slices/progressSlice';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { cn } from '../../utils/cn';
import { formatCash } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';
import { PixelModal } from '../ui/PixelModal';

/** Daily bonus: a 7-day ladder that climbs with consecutive days and restarts when one is skipped. */
export function DailyModal() {
  const t = useT();
  const s = useGameShallow((st) => ({ open: st.dailyOpen, daily: st.daily, income: st.dailyOpen ? giftIncomePerSec(st) : 0, best: st.stats.bestStreak }));
  const { setDailyOpen, claimDaily } = useGameStore.getState();
  if (!s.open) return null;
  const today = localDay();
  const available = dailyAvailable(s);
  // Day the player stands on: the one to claim now, or the one claimed today.
  const streak = available ? nextDailyStreak(s.daily, today) : s.daily.streak;
  const slot = (Math.max(1, streak) - 1) % DAILY_REWARDS.length;
  const close = () => setDailyOpen(false);

  return (
    <PixelModal title={<span className="flex items-center gap-2"><Gift size={14} /> {t('Daily bonus')}</span>} onClose={close} className="max-w-xl" accent="#facc15">
      <p className="text-[17px] leading-tight text-dim">
        {t('Come back every day: each consecutive day pays more, and day 7 pays the most. Skip a day and the streak restarts.')}
      </p>
      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7" data-testid="daily-ladder">
        {DAILY_REWARDS.map((reward, i) => {
          const claimed = available ? i < slot : i <= slot;
          const current = i === slot;
          return (
            <div
              key={i}
              className={cn('flex flex-col items-center gap-0.5 p-1.5 text-center text-[15px] leading-tight', claimed ? 'bg-[#1f1503]' : 'bg-panel-2', !claimed && !current && 'opacity-70')}
              style={{ boxShadow: current ? 'inset 0 0 0 2px #facc15' : undefined }}
            >
              <span className="font-pixel text-[8px] text-dim">{t('DAY {n}', { n: i + 1 })}</span>
              <span className="text-gold">{claimed && !(current && available) ? <Check size={16} /> : <Gift size={16} />}</span>
              <span className="text-ink">{formatCash(dailyCash(reward, s.income))}</span>
              {reward.gems > 0 && (
                <span className="flex items-center gap-0.5 text-magenta">
                  <Gem size={10} /> {reward.gems}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[16px] text-dim">
          {t('Streak: day {n} · best {best}', { n: available ? Math.max(0, streak - 1) : streak, best: s.best })}
        </span>
        {available ? (
          <PixelButton variant="gold" onClick={() => claimDaily()} data-testid="daily-claim" silent>
            {t('Claim day {n}', { n: streak })}
          </PixelButton>
        ) : (
          <span className="text-[16px] text-lime">{t('Claimed. Come back tomorrow!')}</span>
        )}
      </div>
    </PixelModal>
  );
}
